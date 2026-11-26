import type { Queryable } from "@/server/db";
import { differenceInCalendarDays, parseISO, subMonths, format } from "date-fns";
import { centsToDecimal, toCents, type Cents } from "@/lib/finance/money";
import { monthlyEquivalent, nextOccurrence, type Frequency } from "@/lib/finance/calculations";
import { normalizeMerchant } from "@/lib/finance/rules";
import type { RateTable } from "@/lib/finance/currency";
import { transactionSchema } from "@/lib/validation";
import { loadRateTable } from "./currency";
import { createTransaction } from "./transactions";
import { audit } from "./audit";
import { UserError } from "./errors";

export interface RecurringRow {
  id: string;
  name: string;
  merchant: string | null;
  amount: string;
  currency: string;
  frequency: Frequency;
  interval_days: number | null;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  account_id: string | null;
  account_name: string | null;
  next_date: string;
  last_paid_date: string | null;
  is_active: boolean;
  notes: string | null;
}

export interface RecurringView extends RecurringRow {
  baseAmount: Cents | null; // one payment in base currency
  monthly: Cents | null; // monthly equivalent in base currency
  annual: Cents | null;
  daysUntil: number;
}

export async function listRecurring(tx: Queryable, userId: string, base: string, today: string, rates?: RateTable): Promise<RecurringView[]> {
  const rows = await tx.query<RecurringRow>(
    `SELECT r.id, r.name, r.merchant, r.amount, r.currency, r.frequency, r.interval_days, r.category_id, c.name AS category_name,
            c.color AS category_color, c.icon AS category_icon, r.account_id, a.name AS account_name, r.next_date, r.last_paid_date, r.is_active, r.notes
       FROM recurring_payments r LEFT JOIN categories c ON c.id = r.category_id LEFT JOIN accounts a ON a.id = r.account_id
      WHERE r.user_id = $1 ORDER BY r.is_active DESC, r.next_date, r.name`,
    [userId],
  );
  const rt = rates ?? (await loadRateTable(tx, userId));
  return rows.map((r) => {
    const amt = r.currency === base ? toCents(r.amount) : (rt.convert(toCents(r.amount), r.currency, base, today)?.cents ?? null);
    const monthly = amt === null ? null : monthlyEquivalent(amt, r.frequency, r.interval_days);
    return { ...r, baseAmount: amt, monthly, annual: monthly === null ? null : monthly * 12, daysUntil: differenceInCalendarDays(parseISO(r.next_date), parseISO(today)) };
  });
}

export function recurringTotals(items: RecurringView[]) {
  const active = items.filter((i) => i.is_active);
  const monthly = active.reduce((s, i) => s + (i.monthly ?? 0), 0);
  return { monthly, annual: monthly * 12, count: active.length, unconverted: active.filter((i) => i.monthly === null).length };
}

type RecurringData = {
  name: string;
  merchant: string | null;
  amount: string;
  currency: string;
  frequency: Frequency;
  intervalDays?: number | null;
  categoryId?: string | null;
  accountId?: string | null;
  nextDate: string;
  isActive: boolean;
  notes: string | null;
};

async function checkRefs(tx: Queryable, userId: string, d: RecurringData) {
  if (d.categoryId) {
    const [c] = await tx.query<{ kind: string }>("SELECT kind FROM categories WHERE id=$1 AND user_id=$2", [d.categoryId, userId]);
    if (!c || c.kind !== "expense") throw new UserError("Choose an expense category.", "categoryId");
  }
  if (d.accountId) {
    const a = await tx.query("SELECT 1 FROM accounts WHERE id=$1 AND user_id=$2", [d.accountId, userId]);
    if (!a.length) throw new UserError("Account not found.", "accountId");
  }
}

export async function saveRecurring(tx: Queryable, userId: string, id: string | null, d: RecurringData) {
  await checkRefs(tx, userId, d);
  const vals = [d.name, d.merchant, d.amount, d.currency, d.frequency, d.frequency === "custom" ? d.intervalDays : null, d.categoryId ?? null, d.accountId ?? null, d.nextDate, d.isActive, d.notes];
  if (id) {
    const r = await tx.query(
      `UPDATE recurring_payments SET name=$1, merchant=$2, amount=$3, currency=$4, frequency=$5, interval_days=$6, category_id=$7, account_id=$8,
              next_date=$9, is_active=$10, notes=$11 WHERE id=$12 AND user_id=$13 RETURNING id`,
      [...vals, id, userId],
    );
    if (!r.length) throw new UserError("Recurring payment not found.");
    await audit(tx, userId, "update", "recurring_payment", id, { name: d.name, amount: d.amount });
    return id;
  }
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO recurring_payments (name, merchant, amount, currency, frequency, interval_days, category_id, account_id, next_date, is_active, notes, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [...vals, userId],
  );
  await audit(tx, userId, "create", "recurring_payment", row.id, { name: d.name, amount: d.amount });
  return row.id;
}

export async function deleteRecurring(tx: Queryable, userId: string, id: string) {
  await tx.query("DELETE FROM recurring_payments WHERE id=$1 AND user_id=$2", [id, userId]);
  await audit(tx, userId, "delete", "recurring_payment", id);
}

