/** Data portability: CSV export, JSON backup / restore, and data deletion. */
import { randomUUID } from "node:crypto";
import type { Queryable } from "@/server/db";
import { seedDefaultCategories } from "./categories";
import { rebuildSnapshots } from "./accounts";
import { audit } from "./audit";
import { UserError } from "./errors";

// ------------------------------------------------------------------ CSV
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Prevent spreadsheet formula injection for text cells (numbers are left as-is).
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function exportTransactionsCsv(tx: Queryable, userId: string, from?: string, to?: string) {
  const params: unknown[] = [userId];
  let where = "t.user_id = $1";
  if (from) {
    params.push(from);
    where += ` AND t.date >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    where += ` AND t.date <= $${params.length}`;
  }
  const rows = await tx.query<Record<string, string | boolean | null>>(
    `SELECT t.date, t.type, t.merchant, c.name AS category, a.name AS account, t.amount, t.currency, t.account_amount, a.currency AS account_currency,
            t.fx_rate, ta.name AS to_account, t.to_amount, t.status, t.is_reviewed, t.notes, t.description,
            (SELECT string_agg(tg.name, '; ' ORDER BY tg.name) FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = t.id) AS tags,
            (SELECT string_agg(coalesce(sc.name,'Uncategorized') || ': ' || s.amount::text, '; ') FROM transaction_splits s LEFT JOIN categories sc ON sc.id = s.category_id WHERE s.transaction_id = t.id) AS splits
       FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN accounts ta ON ta.id = t.to_account_id LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${where} ORDER BY t.date, t.created_at`,
    params,
  );
  return toCsv(
    ["Date", "Type", "Merchant", "Category", "Account", "Amount", "Currency", "Account amount", "Account currency", "Exchange rate", "To account", "To amount", "Status", "Reviewed", "Tags", "Splits", "Notes", "Description"],
    rows.map((r) => [r.date, r.type, r.merchant, r.category, r.account, r.amount, r.currency, r.account_amount, r.account_currency, r.fx_rate, r.to_account, r.to_amount, r.status, r.is_reviewed ? "yes" : "no", r.tags, r.splits, r.notes, r.description]),
  );
}

export async function exportAccountsCsv(tx: Queryable, userId: string) {
  const rows = await tx.query<Record<string, string | boolean | null>>(
    `SELECT a.name, a.type, a.institution, a.currency, a.opening_balance, a.opening_date, a.is_archived,
            (SELECT ab.balance FROM account_balances ab WHERE ab.account_id = a.id ORDER BY ab.date DESC LIMIT 1) AS latest_balance,
            (SELECT max(ab.date) FROM account_balances ab WHERE ab.account_id = a.id) AS balance_date, a.notes
       FROM accounts a WHERE a.user_id=$1 ORDER BY a.name`,
    [userId],
  );
  return toCsv(
    ["Name", "Type", "Institution", "Currency", "Opening balance", "Opening date", "Archived", "Latest balance", "Balance date", "Notes"],
    rows.map((r) => [r.name, r.type, r.institution, r.currency, r.opening_balance, r.opening_date, r.is_archived ? "yes" : "no", r.latest_balance, r.balance_date, r.notes]),
  );
}

// ------------------------------------------------------------------ backup
type Ref = { col: string; table: string };
interface Spec {
  table: string;
  cols: string[];
  refs: Ref[];
  json?: string[];
  noId?: boolean;
}

const SPECS: Spec[] = [
  { table: "accounts", cols: ["id", "name", "type", "institution", "currency", "opening_balance", "opening_date", "notes", "is_archived", "created_at"], refs: [] },
  { table: "categories", cols: ["id", "name", "kind", "icon", "color", "is_system", "is_discretionary", "is_archived", "sort_order"], refs: [] },
  { table: "tags", cols: ["id", "name", "color"], refs: [] },
  { table: "imports", cols: ["id", "filename", "account_id", "total_rows", "imported_rows", "duplicate_rows", "error_rows", "skipped_rows", "errors", "created_at"], refs: [{ col: "account_id", table: "accounts" }], json: ["errors"] },
  {
    table: "recurring_payments",
    cols: ["id", "name", "merchant", "amount", "currency", "frequency", "interval_days", "category_id", "account_id", "next_date", "last_paid_date", "is_active", "notes"],
    refs: [{ col: "category_id", table: "categories" }, { col: "account_id", table: "accounts" }],
  },
  {
    table: "transactions",
    cols: ["id", "account_id", "to_account_id", "type", "status", "date", "amount", "currency", "account_amount", "fx_rate", "to_amount", "merchant", "description", "category_id", "category_source", "notes", "is_reviewed", "recurring_payment_id", "import_id", "external_id", "created_at"],
    refs: [
      { col: "account_id", table: "accounts" },
      { col: "to_account_id", table: "accounts" },
      { col: "category_id", table: "categories" },
      { col: "recurring_payment_id", table: "recurring_payments" },
      { col: "import_id", table: "imports" },
    ],
  },
  { table: "transaction_splits", cols: ["id", "transaction_id", "category_id", "amount", "notes"], refs: [{ col: "transaction_id", table: "transactions" }, { col: "category_id", table: "categories" }] },
  { table: "transaction_tags", cols: ["transaction_id", "tag_id"], refs: [{ col: "transaction_id", table: "transactions" }, { col: "tag_id", table: "tags" }], noId: true },
  { table: "transaction_rules", cols: ["id", "name", "match_mode", "conditions", "actions", "priority", "is_active", "times_applied"], refs: [], json: ["conditions", "actions"] },
  { table: "budgets", cols: ["id", "month", "rollover_enabled", "notes"], refs: [] },
  { table: "budget_allocations", cols: ["id", "budget_id", "category_id", "amount", "rollover"], refs: [{ col: "budget_id", table: "budgets" }, { col: "category_id", table: "categories" }] },
  {
    table: "savings_goals",
    cols: ["id", "name", "kind", "target_amount", "currency", "target_date", "linked_account_id", "description", "status", "is_emergency_fund"],
    refs: [{ col: "linked_account_id", table: "accounts" }],
  },
  { table: "goal_contributions", cols: ["id", "goal_id", "amount", "date", "note", "transaction_id"], refs: [{ col: "goal_id", table: "savings_goals" }, { col: "transaction_id", table: "transactions" }] },
  { table: "exchange_rates", cols: ["id", "base_currency", "quote_currency", "rate", "rate_date", "source"], refs: [] },
];

const PROFILE_COLS = ["full_name", "base_currency", "date_format", "number_locale", "theme", "timezone", "budget_rollover_default", "emergency_fund_months"];

export async function buildBackup(tx: Queryable, userId: string) {
  const data: Record<string, unknown[]> = {};
  for (const s of SPECS) {
    data[s.table] = await tx.query(`SELECT ${s.cols.map((c) => (c === "amount" || c.endsWith("_amount") || c === "rate" || c === "opening_balance" || c === "fx_rate" ? `${c}::text AS ${c}` : c)).join(", ")} FROM ${s.table} WHERE user_id = $1`, [userId]);
  }
  const [profile] = await tx.query(`SELECT ${PROFILE_COLS.join(", ")} FROM profiles WHERE user_id=$1`, [userId]);
  await audit(tx, userId, "backup", "user", userId, {});
  return { app: "finance-os", version: 1, exportedAt: new Date().toISOString(), profile, data };
}

/** Remove all financial data for the user (keeps login, profile and audit log). */
export async function deleteFinancialData(tx: Queryable, userId: string, opts: { reseed?: boolean } = { reseed: true }) {
  for (const t of [
    "goal_contributions",
    "transaction_tags",
    "transaction_splits",
    "transactions",
    "recurring_payments",
    "savings_goals",
    "budget_allocations",
    "budgets",
    "transaction_rules",
    "tags",
    "imports",
    "account_balances",
    "accounts",
    "exchange_rates",
    "recommendations",
    "categories",
  ]) {
    await tx.query(`DELETE FROM ${t} WHERE user_id = $1`, [userId]);
  }
  if (opts.reseed !== false) await seedDefaultCategories(tx, userId);
  await audit(tx, userId, "delete_all_data", "user", userId, {});
}

/**
 * Restore a backup produced by `buildBackup`, replacing the user's current data.
 * All identifiers are re-generated, so a backup can be restored into any account.
 */
export async function restoreBackup(tx: Queryable, userId: string, backup: unknown) {
  const b = backup as { app?: string; version?: number; data?: Record<string, Record<string, unknown>[]>; profile?: Record<string, unknown> };
  if (!b || b.app !== "finance-os" || b.version !== 1 || typeof b.data !== "object" || b.data === null)
    throw new UserError("This file isn't a Finance OS backup (version 1).");
  for (const s of SPECS) if (b.data[s.table] !== undefined && !Array.isArray(b.data[s.table])) throw new UserError(`Backup section “${s.table}” is malformed.`);
  await deleteFinancialData(tx, userId, { reseed: false });
  const maps = new Map<string, Map<string, string>>();
  const counts: Record<string, number> = {};
  for (const s of SPECS) {
    const rows = b.data[s.table] ?? [];
    const idMap = new Map<string, string>();
    maps.set(s.table, idMap);
    for (const row of rows) {
      if (!s.noId) idMap.set(String(row.id), randomUUID());
    }
    let n = 0;
    for (const row of rows) {
      const values: unknown[] = [];
      const cols: string[] = [];
      for (const c of s.cols) {
        if (!(c in row)) continue;
        let v = row[c];
        if (c === "id") v = idMap.get(String(v));
        const ref = s.refs.find((r) => r.col === c);
        if (ref && v !== null && v !== undefined) {
          const mapped = maps.get(ref.table)?.get(String(v));
          if (!mapped) {
            if (["transaction_id", "budget_id", "goal_id", "tag_id"].includes(c) || (s.table === "transactions" && c === "account_id")) {
              v = undefined; // required parent missing: skip row
            } else v = null;
          } else v = mapped;
        }
        if (v === undefined && (c === "id" || ref)) {
          cols.length = 0;
          break;
        }
        if (s.json?.includes(c)) {
          if (s.table === "transaction_rules") v = remapRuleJson(c, v, maps);
          v = JSON.stringify(v ?? (c === "errors" ? [] : null));
        }
        cols.push(c);
        values.push(v);
      }
      if (!cols.length) continue;
      cols.push("user_id");
      values.push(userId);
      await tx.query(`INSERT INTO ${s.table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, values);
      n++;
    }
    counts[s.table] = n;
  }
  if (!counts.categories) await seedDefaultCategories(tx, userId);
  if (b.profile && typeof b.profile === "object") {
    const p = b.profile;
    await tx.query(
      `UPDATE profiles SET base_currency = coalesce($1, base_currency), date_format = coalesce($2, date_format), number_locale = coalesce($3, number_locale),
              budget_rollover_default = coalesce($4, budget_rollover_default), emergency_fund_months = coalesce($5, emergency_fund_months) WHERE user_id = $6`,
      [p.base_currency ?? null, p.date_format ?? null, p.number_locale ?? null, p.budget_rollover_default ?? null, p.emergency_fund_months ?? null, userId],
    );
  }
  const accounts = await tx.query<{ id: string }>("SELECT id FROM accounts WHERE user_id=$1", [userId]);
  for (const a of accounts) await rebuildSnapshots(tx, userId, a.id);
  await audit(tx, userId, "restore", "user", userId, counts);
  return counts;
}

function remapRuleJson(col: string, v: unknown, maps: Map<string, Map<string, string>>) {
  if (!Array.isArray(v)) return [];
  return v.map((item: Record<string, unknown>) => {
    if (col === "actions" && item.type === "set_category") return { ...item, value: maps.get("categories")?.get(String(item.value)) ?? "" };
    if (col === "conditions" && item.field === "account") return { ...item, value: maps.get("accounts")?.get(String(item.value)) ?? "" };
    return item;
  });
}
