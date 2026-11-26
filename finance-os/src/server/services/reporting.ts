/**
 * Reporting: loads reportable movements, converts them to the reporting currency
 * using stored exchange rates, and aggregates with the pure calculation module.
 */
import type { Queryable } from "@/server/db";
import { addDays, addMonths, eachDayOfInterval, endOfMonth, format, parseISO, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { toCents, type Cents } from "@/lib/finance/money";
import { accountClass, isLiquid } from "@/lib/finance/ledger";
import type { RateTable } from "@/lib/finance/currency";
import { netWorth, type ReportLine } from "@/lib/finance/calculations";
import { loadRateTable } from "./currency";
import { listAccounts } from "./accounts";

export interface Missing {
  currency: string;
  count: number;
}

export interface LinesResult {
  lines: ReportLine[];
  missing: Missing[];
}

function addMissing(m: Map<string, number>, c: string) {
  m.set(c, (m.get(c) ?? 0) + 1);
}
const missingList = (m: Map<string, number>): Missing[] => [...m].map(([currency, count]) => ({ currency, count }));

/**
 * Income / expense / refund lines between two dates (inclusive). Split
 * transactions contribute one line per split. Transfers and adjustments are
 * never included.
 */
export async function loadLines(
  tx: Queryable,
  userId: string,
  from: string,
  to: string,
  base: string,
  opts: { rates?: RateTable; accountId?: string } = {},
): Promise<LinesResult> {
  const params: unknown[] = [userId, from, to];
  let accountFilter = "";
  if (opts.accountId) {
    params.push(opts.accountId);
    accountFilter = `AND t.account_id = $${params.length}`;
  }
  const rows = await tx.query<{
    id: string;
    date: string;
    type: "income" | "expense" | "refund";
    amount: string;
    currency: string;
    account_amount: string;
    account_currency: string;
    category_id: string | null;
    merchant: string;
    account_id: string;
    split_amount: string | null;
    split_category: string | null;
  }>(
    `SELECT t.id, t.date, t.type, t.amount, t.currency, t.account_amount, a.currency AS account_currency,
            t.category_id, t.merchant, t.account_id, s.amount AS split_amount, s.category_id AS split_category
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN transaction_splits s ON s.transaction_id = t.id
      WHERE t.user_id = $1 AND t.date BETWEEN $2 AND $3 AND t.type IN ('income','expense','refund') ${accountFilter}
      ORDER BY t.date`,
    params,
  );
  const rates = opts.rates ?? (await loadRateTable(tx, userId));
  const missing = new Map<string, number>();
  const lines: ReportLine[] = [];
  for (const r of rows) {
    const total = toCents(r.amount);
    const part = r.split_amount !== null ? toCents(r.split_amount) : total;
    let cents: Cents | null;
    if (r.currency === base) cents = part;
    else if (r.account_currency === base) cents = Math.round((toCents(r.account_amount) * part) / total); // stored rate
    else cents = rates.convert(part, r.currency, base, r.date)?.cents ?? null;
    if (cents === null) {
      addMissing(missing, r.currency);
      continue;
    }
    lines.push({
      transactionId: r.id,
      date: r.date,
      type: r.type,
      amount: cents,
      categoryId: r.split_amount !== null ? r.split_category : r.category_id,
      merchant: r.merchant,
      accountId: r.account_id,
    });
  }
  return { lines, missing: missingList(missing) };
}

// ------------------------------------------------------------------ buckets
export interface Bucket {
  key: string;
  label: string;
  from: string;
  to: string;
  income: Cents;
  expenses: Cents;
  net: Cents;
}

export function makeBuckets(from: string, to: string, granularity: "day" | "week" | "month"): Bucket[] {
  const out: Bucket[] = [];
  const f = parseISO(from);
  const t = parseISO(to);
  if (granularity === "day") {
    for (const d of eachDayOfInterval({ start: f, end: t })) {
      const k = format(d, "yyyy-MM-dd");
      out.push({ key: k, label: format(d, "d MMM"), from: k, to: k, income: 0, expenses: 0, net: 0 });
    }
  } else if (granularity === "week") {
    let s = startOfWeek(f, { weekStartsOn: 1 });
    while (s <= t) {
      const e = addDays(s, 6);
      const k = format(s, "yyyy-MM-dd");
      out.push({ key: k, label: `${format(s < f ? f : s, "d MMM")}`, from: format(s < f ? f : s, "yyyy-MM-dd"), to: format(e > t ? t : e, "yyyy-MM-dd"), income: 0, expenses: 0, net: 0 });
      s = addDays(s, 7);
    }
  } else {
    let s = startOfMonth(f);
    while (s <= t) {
      const e = endOfMonth(s);
      out.push({
        key: format(s, "yyyy-MM"),
        label: format(s, "MMM yy"),
        from: format(s < f ? f : s, "yyyy-MM-dd"),
        to: format(e > t ? t : e, "yyyy-MM-dd"),
        income: 0,
        expenses: 0,
        net: 0,
      });
      s = addMonths(s, 1);
    }
  }
  return out;
}

export function fillBuckets(buckets: Bucket[], lines: ReportLine[]): Bucket[] {
  for (const l of lines) {
    const b = buckets.find((x) => l.date >= x.from && l.date <= x.to);
    if (!b) continue;
    if (l.type === "income") b.income += l.amount;
    else if (l.type === "expense") b.expenses += l.amount;
    else b.expenses -= l.amount;
  }
  for (const b of buckets) b.net = b.income - b.expenses;
  return buckets;
}

export function monthKeys(endIso: string, count: number): { key: string; from: string; to: string; label: string }[] {
  const end = parseISO(endIso);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const s = startOfMonth(subMonths(end, i));
    out.push({ key: format(s, "yyyy-MM"), from: format(s, "yyyy-MM-dd"), to: format(endOfMonth(s), "yyyy-MM-dd"), label: format(s, "MMM yy") });
  }
  return out;
}

