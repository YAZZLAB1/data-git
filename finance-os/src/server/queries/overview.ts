import "server-only";
import { format, parseISO, subMonths } from "date-fns";
import type { Queryable } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { percentChange, spendingByCategory, summarize } from "@/lib/finance/calculations";
import { resolvePeriod, resolveRange } from "@/lib/period";
import { loadRateTable } from "@/server/services/currency";
import { averageMonthlyExpenses, currentNetWorth, fillBuckets, loadLines, makeBuckets, monthKeys, netWorthHistory } from "@/server/services/reporting";
import { listCategories } from "@/server/services/categories";
import { getBudgetMonth } from "@/server/services/budgets";
import { listTransactions } from "@/server/services/transactions";
import { listRecurring } from "@/server/services/recurring";
import { listGoals } from "@/server/services/goals";
import { OTHER_COLOR } from "@/lib/constants";

export type SP = Record<string, string | undefined>;

export async function getOverview(tx: Queryable, user: SessionUser, today: string, sp: SP) {
  const base = user.baseCurrency;
  const rates = await loadRateTable(tx, user.id);
  const period = resolvePeriod({ period: sp.period, from: sp.from, to: sp.to }, today);
  const range = resolveRange(sp.cf, today, "6m", { from: sp.cff, to: sp.cft });
  const [{ n: accountCount }] = await tx.query<{ n: number }>("SELECT count(*) AS n FROM accounts WHERE user_id=$1", [user.id]);
  const [{ n: txCount }] = await tx.query<{ n: number }>("SELECT count(*) AS n FROM transactions WHERE user_id=$1", [user.id]);

  const histStart = format(subMonths(parseISO(today), 6), "yyyy-MM-01");
  const earliest = [period.prevFrom, range.from, histStart].sort()[0];
  const { lines, missing } = await loadLines(tx, user.id, earliest, today > period.to ? today : period.to, base, { rates });
  const within = (from: string, to: string) => lines.filter((l) => l.date >= from && l.date <= to);
  const cur = within(period.from, period.to);
  const prev = within(period.prevFrom, period.prevTo);
  const s = summarize(cur);
  const p = summarize(prev);

  const nw = await currentNetWorth(tx, user.id, base, today, rates);
  const prevNw = await netWorthHistory(tx, user.id, base, [period.prevTo], rates);
  const prevNet = prevNw.points[0];

  const cats = await listCategories(tx, user.id, { includeArchived: true });
  const catById = new Map(cats.map((c) => [c.id, c]));
  const spend = [...spendingByCategory(cur)]
    .filter(([, v]) => v > 0)
    .map(([id, value]) => {
      const c = id ? catById.get(id) : undefined;
      return { id, name: c?.name ?? "Uncategorized", value, color: c?.color ?? OTHER_COLOR, icon: c?.icon ?? "circle-dashed" };
    })
    .sort((a, b) => b.value - a.value);

  const cash = fillBuckets(makeBuckets(range.from, range.to, range.granularity), within(range.from, range.to));

  const budget = await getBudgetMonth(tx, user.id, today, base, rates);
  const recent = await listTransactions(tx, user.id, { sort: "date_desc", page: 1, pageSize: 8 }, base);
  const recurring = await listRecurring(tx, user.id, base, today, rates);
  const upcoming = recurring.filter((r) => r.is_active && r.daysUntil <= 31).slice(0, 6);

  // Health snapshot
  const months = monthKeys(format(subMonths(parseISO(today), 1), "yyyy-MM-dd"), 6);
  const trend = months.map((m) => ({ label: m.label, value: summarize(within(m.from, m.to)).expenses }));
  const last = trend[trend.length - 1]?.value ?? 0;
  const prior = trend.slice(-4, -1).filter((t) => t.value > 0);
  const priorAvg = prior.length ? prior.reduce((sum, t) => sum + t.value, 0) / prior.length : 0;
  const avgExp = await averageMonthlyExpenses(tx, user.id, base, today, 3, rates);
  const goals = await listGoals(tx, user.id, today);
  const eg = goals.find((g) => g.is_emergency_fund && g.status !== "archived");
  const emergency = eg
    ? { source: "goal" as const, name: eg.name, current: eg.saved, target: eg.target, currency: eg.currency }
    : avgExp.average > 0
      ? { source: "liquid" as const, name: `${user.emergencyFundMonths} months of expenses`, current: nw.liquid, target: avgExp.average * user.emergencyFundMonths, currency: base }
      : null;

  return {
    period,
    range,
    empty: { accounts: Number(accountCount) === 0, transactions: Number(txCount) === 0 },
    netWorth: {
      value: nw.netWorth,
      assets: nw.assets,
      liabilities: nw.liabilities,
      change: prevNw.hasData && !prevNet.incomplete ? percentChange(nw.netWorth, prevNet.netWorth) : null,
      previousDate: period.prevTo,
    },
    summary: s,
    previous: p,
    changes: {
      income: percentChange(s.income, p.income),
      expenses: percentChange(s.expenses, p.expenses),
      net: percentChange(s.net, p.net),
    },
    cashFlow: cash.map((b) => ({ label: b.label, income: b.income, expenses: b.expenses, net: b.net, from: b.from, to: b.to })),
    spend,
    budget: { month: budget.month, items: budget.items.slice(0, 6), totals: budget.totals, count: budget.items.length },
    recent: recent.rows,
    upcoming,
    health: {
      savingsRate: s.savingsRate,
      previousSavingsRate: p.savingsRate,
      totalDebt: nw.liabilities,
      trend,
      trendChange: priorAvg > 0 ? percentChange(last, priorAvg) : null,
      budgetUtilization: budget.totals.available > 0 ? budget.totals.percent : null,
      emergency,
    },
    missing: [...missing, ...nw.missing],
  };
}
export type OverviewData = Awaited<ReturnType<typeof getOverview>>;
