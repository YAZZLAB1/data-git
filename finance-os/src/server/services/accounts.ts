import type { Queryable } from "@/server/db";
import { accountClass, naturalBalance, openingValue, type AccountType } from "@/lib/finance/ledger";
import { centsToDecimal, toCents, type Cents } from "@/lib/finance/money";
import { addDays, format, parseISO } from "date-fns";
import { audit } from "./audit";
import { UserError } from "./errors";

export interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  currency: string;
  opening_balance: string;
  opening_date: string;
  notes: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Account extends AccountRow {
  cls: "asset" | "liability";
  /** Natural balance in the account currency: owed amount for liabilities. */
  balance: Cents;
  transactionCount: number;
  lastActivity: string | null;
}

const COLS = "a.id, a.name, a.type, a.institution, a.currency, a.opening_balance, a.opening_date, a.notes, a.is_archived, a.created_at, a.updated_at";

/** Accounts with balances computed from the opening balance and the full ledger. */
export async function listAccounts(tx: Queryable, userId: string, opts: { includeArchived?: boolean; asOf?: string } = {}): Promise<Account[]> {
  const params: unknown[] = [userId];
  let dateFilter = "";
  if (opts.asOf) {
    params.push(opts.asOf);
    dateFilter = `AND le.date <= $${params.length}`;
  }
  const rows = await tx.query<AccountRow & { delta: string | null; n: number; last: string | null }>(
    `SELECT ${COLS}, agg.delta, coalesce(agg.n,0) AS n, agg.last
       FROM accounts a
       LEFT JOIN (SELECT le.account_id, sum(le.delta) AS delta, count(*) AS n, max(le.date) AS last
                    FROM ledger_entries le WHERE le.user_id = $1 ${dateFilter} GROUP BY le.account_id) agg
         ON agg.account_id = a.id
      WHERE a.user_id = $1 ${opts.includeArchived ? "" : "AND NOT a.is_archived"}
      ORDER BY a.is_archived, CASE WHEN a.type IN ('credit_card','personal_loan','mortgage','other_liability') THEN 1 ELSE 0 END, a.name`,
    params,
  );
  return rows.map((r) => {
    const cls = accountClass(r.type);
    const value = openingValue(cls, toCents(r.opening_balance)) + toCents(r.delta);
    return { ...r, cls, balance: naturalBalance(cls, value), transactionCount: Number(r.n), lastActivity: r.last };
  });
}

export async function getAccount(tx: Queryable, userId: string, id: string): Promise<Account> {
  const all = await listAccounts(tx, userId, { includeArchived: true });
  const a = all.find((x) => x.id === id);
  if (!a) throw new UserError("Account not found.");
  return a;
}

export async function getAccountRow(tx: Queryable, userId: string, id: string): Promise<AccountRow> {
  const [a] = await tx.query<AccountRow>(`SELECT ${COLS} FROM accounts a WHERE a.id=$1 AND a.user_id=$2`, [id, userId]);
  if (!a) throw new UserError("Account not found.");
  return a;
}

/**
 * Rebuild recorded end-of-day balance snapshots for one account from its opening
 * balance and ledger. The opening snapshot is stored on the day before the opening
 * date (= balance at the start of the opening date).
 */
export async function rebuildSnapshots(tx: Queryable, userId: string, accountId: string) {
  // Lock the account so concurrent writers rebuild one after another; under READ COMMITTED
  // the later rebuild then sees the earlier transaction's committed rows. NO KEY UPDATE (not
  // UPDATE) so it doesn't conflict with the KEY SHARE locks that transaction inserts take via
  // their foreign keys, which would otherwise deadlock two writers on the same account.
  await tx.query("SELECT id FROM accounts WHERE id=$1 AND user_id=$2 FOR NO KEY UPDATE", [accountId, userId]);
  const a = await getAccountRow(tx, userId, accountId);
  const cls = accountClass(a.type);
  await tx.query("DELETE FROM account_balances WHERE account_id=$1 AND user_id=$2", [accountId, userId]);
  const days = await tx.query<{ date: string; delta: string; adj: boolean }>(
    `SELECT le.date, sum(le.delta) AS delta,
            bool_or(EXISTS (SELECT 1 FROM transactions t WHERE t.id = le.transaction_id AND t.type='adjustment')) AS adj
       FROM ledger_entries le WHERE le.account_id=$1 AND le.user_id=$2 GROUP BY le.date ORDER BY le.date`,
    [accountId, userId],
  );
  let value = openingValue(cls, toCents(a.opening_balance));
  const rows: [string, string, string][] = [[format(addDays(parseISO(a.opening_date), -1), "yyyy-MM-dd"), centsToDecimal(naturalBalance(cls, value)), "opening"]];
  for (const d of days) {
    value += toCents(d.delta);
    rows.push([d.date, centsToDecimal(naturalBalance(cls, value)), d.adj ? "adjustment" : "ledger"]);
  }
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    const params: unknown[] = [userId, accountId];
    const values = chunk.map((r) => {
      params.push(r[0], r[1], r[2]);
      const n = params.length;
      return `($1,$2,$${n - 2},$${n - 1},$${n})`;
    });
    await tx.query(
      `INSERT INTO account_balances (user_id, account_id, date, balance, source) VALUES ${values.join(",")}
       ON CONFLICT (account_id, date) DO UPDATE SET balance = EXCLUDED.balance, source = EXCLUDED.source`,
      params,
    );
  }
}

