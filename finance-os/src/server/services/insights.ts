/**
 * Rule-based financial insights. Every insight is computed from recorded
 * transactions, balances, budgets, recurring payments and goals. Projections
 * and scenarios are labelled as such and state their assumptions.
 */
import type { Queryable } from "@/server/db";
import { format, parseISO, subMonths } from "date-fns";
import { formatMoney, type Cents } from "@/lib/finance/money";
import { daysLeftInMonth, percentChange, projectMonthTotal, spendingByCategory, summarize } from "@/lib/finance/calculations";
import { monthStart } from "@/lib/period";
import { loadRateTable } from "./currency";
import { averageMonthlyExpenses, currentNetWorth, loadLines, monthKeys } from "./reporting";
import { getBudgetMonth } from "./budgets";
import { listRecurring, recurringTotals, detectRecurring } from "./recurring";
import { listGoals } from "./goals";
import { listCategories } from "./categories";

export type InsightType = "spending" | "budget" | "savings" | "recurring" | "cash_flow" | "goals" | "data_quality";
export interface Insight {
  fingerprint: string;
  type: InsightType;
  priority: "high" | "medium" | "low";
  basis: "actual" | "projection" | "scenario";
  title: string;
  body: string;
  figures: { label: string; value: string }[];
  assumptions?: string;
  action?: { label: string; href: string };
}

export interface StoredInsight extends Insight {
  id: string;
  status: "active" | "dismissed" | "completed";
  generated_at: string;
}

interface Ctx {
  base: string;
  locale: string;
  today: string;
}

const pct = (n: number) => `${Math.abs(n) < 10 ? Math.abs(n).toFixed(1) : Math.round(Math.abs(n))}%`;

