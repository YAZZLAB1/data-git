import type { Queryable } from "@/server/db";
import { format, parseISO, subMonths, addMonths } from "date-fns";
import { centsToDecimal, toCents, type Cents } from "@/lib/finance/money";
import { budgetStatus, rolloverChain, spendingByCategory, type BudgetState } from "@/lib/finance/calculations";
import { monthEnd, monthStart } from "@/lib/period";
import type { RateTable } from "@/lib/finance/currency";
import { loadLines, monthKeys, type Missing } from "./reporting";
import { listCategories, type Category } from "./categories";
import { loadRateTable } from "./currency";
import { audit } from "./audit";
import { UserError } from "./errors";

export interface BudgetItem {
  allocationId: string;
  category: Pick<Category, "id" | "name" | "color" | "icon">;
  budgeted: Cents;
  rollover: Cents;
  rolloverEnabled: boolean;
  available: Cents;
  spent: Cents;
  remaining: Cents;
  percent: number;
  state: BudgetState;
}

export interface BudgetMonth {
  month: string;
  exists: boolean;
  items: BudgetItem[];
  unbudgeted: { category: Pick<Category, "id" | "name" | "color" | "icon"> | null; spent: Cents }[];
  totals: { budgeted: Cents; rollover: Cents; available: Cents; spent: Cents; remaining: Cents; percent: number; unbudgetedSpent: Cents };
  missing: Missing[];
  previousBudgetMonth: string | null;
}

/** A month's budget with actual spending, rollover and status per category. */
export async function getBudgetMonth(tx: Queryable, userId: string, month: string, base: string, rates?: RateTable): Promise<BudgetMonth> {
  const m = monthStart(month);
  const rt = rates ?? (await loadRateTable(tx, userId));
  const histStart = format(subMonths(parseISO(m), 12), "yyyy-MM-dd");
  const allocs = await tx.query<{ id: string; month: string; category_id: string; amount: string; rollover: boolean }>(
    `SELECT ba.id, b.month, ba.category_id, ba.amount, ba.rollover
       FROM budget_allocations ba JOIN budgets b ON b.id = ba.budget_id
      WHERE ba.user_id = $1 AND b.month BETWEEN $2 AND $3 ORDER BY b.month`,
    [userId, histStart, m],
  );
  const [budget] = await tx.query<{ id: string }>("SELECT id FROM budgets WHERE user_id=$1 AND month=$2", [userId, m]);
  const [prev] = await tx.query<{ month: string }>(
    "SELECT b.month FROM budgets b WHERE b.user_id=$1 AND b.month < $2 AND EXISTS (SELECT 1 FROM budget_allocations ba WHERE ba.budget_id=b.id) ORDER BY b.month DESC LIMIT 1",
    [userId, m],
  );
  const { lines, missing } = await loadLines(tx, userId, histStart, monthEnd(m), base, { rates: rt });
  const months = monthKeys(m, 13);
  const spendByMonth = new Map<string, Map<string | null, Cents>>();
  for (const k of months) spendByMonth.set(k.key, spendingByCategory(lines.filter((l) => l.date >= k.from && l.date <= k.to)));
  const cats = await listCategories(tx, userId, { includeArchived: true });
  const catMap = new Map(cats.map((c) => [c.id, c]));
  const key = m.slice(0, 7);
  const current = allocs.filter((a) => a.month === m);
  const items: BudgetItem[] = current
    .filter((a) => catMap.has(a.category_id))
    .map((a) => {
      // rollover chain over previous months for this category
      const history = months
        .filter((k) => k.key < key)
        .map((k) => {
          const al = allocs.find((x) => x.category_id === a.category_id && x.month.slice(0, 7) === k.key);
          return { budgeted: al ? toCents(al.amount) : 0, spent: spendByMonth.get(k.key)?.get(a.category_id) ?? 0, rollover: !!al?.rollover };
        });
      const carry = a.rollover ? rolloverChain(history) : 0;
      const spent = Math.max(0, spendByMonth.get(key)?.get(a.category_id) ?? 0);
      const s = budgetStatus(toCents(a.amount), spent, carry);
      const c = catMap.get(a.category_id)!;
      return {
        allocationId: a.id,
        category: { id: c.id, name: c.name, color: c.color, icon: c.icon },
        budgeted: s.budgeted,
        rollover: s.rollover,
        rolloverEnabled: a.rollover,
        available: s.available,
        spent: s.spent,
        remaining: s.remaining,
        percent: s.percent,
        state: s.state,
      };
    })
    .sort((x, y) => y.percent - x.percent);
  const budgetedIds = new Set(current.map((a) => a.category_id));
  const unbudgeted = [...(spendByMonth.get(key) ?? new Map())]
    .filter(([id, v]) => v > 0 && (id === null || (!budgetedIds.has(id) && catMap.get(id)?.kind === "expense")))
    .map(([id, spent]) => {
      const c = id ? catMap.get(id) : null;
      return { category: c ? { id: c.id, name: c.name, color: c.color, icon: c.icon } : null, spent };
    })
    .sort((a, b) => b.spent - a.spent);
  const t = items.reduce(
    (acc, i) => ({ budgeted: acc.budgeted + i.budgeted, rollover: acc.rollover + i.rollover, available: acc.available + i.available, spent: acc.spent + i.spent }),
    { budgeted: 0, rollover: 0, available: 0, spent: 0 },
  );
  return {
    month: m,
    exists: !!budget && items.length > 0,
    items,
    unbudgeted,
    totals: {
      ...t,
      remaining: t.available - t.spent,
      percent: t.available > 0 ? (t.spent / t.available) * 100 : 0,
      unbudgetedSpent: unbudgeted.reduce((s, u) => s + u.spent, 0),
    },
    missing,
    previousBudgetMonth: prev?.month ?? null,
  };
}