/** Rebuild several accounts in a stable order (avoids lock-order deadlocks between transfers). */
export async function rebuildAccounts(tx: Queryable, userId: string, ids: Iterable<string>) {
  for (const id of [...new Set(ids)].sort()) await rebuildSnapshots(tx, userId, id);
}

export async function createAccount(
  tx: Queryable,
  userId: string,
  d: { name: string; type: AccountType; institution: string | null; currency: string; openingBalance: string; openingDate: string; notes: string | null },
) {
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO accounts (user_id, name, type, institution, currency, opening_balance, opening_date, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [userId, d.name, d.type, d.institution, d.currency, d.openingBalance, d.openingDate, d.notes],
  );
  await rebuildSnapshots(tx, userId, row.id);
  await audit(tx, userId, "create", "account", row.id, { name: d.name, type: d.type, openingBalance: d.openingBalance, currency: d.currency });
  return row.id;
}

export async function updateAccount(
  tx: Queryable,
  userId: string,
  id: string,
  d: { name: string; type: AccountType; institution: string | null; currency: string; openingBalance: string; openingDate: string; notes: string | null },
) {
  const before = await getAccountRow(tx, userId, id);
  const [{ n, first }] = await tx.query<{ n: number; first: string | null }>(
    "SELECT count(*) AS n, min(date) AS first FROM ledger_entries WHERE account_id=$1 AND user_id=$2",
    [id, userId],
  );
  if (d.currency !== before.currency && Number(n) > 0)
    throw new UserError("You can't change the currency of an account that has transactions. Create a new account instead.", "currency");
  if (accountClass(d.type) !== accountClass(before.type) && Number(n) > 0)
    throw new UserError("You can't switch an account between asset and liability once it has transactions.", "type");
  if (first && d.openingDate > first)
    throw new UserError(`The opening date must be on or before the first transaction (${first}).`, "openingDate");
  await tx.query(
    `UPDATE accounts SET name=$1, type=$2, institution=$3, currency=$4, opening_balance=$5, opening_date=$6, notes=$7
      WHERE id=$8 AND user_id=$9`,
    [d.name, d.type, d.institution, d.currency, d.openingBalance, d.openingDate, d.notes, id, userId],
  );
  await rebuildSnapshots(tx, userId, id);
  await audit(tx, userId, "update", "account", id, {
    before: { name: before.name, openingBalance: before.opening_balance, openingDate: before.opening_date },
    after: { name: d.name, openingBalance: d.openingBalance, openingDate: d.openingDate },
  });
}

export async function setArchived(tx: Queryable, userId: string, id: string, archived: boolean) {
  await getAccountRow(tx, userId, id);
  await tx.query("UPDATE accounts SET is_archived=$1 WHERE id=$2 AND user_id=$3", [archived, id, userId]);
  await audit(tx, userId, archived ? "archive" : "unarchive", "account", id);
}

/** Accounts with transactions can't be deleted (history must stay intact); archive them instead. */
export async function deleteAccount(tx: Queryable, userId: string, id: string) {
  const a = await getAccountRow(tx, userId, id);
  const [{ n }] = await tx.query<{ n: number }>(
    "SELECT count(*) AS n FROM transactions WHERE user_id=$1 AND (account_id=$2 OR to_account_id=$2)",
    [userId, id],
  );
  if (Number(n) > 0)
    throw new UserError(`"${a.name}" has ${n} transaction${Number(n) === 1 ? "" : "s"}. Archive it to keep your history, or delete its transactions first.`);
  await tx.query("DELETE FROM accounts WHERE id=$1 AND user_id=$2", [id, userId]);
  await audit(tx, userId, "delete", "account", id, { name: a.name });
}

/**
 * Set an account's balance as of a date by recording a balance adjustment for
 * the difference, so balances always remain explainable by transactions.
 */
export async function updateBalance(tx: Queryable, userId: string, accountId: string, targetNatural: string, date: string, note: string | null) {
  const a = await getAccountRow(tx, userId, accountId);
  if (date < a.opening_date) throw new UserError(`Choose a date on or after the opening date (${a.opening_date}).`, "date");
  const [cur] = await listAccounts(tx, userId, { includeArchived: true, asOf: date }).then((l) => l.filter((x) => x.id === accountId));
  const cls = accountClass(a.type);
  const currentValue = openingValue(cls, cur.balance);
  const targetValue = openingValue(cls, toCents(targetNatural));
  const delta = targetValue - currentValue;
  if (delta === 0) return { delta: 0 };
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO transactions (user_id, account_id, type, date, amount, currency, account_amount, merchant, description, category_source, is_reviewed)
     VALUES ($1,$2,'adjustment',$3,$4,$5,$4,'Balance adjustment',$6,'none',true) RETURNING id`,
    [userId, accountId, date, centsToDecimal(delta), a.currency, note],
  );
  await rebuildSnapshots(tx, userId, accountId);
  await audit(tx, userId, "balance_update", "account", accountId, { from: cur.balance / 100, to: targetNatural, date, transactionId: row.id });
  return { delta };
}

export async function balanceHistory(tx: Queryable, userId: string, accountId: string) {
  return tx.query<{ date: string; balance: string; source: string }>(
    "SELECT date, balance, source FROM account_balances WHERE account_id=$1 AND user_id=$2 ORDER BY date",
    [accountId, userId],
  );
}