// ------------------------------------------------------------------ net worth
export interface ConvertedAccount {
  id: string;
  name: string;
  type: string;
  cls: "asset" | "liability";
  currency: string;
  balance: Cents; // natural, account currency
  baseBalance: Cents | null; // natural, base currency (null if no rate)
  isArchived: boolean;
  institution: string | null;
}

/** Current balances (ledger as of today) converted to the base currency. */
export async function currentNetWorth(tx: Queryable, userId: string, base: string, today: string, rates?: RateTable) {
  const accounts = await listAccounts(tx, userId, { includeArchived: true, asOf: today });
  const rt = rates ?? (await loadRateTable(tx, userId));
  const missing = new Map<string, number>();
  const converted: ConvertedAccount[] = accounts.map((a) => {
    const conv = a.currency === base ? { cents: a.balance } : rt.convert(a.balance, a.currency, base, today);
    if (!conv && a.balance !== 0) addMissing(missing, a.currency);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      cls: a.cls,
      currency: a.currency,
      balance: a.balance,
      baseBalance: conv ? conv.cents : a.balance === 0 ? 0 : null,
      isArchived: a.is_archived,
      institution: a.institution,
    };
  });
  const totals = netWorth(converted.filter((a) => a.baseBalance !== null).map((a) => ({ cls: a.cls, natural: a.baseBalance! })));
  const liquid = converted.filter((a) => a.cls === "asset" && isLiquid(a.type) && a.baseBalance !== null).reduce((s, a) => s + a.baseBalance!, 0);
  return { accounts: converted, ...totals, liquid, missing: missingList(missing) };
}

/**
 * Net worth at each given date, from recorded balance snapshots (latest snapshot
 * on or before the date). Accounts with no snapshot yet (not opened) count as 0.
 */
export async function netWorthHistory(tx: Queryable, userId: string, base: string, dates: string[], rates?: RateTable) {
  const snaps = await tx.query<{ account_id: string; date: string; balance: string; type: string; currency: string }>(
    `SELECT ab.account_id, ab.date, ab.balance, a.type, a.currency
       FROM account_balances ab JOIN accounts a ON a.id = ab.account_id
      WHERE ab.user_id = $1 ORDER BY ab.account_id, ab.date`,
    [userId],
  );
  const rt = rates ?? (await loadRateTable(tx, userId));
  const byAccount = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const l = byAccount.get(s.account_id) ?? [];
    l.push(s);
    byAccount.set(s.account_id, l);
  }
  const missing = new Map<string, number>();
  const points = dates.map((date) => {
    let assets = 0;
    let liabilities = 0;
    let incomplete = false;
    for (const list of byAccount.values()) {
      let last: (typeof snaps)[number] | null = null;
      for (const s of list) {
        if (s.date <= date) last = s;
        else break;
      }
      if (!last) continue;
      const cents = toCents(last.balance);
      const conv = last.currency === base ? cents : rt.convert(cents, last.currency, base, date)?.cents;
      if (conv === undefined || conv === null) {
        if (cents !== 0) {
          incomplete = true;
          addMissing(missing, last.currency);
        }
        continue;
      }
      if (accountClass(last.type) === "asset") assets += conv;
      else liabilities += conv;
    }
    return { date, assets, liabilities, netWorth: assets - liabilities, incomplete };
  });
  return { points, missing: missingList(missing), hasData: snaps.length > 0 };
}

/** Average monthly expenses over the last `months` complete months. */
export async function averageMonthlyExpenses(tx: Queryable, userId: string, base: string, today: string, months = 3, rates?: RateTable) {
  const keys = monthKeys(format(subMonths(parseISO(today), 1), "yyyy-MM-dd"), months);
  const { lines } = await loadLines(tx, userId, keys[0].from, keys[keys.length - 1].to, base, { rates });
  const firstTx = await tx.query<{ d: string | null }>("SELECT min(date) AS d FROM transactions WHERE user_id=$1 AND type IN ('expense','income')", [userId]);
  const first = firstTx[0]?.d;
  // Only average over months with recorded history to avoid diluting with empty months.
  const active = keys.filter((k) => first && k.to >= first);
  if (!active.length) return { average: 0, months: 0 };
  let expenses = 0;
  for (const l of lines) {
    if (l.date < active[0].from) continue;
    if (l.type === "expense") expenses += l.amount;
    else if (l.type === "refund") expenses -= l.amount;
  }
  return { average: Math.round(expenses / active.length), months: active.length };
}