/**
 * Mark the current occurrence as paid: optionally record the expense
 * transaction, then advance the next payment date.
 */
export async function markPaid(tx: Queryable, userId: string, id: string, opts: { recordTransaction: boolean; date: string; amount?: string | null }) {
  const [r] = await tx.query<RecurringRow>(
    "SELECT id, name, merchant, amount, currency, frequency, interval_days, category_id, account_id, next_date, is_active FROM recurring_payments WHERE id=$1 AND user_id=$2",
    [id, userId],
  );
  if (!r) throw new UserError("Recurring payment not found.");
  let transactionId: string | null = null;
  if (opts.recordTransaction) {
    if (!r.account_id) throw new UserError("Choose an account for this payment first, so the expense can be recorded.");
    const input = transactionSchema.parse({
      type: "expense",
      amount: opts.amount || r.amount,
      currency: r.currency,
      date: opts.date,
      accountId: r.account_id,
      merchant: r.merchant || r.name,
      categoryId: r.category_id,
      categorySource: r.category_id ? "manual" : "none",
      isReviewed: true,
    });
    transactionId = (await createTransaction(tx, userId, input, { recurringPaymentId: r.id })).id;
  }
  const next = nextOccurrence(r.next_date, r.frequency, r.interval_days);
  await tx.query("UPDATE recurring_payments SET next_date=$1, last_paid_date=$2 WHERE id=$3 AND user_id=$4", [next, opts.date, id, userId]);
  await audit(tx, userId, "mark_paid", "recurring_payment", id, { date: opts.date, transactionId, next });
  return { next, transactionId };
}

export async function skipOccurrence(tx: Queryable, userId: string, id: string) {
  const [r] = await tx.query<RecurringRow>("SELECT next_date, frequency, interval_days FROM recurring_payments WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!r) throw new UserError("Recurring payment not found.");
  const next = nextOccurrence(r.next_date, r.frequency, r.interval_days);
  await tx.query("UPDATE recurring_payments SET next_date=$1 WHERE id=$2 AND user_id=$3", [next, id, userId]);
  return next;
}

export interface RecurringCandidate {
  merchant: string;
  frequency: Frequency;
  averageAmount: string;
  currency: string;
  occurrences: number;
  lastDate: string;
  nextDate: string;
  accountId: string;
  categoryId: string | null;
}

/** Detect repeated expenses with a regular interval and similar amount that aren't tracked yet. */
export async function detectRecurring(tx: Queryable, userId: string, today: string): Promise<RecurringCandidate[]> {
  const since = format(subMonths(parseISO(today), 13), "yyyy-MM-dd");
  const rows = await tx.query<{ merchant: string; date: string; amount: string; currency: string; account_id: string; category_id: string | null; recurring_payment_id: string | null }>(
    `SELECT merchant, date, amount, currency, account_id, category_id, recurring_payment_id FROM transactions
      WHERE user_id=$1 AND type='expense' AND date >= $2 AND merchant <> '' ORDER BY date`,
    [userId, since],
  );
  const tracked = await tx.query<{ name: string; merchant: string | null }>("SELECT name, merchant FROM recurring_payments WHERE user_id=$1", [userId]);
  const trackedKeys = new Set(tracked.flatMap((t) => [normalizeMerchant(t.name), normalizeMerchant(t.merchant ?? "")]).filter(Boolean));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.recurring_payment_id) continue;
    const k = `${normalizeMerchant(r.merchant)}|${r.currency}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: RecurringCandidate[] = [];
  const freqs: [Frequency, number, number][] = [
    ["weekly", 7, 2],
    ["biweekly", 14, 3],
    ["monthly", 30.4, 4],
    ["quarterly", 91, 8],
    ["annually", 365, 15],
  ];
  for (const [key, list] of groups) {
    const name = key.split("|")[0];
    if (list.length < 3 || trackedKeys.has(name)) continue;
    const gaps = list.slice(1).map((r, i) => differenceInCalendarDays(parseISO(r.date), parseISO(list[i].date)));
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const match = freqs.find(([, days, tol]) => Math.abs(median - days) <= tol);
    if (!match) continue;
    const regular = gaps.filter((g) => Math.abs(g - match[1]) <= match[2] * 1.5).length / gaps.length;
    const amounts = list.map((r) => toCents(r.amount));
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const spread = Math.max(...amounts.map((a) => Math.abs(a - avg))) / avg;
    if (regular < 0.75 || spread > 0.2) continue;
    const last = list[list.length - 1];
    if (differenceInCalendarDays(parseISO(today), parseISO(last.date)) > match[1] * 2 + match[2]) continue; // stopped
    out.push({
      merchant: last.merchant,
      frequency: match[0],
      averageAmount: centsToDecimal(Math.round(avg)),
      currency: last.currency,
      occurrences: list.length,
      lastDate: last.date,
      nextDate: nextOccurrence(last.date, match[0]),
      accountId: last.account_id,
      categoryId: last.category_id,
    });
  }
  return out.sort((a, b) => b.occurrences - a.occurrences).slice(0, 10);
}