async function ensureBudget(tx: Queryable, userId: string, month: string) {
  const [b] = await tx.query<{ id: string }>(
    `INSERT INTO budgets (user_id, month) VALUES ($1,$2) ON CONFLICT (user_id, month) DO UPDATE SET updated_at = now() RETURNING id`,
    [userId, monthStart(month)],
  );
  return b.id;
}

export async function upsertAllocation(tx: Queryable, userId: string, d: { month: string; categoryId: string; amount: string; rollover: boolean }) {
  const [c] = await tx.query<{ kind: string }>("SELECT kind FROM categories WHERE id=$1 AND user_id=$2", [d.categoryId, userId]);
  if (!c) throw new UserError("Category not found.");
  if (c.kind !== "expense") throw new UserError("Budgets are for expense categories.");
  const budgetId = await ensureBudget(tx, userId, d.month);
  await tx.query(
    `INSERT INTO budget_allocations (user_id, budget_id, category_id, amount, rollover) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (budget_id, category_id) DO UPDATE SET amount = EXCLUDED.amount, rollover = EXCLUDED.rollover`,
    [userId, budgetId, d.categoryId, d.amount, d.rollover],
  );
  await audit(tx, userId, "upsert", "budget_allocation", budgetId, { month: monthStart(d.month), categoryId: d.categoryId, amount: d.amount, rollover: d.rollover });
}

export async function removeAllocation(tx: Queryable, userId: string, allocationId: string) {
  await tx.query("DELETE FROM budget_allocations WHERE id=$1 AND user_id=$2", [allocationId, userId]);
  await audit(tx, userId, "delete", "budget_allocation", allocationId);
}

/** Copy allocations from the most recent earlier budget into `month` (existing ones are kept). */
export async function copyPreviousBudget(tx: Queryable, userId: string, month: string) {
  const m = monthStart(month);
  const [prev] = await tx.query<{ id: string; month: string }>(
    "SELECT b.id, b.month FROM budgets b WHERE b.user_id=$1 AND b.month < $2 AND EXISTS (SELECT 1 FROM budget_allocations ba WHERE ba.budget_id=b.id) ORDER BY b.month DESC LIMIT 1",
    [userId, m],
  );
  if (!prev) throw new UserError("There's no earlier budget to copy.");
  const budgetId = await ensureBudget(tx, userId, m);
  const r = await tx.query(
    `INSERT INTO budget_allocations (user_id, budget_id, category_id, amount, rollover)
     SELECT user_id, $1, category_id, amount, rollover FROM budget_allocations WHERE budget_id = $2 AND user_id = $3
     ON CONFLICT (budget_id, category_id) DO NOTHING RETURNING id`,
    [budgetId, prev.id, userId],
  );
  await audit(tx, userId, "copy", "budget", budgetId, { from: prev.month, count: r.length });
  return { copied: r.length, from: prev.month };
}

/** Suggest allocations from the average of the last 3 complete months, rounded up to 50. */
export async function fillFromAverages(tx: Queryable, userId: string, month: string, base: string, rollover: boolean) {
  const m = monthStart(month);
  const keys = monthKeys(format(subMonths(parseISO(m), 1), "yyyy-MM-dd"), 3);
  const { lines } = await loadLines(tx, userId, keys[0].from, keys[2].to, base);
  const spend = spendingByCategory(lines);
  const cats = (await listCategories(tx, userId)).filter((c) => c.kind === "expense");
  let n = 0;
  for (const c of cats) {
    const avg = Math.round((spend.get(c.id) ?? 0) / 3);
    if (avg <= 0) continue;
    const rounded = Math.ceil(avg / 5000) * 5000;
    const existing = await tx.query(
      "SELECT 1 FROM budget_allocations ba JOIN budgets b ON b.id=ba.budget_id WHERE b.user_id=$1 AND b.month=$2 AND ba.category_id=$3",
      [userId, m, c.id],
    );
    if (existing.length) continue;
    await upsertAllocation(tx, userId, { month: m, categoryId: c.id, amount: centsToDecimal(rounded), rollover });
    n++;
  }
  if (n === 0) throw new UserError("No spending in the last 3 months to base a budget on.");
  return n;
}

/** Budgeted vs actual totals for recent months (history view). */
export async function budgetHistory(tx: Queryable, userId: string, endMonth: string, count: number, base: string) {
  const rates = await loadRateTable(tx, userId);
  const out = [];
  let m = format(subMonths(parseISO(monthStart(endMonth)), count - 1), "yyyy-MM-dd");
  for (let i = 0; i < count; i++) {
    const bm = await getBudgetMonth(tx, userId, m, base, rates);
    out.push({ month: m, budgeted: bm.totals.available, spent: bm.totals.spent, hasBudget: bm.exists });
    m = format(addMonths(parseISO(m), 1), "yyyy-MM-dd");
  }
  return out;
}