export async function computeInsights(tx: Queryable, userId: string, ctx: Ctx): Promise<Insight[]> {
  const { base, today } = ctx;
  const m = (c: Cents) => formatMoney(c, base, { locale: ctx.locale });
  const rates = await loadRateTable(tx, userId);
  const out: Insight[] = [];
  const monthKey = today.slice(0, 7);
  const thisFrom = monthStart(today);
  const last = monthKeys(format(subMonths(parseISO(today), 1), "yyyy-MM-dd"), 3); // [m-3, m-2, m-1]
  const lastMonth = last[2];
  const prevMonth = last[1];
  const { lines: all, missing } = await loadLines(tx, userId, last[0].from, today, base, { rates });
  const inRange = (from: string, to: string) => all.filter((l) => l.date >= from && l.date <= to);
  const cur = inRange(thisFrom, today);
  const lm = inRange(lastMonth.from, lastMonth.to);
  const pm = inRange(prevMonth.from, prevMonth.to);
  const cats = await listCategories(tx, userId, { includeArchived: true });
  const catName = (id: string | null) => (id ? (cats.find((c) => c.id === id)?.name ?? "Uncategorized") : "Uncategorized");
  const curSpend = spendingByCategory(cur);
  const lmSpend = spendingByCategory(lm);
  const pmSpend = spendingByCategory(pm);
  const dayOfMonth = parseISO(today).getDate();
  const threshold = 10000; // ignore movements smaller than 100 units of the base currency

  // 1. Category pace projections (after the first week of the month).
  if (dayOfMonth >= 7) {
    const candidates: Insight[] = [];
    for (const [id, spent] of curSpend) {
      const prev = lmSpend.get(id) ?? 0;
      if (spent <= 0 || prev <= 0) continue;
      const { projected, daysElapsed, daysInMonth } = projectMonthTotal(spent, today);
      if (projected > prev * 1.2 && projected - prev >= threshold) {
        candidates.push({
          fingerprint: `pace:${monthKey}:${id}`,
          type: "spending",
          priority: projected > prev * 1.5 && projected - prev >= threshold * 5 ? "high" : "medium",
          basis: "projection",
          title: `${catName(id)} spending is running ahead of last month`,
          body: `If your ${catName(id).toLowerCase()} spending continues at its current pace, you could spend about ${m(projected)} this month, compared with ${m(prev)} last month.`,
          figures: [
            { label: "Spent so far", value: m(spent) },
            { label: "Projected month total", value: m(projected) },
            { label: `${format(parseISO(lastMonth.from), "MMMM")} total`, value: m(prev) },
          ],
          assumptions: `Assumes you keep spending at this month's daily average (${daysElapsed} of ${daysInMonth} days elapsed).`,
          action: id ? { label: "View transactions", href: `/transactions?category=${id}&from=${thisFrom}&to=${today}` } : undefined,
        });
      }
    }
    out.push(...candidates.sort((a, b) => (a.priority === "high" ? -1 : 1) - (b.priority === "high" ? -1 : 1)).slice(0, 3));
  }

  // 2. Budget warnings for the current month.
  const budget = await getBudgetMonth(tx, userId, today, base, rates);
  const daysLeft = daysLeftInMonth(today);
  for (const item of budget.items) {
    if (item.state === "ok" || item.available <= 0) continue;
    const over = item.state === "over";
    out.push({
      fingerprint: `budget:${monthKey}:${item.category.id}:${item.state}`,
      type: "budget",
      priority: over ? "high" : "medium",
      basis: "actual",
      title: over ? `${item.category.name} budget exceeded` : `${item.category.name} budget is ${Math.round(item.percent)}% used`,
      body: over
        ? `You've spent ${m(item.spent)} against a ${m(item.available)} budget — ${m(-item.remaining)} over, with ${daysLeft} day${daysLeft === 1 ? "" : "s"} left this month.`
        : `You have already used ${Math.round(item.percent)}% of your ${item.category.name.toLowerCase()} budget, with ${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining.`,
      figures: [
        { label: "Budget", value: m(item.available) },
        { label: "Spent", value: m(item.spent) },
        { label: over ? "Over by" : "Remaining", value: m(Math.abs(item.remaining)) },
      ],
      action: { label: "Open budget", href: `/budgets?month=${thisFrom}` },
    });
  }

  // 3. Recurring commitments.
  const recurring = await listRecurring(tx, userId, base, today, rates);
  const rt = recurringTotals(recurring);
  if (rt.count > 0) {
    const s = summarize(lm);
    const share = s.income > 0 ? (rt.monthly / s.income) * 100 : null;
    out.push({
      fingerprint: `recurring:${monthKey}:${rt.monthly}`,
      type: "recurring",
      priority: share !== null && share > 50 ? "high" : "low",
      basis: "actual",
      title: "Your recurring commitments",
      body: `Your ${rt.count} active recurring payment${rt.count === 1 ? "" : "s"} currently represent ${m(rt.monthly)} per month (${m(rt.annual)} per year)${share !== null ? `, or ${pct(share)} of last month's income` : ""}.`,
      figures: [
        { label: "Monthly", value: m(rt.monthly) },
        { label: "Annual", value: m(rt.annual) },
        ...(share !== null ? [{ label: "Share of income", value: pct(share) }] : []),
      ],
      action: { label: "Review recurring payments", href: "/recurring" },
    });
  }
  const candidates = await detectRecurring(tx, userId, today);
  if (candidates.length) {
    out.push({
      fingerprint: `recurring-detect:${candidates.map((c) => c.merchant).join(",")}`,
      type: "recurring",
      priority: "low",
      basis: "actual",
      title: `${candidates.length} possible recurring payment${candidates.length === 1 ? "" : "s"} found`,
      body: `These merchants charge you at a regular interval but aren't tracked yet: ${candidates
        .slice(0, 4)
        .map((c) => c.merchant)
        .join(", ")}.`,
      figures: candidates.slice(0, 3).map((c) => ({ label: c.merchant, value: `${c.averageAmount} ${c.currency} · ${c.frequency}` })),
      action: { label: "Review suggestions", href: "/recurring#suggestions" },
    });
  }

  // 4. Month-over-month category changes (complete months).
  const changes: Insight[] = [];
  for (const [id, now] of lmSpend) {
    const before = pmSpend.get(id) ?? 0;
    if (before <= 0 || now <= 0) continue;
    const ch = percentChange(now, before)!;
    if (Math.abs(ch) >= 15 && Math.abs(now - before) >= threshold) {
      changes.push({
        fingerprint: `mom:${lastMonth.key}:${id}:${ch > 0 ? "up" : "down"}`,
        type: "spending",
        priority: ch > 40 ? "medium" : "low",
        basis: "actual",
        title: `${catName(id)} ${ch > 0 ? "increased" : "decreased"} ${pct(ch)} in ${format(parseISO(lastMonth.from), "MMMM")}`,
        body: `Your ${catName(id).toLowerCase()} expenses ${ch > 0 ? "increased" : "decreased"} by ${pct(ch)} compared with the previous month (${m(before)} → ${m(now)}).`,
        figures: [
          { label: format(parseISO(prevMonth.from), "MMMM"), value: m(before) },
          { label: format(parseISO(lastMonth.from), "MMMM"), value: m(now) },
          { label: "Change", value: `${ch > 0 ? "+" : "−"}${m(Math.abs(now - before))}` },
        ],
        action: id ? { label: "View transactions", href: `/transactions?category=${id}&from=${lastMonth.from}&to=${lastMonth.to}` } : undefined,
      });
    }
  }
  out.push(...changes.sort((a, b) => b.figures[2].value.length - a.figures[2].value.length).slice(0, 3));

  // 5. Savings rate reinforcement / warning (complete months).
  const sl = summarize(lm);
  const sp = summarize(pm);
  if (sl.savingsRate !== null && sp.savingsRate !== null) {
    if (sl.savingsRate > sp.savingsRate && sl.savingsRate > 0) {
      out.push({
        fingerprint: `savings-up:${lastMonth.key}`,
        type: "savings",
        priority: "low",
        basis: "actual",
        title: "Your savings rate improved",
        body: `You saved ${pct(sl.savingsRate)} of your income in ${format(parseISO(lastMonth.from), "MMMM")}, up from ${pct(sp.savingsRate)} the month before.`,
        figures: [
          { label: "Income", value: m(sl.income) },
          { label: "Expenses", value: m(sl.expenses) },
          { label: "Net savings", value: m(sl.net) },
        ],
      });
    } else if (sl.savingsRate < 0) {
      out.push({
        fingerprint: `savings-negative:${lastMonth.key}`,
        type: "savings",
        priority: "high",
        basis: "actual",
        title: `You spent more than you earned in ${format(parseISO(lastMonth.from), "MMMM")}`,
        body: `Expenses were ${m(sl.expenses)} against ${m(sl.income)} of income, a shortfall of ${m(-sl.net)}.`,
        figures: [
          { label: "Income", value: m(sl.income) },
          { label: "Expenses", value: m(sl.expenses) },
          { label: "Shortfall", value: m(-sl.net) },
        ],
        action: { label: "See where it went", href: `/analytics?tab=spending` },
      });
    }
  }

  // 6. Discretionary scenario (last 3 complete months).
  const discretionary = new Set(cats.filter((c) => c.is_discretionary).map((c) => c.id));
  const threeMonths = inRange(last[0].from, lastMonth.to);
  const disc = [...spendingByCategory(threeMonths)].filter(([id]) => id && discretionary.has(id)).reduce((s, [, v]) => s + v, 0);
  const discMonthly = Math.round(disc / 3);
  if (discMonthly >= threshold * 5) {
    const saving = Math.round((discMonthly * 0.2) / 1000) * 1000;
    out.push({
      fingerprint: `scenario-discretionary:${lastMonth.key}`,
      type: "savings",
      priority: "low",
      basis: "scenario",
      title: `Reducing discretionary spending by 20% could free about ${m(saving)} a month`,
      body: `You spent an average of ${m(discMonthly)} per month on discretionary categories (restaurants, shopping, entertainment, travel and similar) over the last 3 months.`,
      figures: [
        { label: "Monthly average", value: m(discMonthly) },
        { label: "20% reduction", value: m(saving) },
        { label: "Per year", value: m(saving * 12) },
      ],
      assumptions: "Hypothetical scenario based on your last 3 complete months. Not a guaranteed saving.",
      action: { label: "Set budgets", href: "/budgets" },
    });
  }

  // 7. Cash-flow projection for this month.
  if (dayOfMonth >= 7) {
    const sc = summarize(cur);
    const { projected } = projectMonthTotal(sc.expenses, today);
    const avgIncome = Math.round(summarize(threeMonths).income / 3);
    const expectedIncome = Math.max(sc.income, avgIncome);
    if (projected > expectedIncome && expectedIncome > 0) {
      out.push({
        fingerprint: `cashflow:${monthKey}`,
        type: "cash_flow",
        priority: "high",
        basis: "projection",
        title: "Projected expenses are higher than expected income this month",
        body: `At the current pace, expenses could reach about ${m(projected)} this month, above the ${m(expectedIncome)} of income you'd expect based on recent months.`,
        figures: [
          { label: "Expenses so far", value: m(sc.expenses) },
          { label: "Projected expenses", value: m(projected) },
          { label: "Expected income", value: m(expectedIncome) },
        ],
        assumptions: "Projects this month's daily spending pace to month end; expected income is the higher of income received so far and your 3-month average.",
      });
    }
  }

  // 8. Goals.
  const goals = (await listGoals(tx, userId, today)).filter((g) => g.status === "active" && g.remaining > 0);
  for (const g of goals.slice(0, 4)) {
    const gm = (c: Cents) => formatMoney(c, g.currency, { locale: ctx.locale });
    if (g.requiredMonthly && g.target_date) {
      const behind = g.averageMonthly < g.requiredMonthly;
      out.push({
        fingerprint: `goal:${g.id}:${monthKey}`,
        type: "goals",
        priority: behind && (g.monthsLeft ?? 99) <= 6 ? "high" : behind ? "medium" : "low",
        basis: "projection",
        title: `${g.name}: contribute ${gm(g.requiredMonthly)} a month to stay on schedule`,
        body: `To reach your ${g.name.toLowerCase()} goal by ${format(parseISO(g.target_date), "MMMM yyyy")}, you should contribute about ${gm(g.requiredMonthly)} monthly. You've contributed an average of ${gm(g.averageMonthly)} per month over the last 3 months.`,
        figures: [
          { label: "Saved", value: `${gm(g.saved)} of ${gm(g.target)}` },
          { label: "Months left", value: String(g.monthsLeft) },
          { label: "Needed monthly", value: gm(g.requiredMonthly) },
        ],
        assumptions: "Divides the remaining amount evenly over the months left until the target date.",
        action: { label: "Add contribution", href: "/goals" },
      });
    }
  }

  // 9. Emergency fund coverage.
  const nw = await currentNetWorth(tx, userId, base, today, rates);
  const avg = await averageMonthlyExpenses(tx, userId, base, today, 3, rates);
  if (avg.average > 0) {
    const months = nw.liquid / avg.average;
    if (months < 3) {
      out.push({
        fingerprint: `emergency:${monthKey}`,
        type: "savings",
        priority: months < 1 ? "high" : "medium",
        basis: "actual",
        title: `Your cash covers about ${months.toFixed(1)} months of expenses`,
        body: `Cash, checking and savings balances total ${m(nw.liquid)}, against average monthly expenses of ${m(avg.average)}. Many people aim for 3–6 months of expenses in accessible savings.`,
        figures: [
          { label: "Liquid balances", value: m(nw.liquid) },
          { label: "Avg monthly expenses", value: m(avg.average) },
          { label: "3 months target", value: m(avg.average * 3) },
        ],
        action: { label: "Create an emergency fund goal", href: "/goals" },
      });
    }
  }

  // 10. Data quality.
  const [{ n: uncategorized }] = await tx.query<{ n: number }>(
    `SELECT count(*) AS n FROM transactions t WHERE t.user_id=$1 AND t.type IN ('income','expense','refund') AND t.category_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id)`,
    [userId],
  );
  if (Number(uncategorized) > 0) {
    out.push({
      fingerprint: `uncategorized:${uncategorized}`,
      type: "data_quality",
      priority: Number(uncategorized) > 10 ? "medium" : "low",
      basis: "actual",
      title: `${uncategorized} transaction${Number(uncategorized) === 1 ? " needs" : "s need"} a category`,
      body: "Uncategorized transactions appear as “Uncategorized” in reports and can't count towards budgets.",
      figures: [{ label: "Uncategorized", value: String(uncategorized) }],
      action: { label: "Categorize now", href: "/transactions?category=uncategorized" },
    });
  }
  for (const mi of [...missing, ...nw.missing]) {
    out.push({
      fingerprint: `missing-rate:${mi.currency}:${base}`,
      type: "data_quality",
      priority: "medium",
      basis: "actual",
      title: `Add a ${mi.currency}→${base} exchange rate`,
      body: `${mi.count} ${mi.currency} amount${mi.count === 1 ? " is" : "s are"} left out of your ${base} reports because no exchange rate is stored. Amounts in different currencies are never added together directly.`,
      figures: [{ label: "Amounts excluded", value: String(mi.count) }],
      action: { label: "Add exchange rate", href: "/settings?tab=currencies" },
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.fingerprint) ? false : (seen.add(i.fingerprint), true))).sort((a, b) => order[a.priority] - order[b.priority]);
}

