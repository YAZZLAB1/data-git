import "server-only";
import { eachDayOfInterval, format, parseISO, subMonths, endOfMonth } from "date-fns";
import type { Queryable } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { savingsRate, spendingByCategory, spendingByMerchant, summarize } from "@/lib/finance/calculations";
import { accountClass } from "@/lib/finance/ledger";
import { toCents } from "@/lib/finance/money";
import { isISODate, monthStart, resolvePeriod, resolveRange } from "@/lib/period";
import { OTHER_COLOR } from "@/lib/constants";
import { loadRateTable } from "@/server/services/currency";
import { fillBuckets, loadLines, makeBuckets, netWorthHistory, type Missing } from "@/server/services/reporting";
import { listCategories } from "@/server/services/categories";
import { getBudgetMonth } from "@/server/services/budgets";

export const AS_OF_OPTIONS = { today: "Today", m1: "End of last month", m3: "3 months ago", m6: "6 months ago", m12: "12 months ago" } as const;

export async function getAnalytics(tx: Queryable, user: SessionUser, today: string, sp: Record<string, string | undefined>) {
  const base = user.baseCurrency;
  const rates = await loadRateTable(tx, user.id);
  const period = resolvePeriod({ period: sp.period, from: sp.from, to: sp.to }, today);
  const r1 = resolveRange(sp.r1, today, "12m", { from: sp.r1f, to: sp.r1t });
  const r3 = resolveRange(sp.r3 === "6m" ? "6m" : "12m", today, "12m");
  const r4 = resolveRange(sp.r4, today, "12m", { from: sp.r4f, to: sp.r4t });
  const r5 = resolveRange(sp.r5, today, "6m", { from: sp.r5f, to: sp.r5t });
  const r7 = resolveRange(sp.r7, today, "12m", { from: sp.r7f, to: sp.r7t });
  const r8 = resolveRange(sp.r8, today, "3m", { from: sp.r8f, to: sp.r8t });
  const earliest = [period.from, r1.from, r3.from, r5.from, r7.from, r8.from].sort()[0];
  const latest = [period.to, today].sort().reverse()[0];
  const { lines, missing } = await loadLines(tx, user.id, earliest, latest, base, { rates });
  const within = (from: string, to: string) => lines.filter((l) => l.date >= from && l.date <= to);
  const cats = await listCategories(tx, user.id, { includeArchived: true });
  const catById = new Map(cats.map((c) => [c.id, c]));
  const catInfo = (id: string | null) => {
    const c = id ? catById.get(id) : undefined;
    return { id, name: c?.name ?? "Uncategorized", color: c?.color ?? OTHER_COLOR };
  };

  // 1. Income vs expenses
  const incomeVsExpenses = fillBuckets(makeBuckets(r1.from, r1.to, r1.granularity), within(r1.from, r1.to)).map((b) => ({ label: b.label, income: b.income, expenses: b.expenses, net: b.net }));
  // 3. Monthly cash flow
  const monthly = fillBuckets(makeBuckets(r3.from, r3.to, "month"), within(r3.from, r3.to)).map((b) => ({ label: b.label, income: b.income, expenses: b.expenses, net: b.net }));
  // 7. Savings rate
  const rate = fillBuckets(makeBuckets(r7.from, r7.to, "month"), within(r7.from, r7.to)).map((b) => {
    const sr = savingsRate(b.income, b.expenses);
    return { label: b.label, rate: sr === null ? null : Math.round(sr * 10) / 10, income: b.income, expenses: b.expenses };
  });

  // 2. Spending by category (global period)
  const cur = within(period.from, period.to);
  const byCategory = [...spendingByCategory(cur)].filter(([, v]) => v > 0).map(([id, value]) => ({ ...catInfo(id), value })).sort((a, b) => b.value - a.value);
  // 9. Merchants (global period)
  const merchants = [...spendingByMerchant(cur)].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value }));

  // 5. Spending trends by category (monthly, stacked)
  const months5 = makeBuckets(r5.from, r5.to, r5.granularity === "day" ? "week" : r5.granularity);
  const trendTotals = spendingByCategory(within(r5.from, r5.to));
  const trendCats = [...trendTotals].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id]) => catInfo(id));
  const trendRows = months5.map((b) => {
    const m = spendingByCategory(within(b.from, b.to));
    const row: Record<string, number | string> = { label: b.label };
    for (const c of trendCats) row[c.id ?? "none"] = Math.max(0, m.get(c.id) ?? 0);
    return row;
  });

  // 8. Daily expenses
  const dailyMap = new Map<string, number>();
  for (const l of within(r8.from, r8.to)) {
    if (l.type === "income") continue;
    dailyMap.set(l.date, (dailyMap.get(l.date) ?? 0) + (l.type === "refund" ? -l.amount : l.amount));
  }
  const daily = eachDayOfInterval({ start: parseISO(r8.from), end: parseISO(r8.to) }).map((d) => {
    const k = format(d, "yyyy-MM-dd");
    return { date: k, value: Math.max(0, dailyMap.get(k) ?? 0) };
  });

  // 4. Net worth (recorded snapshots at each month end, plus range end)
  const nwDates: string[] = [];
  let d = endOfMonth(parseISO(r4.from));
  while (format(d, "yyyy-MM-dd") < r4.to) {
    nwDates.push(format(d, "yyyy-MM-dd"));
    d = endOfMonth(subMonths(d, -1));
  }
  nwDates.push(r4.to);
  const nw = await netWorthHistory(tx, user.id, base, nwDates, rates);
  const netWorth = nw.points.map((p, i) => ({ label: i === nw.points.length - 1 && r4.to === today ? "Today" : format(parseISO(p.date), "MMM yy"), date: p.date, assets: p.assets, liabilities: p.liabilities, netWorth: p.netWorth, incomplete: p.incomplete }));

  // 10. Account distribution as of a date (snapshots)
  const asOfKey = (sp.asof && sp.asof in AS_OF_OPTIONS ? sp.asof : "today") as keyof typeof AS_OF_OPTIONS;
  const asOf = asOfKey === "today" ? today : format(endOfMonth(subMonths(parseISO(today), Number(asOfKey.slice(1)))), "yyyy-MM-dd");
  const snaps = await tx.query<{ account_id: string; name: string; type: string; currency: string; balance: string }>(
    `SELECT DISTINCT ON (ab.account_id) ab.account_id, a.name, a.type, a.currency, ab.balance
       FROM account_balances ab JOIN accounts a ON a.id = ab.account_id
      WHERE ab.user_id = $1 AND ab.date <= $2 ORDER BY ab.account_id, ab.date DESC`,
    [user.id, asOf],
  );
  const distMissing = new Map<string, number>();
  const distribution = snaps
    .filter((s) => accountClass(s.type) === "asset")
    .map((s) => {
      const cents = toCents(s.balance);
      const conv = s.currency === base ? cents : rates.convert(cents, s.currency, base, asOf)?.cents;
      if (conv === undefined || conv === null) distMissing.set(s.currency, (distMissing.get(s.currency) ?? 0) + 1);
      return { id: s.account_id, name: s.name, value: conv ?? 0 };
    })
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  // 6. Budget vs actual for a chosen month
  const budgetMonth = monthStart(isISODate(sp.bm) ? sp.bm : today);
  const bm = await getBudgetMonth(tx, user.id, budgetMonth, base, rates);
  const budgetMonths = Array.from({ length: 12 }, (_, i) => format(subMonths(parseISO(monthStart(today)), i), "yyyy-MM-dd"));

  const allMissing: Missing[] = [...missing, ...nw.missing, ...[...distMissing].map(([currency, count]) => ({ currency, count }))];
  return {
    tab: sp.tab ?? "cashflow",
    period,
    ranges: { r1, r3, r4, r5, r7, r8 },
    incomeVsExpenses,
    incomeVsExpensesSummary: summarize(within(r1.from, r1.to)),
    monthly,
    rate,
    byCategory,
    merchants,
    trend: { rows: trendRows, categories: trendCats.map((c) => ({ key: c.id ?? "none", name: c.name, color: c.color })) },
    daily,
    netWorth,
    netWorthHasData: nw.hasData,
    distribution,
    asOf: { key: asOfKey, date: asOf },
    budget: { month: budgetMonth, items: bm.items.map((i) => ({ name: i.category.name, budget: i.available, actual: i.spent, state: i.state })), months: budgetMonths },
    missing: allMissing.filter((m, i, a) => a.findIndex((x) => x.currency === m.currency) === i),
  };
}
export type AnalyticsData = Awaited<ReturnType<typeof getAnalytics>>;