/** Recompute insights and persist them, keeping the user's dismiss/complete decisions. */
export async function refreshInsights(tx: Queryable, userId: string, ctx: Ctx): Promise<StoredInsight[]> {
  const fresh = await computeInsights(tx, userId, ctx);
  for (const i of fresh) {
    await tx.query(
      `INSERT INTO recommendations (user_id, fingerprint, type, priority, basis, title, body, figures, assumptions, action, generated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (user_id, fingerprint) DO UPDATE SET type=EXCLUDED.type, priority=EXCLUDED.priority, basis=EXCLUDED.basis, title=EXCLUDED.title,
         body=EXCLUDED.body, figures=EXCLUDED.figures, assumptions=EXCLUDED.assumptions, action=EXCLUDED.action,
         generated_at = CASE WHEN recommendations.body = EXCLUDED.body THEN recommendations.generated_at ELSE now() END`,
      [userId, i.fingerprint, i.type, i.priority, i.basis, i.title, i.body, JSON.stringify(i.figures), i.assumptions ?? null, i.action ? JSON.stringify(i.action) : null],
    );
  }
  // Active insights that no longer apply are removed; dismissed/completed ones are kept as history.
  await tx.query("DELETE FROM recommendations WHERE user_id=$1 AND status='active' AND NOT (fingerprint = ANY($2::text[]))", [userId, fresh.map((f) => f.fingerprint)]);
  return listStoredInsights(tx, userId);
}

export async function listStoredInsights(tx: Queryable, userId: string): Promise<StoredInsight[]> {
  const rows = await tx.query<StoredInsight & { assumptions: string | null; action: Insight["action"] | null }>(
    `SELECT id, fingerprint, type, priority, basis, title, body, figures, assumptions, action, status, generated_at
       FROM recommendations WHERE user_id=$1
      ORDER BY status, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, generated_at DESC LIMIT 200`,
    [userId],
  );
  return rows.map((r) => ({ ...r, assumptions: r.assumptions ?? undefined, action: r.action ?? undefined }));
}

export async function setInsightStatus(tx: Queryable, userId: string, id: string, status: "active" | "dismissed" | "completed") {
  await tx.query("UPDATE recommendations SET status=$1 WHERE id=$2 AND user_id=$3", [status, id, userId]);
}

