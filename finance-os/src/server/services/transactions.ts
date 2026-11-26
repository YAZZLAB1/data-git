import type { Queryable } from "@/server/db";
import { centsToDecimal, toCents } from "@/lib/finance/money";
import { categoryKindFor, type TransactionType } from "@/lib/finance/ledger";
import { evaluateRules, type Rule } from "@/lib/finance/rules";
import { validateSplits } from "@/lib/finance/calculations";
import type { TransactionData, TransactionFilters } from "@/lib/validation";
import type { RateTable } from "@/lib/finance/currency";
import { audit } from "./audit";
import { UserError } from "./errors";
import { getAccountRow, rebuildAccounts, type AccountRow } from "./accounts";
import { listCategories, type Category } from "./categories";
import { attachTagByName, listRules } from "./rules";
import { loadRateTable } from "./currency";

export interface TransactionRow {
  id: string;
  date: string;
  type: TransactionType;
  status: "posted" | "pending";
  amount: string;
  currency: string;
  account_amount: string;
  fx_rate: string | null;
  to_amount: string | null;
  merchant: string;
  description: string | null;
  notes: string | null;
  is_reviewed: boolean;
  category_id: string | null;
  category_source: string;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  account_id: string;
  account_name: string;
  account_currency: string;
  to_account_id: string | null;
  to_account_name: string | null;
  to_account_currency: string | null;
  tags: { id: string; name: string }[];
  splits: { id: string; category_id: string | null; amount: string; notes: string | null; category_name: string | null; category_color: string | null }[];
  created_at: string;
}

export interface TransactionView extends TransactionRow {
  /** Amount converted to the reporting currency (positive), or null if no stored rate. */
  base: { cents: number; rate: number; rateDate: string; estimated: boolean; path: string } | null;
}

const SELECT = `
  SELECT t.id, t.date, t.type, t.status, t.amount, t.currency, t.account_amount, t.fx_rate, t.to_amount,
         t.merchant, t.description, t.notes, t.is_reviewed, t.category_id, t.category_source, t.created_at,
         c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
         t.account_id, a.name AS account_name, a.currency AS account_currency,
         t.to_account_id, ta.name AS to_account_name, ta.currency AS to_account_currency,
         coalesce((SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name) ORDER BY tg.name)
                     FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = t.id), '[]'::json) AS tags,
         coalesce((SELECT json_agg(json_build_object('id', s.id, 'category_id', s.category_id, 'amount', s.amount::text, 'notes', s.notes,
                                                     'category_name', sc.name, 'category_color', sc.color) ORDER BY s.amount DESC)
                     FROM transaction_splits s LEFT JOIN categories sc ON sc.id = s.category_id WHERE s.transaction_id = t.id), '[]'::json) AS splits
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN accounts ta ON ta.id = t.to_account_id
    LEFT JOIN categories c ON c.id = t.category_id`;

export function toView(rows: TransactionRow[], rates: RateTable, base: string): TransactionView[] {
  return rows.map((r) => {
    // Prefer the stored account amount when the account is already in the base currency.
    if (r.account_currency === base && r.type !== "adjustment") {
      const rate = toCents(r.account_amount) / Math.max(1, toCents(r.amount));
      return { ...r, base: { cents: toCents(r.account_amount), rate, rateDate: r.date, estimated: false, path: r.currency === base ? base : `${r.currency}→${base}` } };
    }
    const conv = rates.convert(Math.abs(toCents(r.amount)), r.currency, base, r.date);
    return { ...r, base: conv };
  });
}

export async function listTransactions(tx: Queryable, userId: string, f: TransactionFilters, base: string) {
  const where: string[] = ["t.user_id = $1"];
  const params: unknown[] = [userId];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.q) {
    const q = `%${f.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    const ph = p(q);
    where.push(`(t.merchant ILIKE ${ph} OR t.description ILIKE ${ph} OR t.notes ILIKE ${ph} OR c.name ILIKE ${ph})`);
  }
  if (f.account) {
    const ph = p(f.account);
    where.push(`(t.account_id = ${ph} OR t.to_account_id = ${ph})`);
  }
  if (f.category === "uncategorized") {
    where.push(`t.type IN ('income','expense','refund') AND t.category_id IS NULL AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)`);
  } else if (f.category) {
    const ph = p(f.category);
    where.push(`(t.category_id = ${ph} OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id AND s.category_id = ${ph}))`);
  }
  if (f.type) where.push(`t.type = ${p(f.type)}`);
  if (f.tag) where.push(`EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ${p(f.tag)})`);
  if (f.from) where.push(`t.date >= ${p(f.from)}`);
  if (f.to) where.push(`t.date <= ${p(f.to)}`);
  if (f.reviewed) where.push(`t.is_reviewed = ${f.reviewed === "yes" ? "true" : "false"}`);
  const order = {
    date_desc: "t.date DESC, t.created_at DESC",
    date_asc: "t.date ASC, t.created_at ASC",
    amount_desc: "abs(t.amount) DESC, t.date DESC",
    amount_asc: "abs(t.amount) ASC, t.date DESC",
  }[f.sort];
  const whereSql = where.join(" AND ");
  const [{ n }] = await tx.query<{ n: number }>(
    `SELECT count(*) AS n FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE ${whereSql}`,
    params,
  );
  const rows = await tx.query<TransactionRow>(
    `${SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
    params,
  );
  const rates = await loadRateTable(tx, userId);
  return { rows: toView(rows, rates, base), total: Number(n), page: f.page, pageSize: f.pageSize };
}

export async function getTransaction(tx: Queryable, userId: string, id: string): Promise<TransactionRow> {
  const [r] = await tx.query<TransactionRow>(`${SELECT} WHERE t.id = $1 AND t.user_id = $2`, [id, userId]);
  if (!r) throw new UserError("Transaction not found.");
  return r;
}

interface Prepared {
  type: TransactionType;
  status: string;
  date: string;
  amount: string;
  currency: string;
  accountId: string;
  accountAmount: string;
  fxRate: string | null;
  toAccountId: string | null;
  toAmount: string | null;
  merchant: string;
  description: string | null;
  categoryId: string | null;
  categorySource: string;
  notes: string | null;
  isReviewed: boolean;
  tags: string[];
  splits: { categoryId: string | null; amount: string; notes: string | null }[];
  affected: string[];
}

function assertAccountUsable(a: AccountRow, date: string, label: string) {
  if (a.is_archived) throw new UserError(`${label} "${a.name}" is archived. Restore it to add transactions.`, "accountId");
  if (date < a.opening_date)
    throw new UserError(`The date is before ${a.name}'s opening date (${a.opening_date}). Choose a later date or change the account's opening date.`, "date");
}

/** Validate input and derive stored values (amounts per currency, category via rules). */
/** Preloaded lookups for bulk operations (imports), to avoid re-reading them per row. */
export interface PrepareCache {
  rules?: Rule[];
  categories?: Category[];
}

async function prepare(tx: Queryable, userId: string, d: TransactionData, opts: { previous?: TransactionRow; rates?: RateTable; cache?: PrepareCache } = {}): Promise<Prepared> {
  const account = await getAccountRow(tx, userId, d.accountId);
  // Allow edits on archived accounts only when the account doesn't change.
  if (!(opts.previous && opts.previous.account_id === account.id)) assertAccountUsable(account, d.date, "Account");
  else if (d.date < account.opening_date) assertAccountUsable({ ...account, is_archived: false }, d.date, "Account");

  const rates = opts.rates ?? (await loadRateTable(tx, userId));
  const amountCents = toCents(d.amount);

  let fxRate: string | null = null;
  let accountAmount = amountCents;
  if (d.currency !== account.currency) {
    let rate = d.fxRate ? Number(d.fxRate) : null;
    if (!rate) {
      const r = rates.resolve(d.currency, account.currency, d.date);
      if (!r || r.estimated)
        throw new UserError(
          `No ${d.currency}→${account.currency} exchange rate on or before ${d.date}. Enter the rate used, or add one in Settings → Currencies.`,
          "fxRate",
        );
      rate = r.rate;
    }
    fxRate = rate.toFixed(8);
    accountAmount = Math.round(amountCents * rate);
    if (accountAmount <= 0) throw new UserError("The converted amount is too small.", "amount");
  }

  let toAccountId: string | null = null;
  let toAmount: string | null = null;
  const affected = [account.id];
  if (d.type === "transfer") {
    const to = await getAccountRow(tx, userId, d.toAccountId!);
    if (!(opts.previous && opts.previous.to_account_id === to.id)) assertAccountUsable(to, d.date, "Destination account");
    toAccountId = to.id;
    affected.push(to.id);
    if (to.currency === account.currency) toAmount = centsToDecimal(accountAmount);
    else if (d.toAmount) toAmount = d.toAmount;
    else {
      const r = rates.resolve(account.currency, to.currency, d.date);
      if (!r || r.estimated)
        throw new UserError(`Enter the amount received in ${to.currency}, or add a ${account.currency}→${to.currency} exchange rate.`, "toAmount");
      toAmount = centsToDecimal(Math.round(accountAmount * r.rate));
    }
  }

  // Category & rules
  const kind = categoryKindFor(d.type);
  let categoryId = kind ? (d.categoryId ?? null) : null;
  let categorySource: string = categoryId ? d.categorySource : "none";
  let merchant = d.merchant;
  let isReviewed = d.isReviewed;
  const tags = [...d.tags];
  if (kind) {
    const rules = opts.cache?.rules ?? (await listRules(tx, userId));
    const out = evaluateRules(rules, { merchant: d.merchant, description: d.description, accountId: account.id, amountCents, type: d.type });
    // Rules fill in a category only when the user didn't choose one themselves.
    if (out.categoryId && (!categoryId || categorySource !== "manual")) {
      categoryId = out.categoryId;
      categorySource = "rule";
    }
    if (out.merchant && !opts.previous) merchant = out.merchant;
    if (out.markReviewed) isReviewed = true;
    for (const t of out.tags) if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
    if (out.matched.length && !opts.previous) {
      for (const r of out.matched)
        await tx.query("UPDATE transaction_rules SET times_applied = times_applied + 1 WHERE id=$1 AND user_id=$2", [r.id, userId]);
    }
  }

  const cats = kind ? (opts.cache?.categories ?? (await listCategories(tx, userId, { includeArchived: true }))) : [];
  if (categoryId) {
    const c = cats.find((x) => x.id === categoryId);
    if (!c) throw new UserError("Category not found.", "categoryId");
    if (c.kind !== kind) {
      // A rule pointing to the wrong kind is ignored rather than failing the save.
      if (categorySource === "rule") {
        categoryId = null;
        categorySource = "none";
      } else throw new UserError(`Choose ${kind === "income" ? "an income" : "an expense"} category.`, "categoryId");
    }
  }

  const splits = d.splits ?? [];
  if (splits.length) {
    if (splits.length < 2) throw new UserError("A split needs at least two parts.", "splits");
    const check = validateSplits(amountCents, splits.map((s) => ({ amount: toCents(s.amount) })));
    if (!check.ok)
      throw new UserError(
        `Split amounts must add up to ${centsToDecimal(amountCents)} ${d.currency} (${centsToDecimal(Math.abs(check.difference))} ${check.difference > 0 ? "left to assign" : "over"}).`,
        "splits",
      );
    for (const s of splits) {
      if (!s.categoryId) continue;
      const c = cats.find((x) => x.id === s.categoryId);
      if (!c || c.kind !== kind) throw new UserError("Each split needs a category of the same kind as the transaction.", "splits");
    }
    categoryId = null;
    categorySource = "manual";
  }

  return {
    type: d.type,
    status: d.status,
    date: d.date,
    amount: centsToDecimal(amountCents),
    currency: d.currency,
    accountId: account.id,
    accountAmount: centsToDecimal(accountAmount),
    fxRate,
    toAccountId,
    toAmount,
    merchant: d.type === "transfer" && !merchant ? "Transfer" : merchant,
    description: d.description,
    categoryId,
    categorySource,
    notes: d.notes,
    isReviewed,
    tags,
    splits,
    affected,
  };
}

async function writeChildren(tx: Queryable, userId: string, id: string, p: Prepared) {
  await tx.query("DELETE FROM transaction_tags WHERE transaction_id=$1 AND user_id=$2", [id, userId]);
  for (const t of p.tags) await attachTagByName(tx, userId, id, t);
  await tx.query("DELETE FROM transaction_splits WHERE transaction_id=$1 AND user_id=$2", [id, userId]);
  for (const s of p.splits)
    await tx.query("INSERT INTO transaction_splits (user_id, transaction_id, category_id, amount, notes) VALUES ($1,$2,$3,$4,$5)", [
      userId,
      id,
      s.categoryId,
      s.amount,
      s.notes,
    ]);
}

export async function createTransaction(
  tx: Queryable,
  userId: string,
  d: TransactionData,
  extra: { importId?: string; recurringPaymentId?: string; categorySourceOverride?: string; rates?: RateTable; skipSnapshots?: boolean; skipAudit?: boolean; cache?: PrepareCache } = {},
) {
  const p = await prepare(tx, userId, d, { rates: extra.rates, cache: extra.cache });
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO transactions (user_id, account_id, to_account_id, type, status, date, amount, currency, account_amount, fx_rate, to_amount,
                               merchant, description, category_id, category_source, notes, is_reviewed, import_id, recurring_payment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    [
      userId,
      p.accountId,
      p.toAccountId,
      p.type,
      p.status,
      p.date,
      p.amount,
      p.currency,
      p.accountAmount,
      p.fxRate,
      p.toAmount,
      p.merchant,
      p.description,
      p.categoryId,
      p.categoryId && extra.categorySourceOverride && p.categorySource !== "rule" ? extra.categorySourceOverride : p.categorySource,
      p.notes,
      p.isReviewed,
      extra.importId ?? null,
      extra.recurringPaymentId ?? null,
    ],
  );
  await writeChildren(tx, userId, row.id, p);
  if (!extra.skipSnapshots) await rebuildAccounts(tx, userId, p.affected);
  if (!extra.importId && !extra.skipAudit) await audit(tx, userId, "create", "transaction", row.id, { type: p.type, amount: p.amount, currency: p.currency, merchant: p.merchant, date: p.date });
  return { id: row.id, affected: p.affected };
}

export async function updateTransaction(tx: Queryable, userId: string, id: string, d: TransactionData) {
  const prev = await getTransaction(tx, userId, id);
  if (prev.type === "adjustment") throw new UserError("Balance adjustments can't be edited. Delete it and update the account balance again.");
  const p = await prepare(tx, userId, d, { previous: prev });
  // Keep the original provenance unless the category actually changed.
  // Keep provenance (rule / import / suggestion) when the category itself didn't change, so a later
  // "apply rule to existing" can still update it; any actual change by the user is "manual".
  const categorySource = p.categoryId && p.categoryId === prev.category_id && prev.category_source !== "none" ? prev.category_source : p.categorySource;
  await tx.query(
    `UPDATE transactions SET account_id=$1, to_account_id=$2, type=$3, status=$4, date=$5, amount=$6, currency=$7, account_amount=$8,
            fx_rate=$9, to_amount=$10, merchant=$11, description=$12, category_id=$13, category_source=$14, notes=$15, is_reviewed=$16
      WHERE id=$17 AND user_id=$18`,
    [
      p.accountId,
      p.toAccountId,
      p.type,
      p.status,
      p.date,
      p.amount,
      p.currency,
      p.accountAmount,
      p.fxRate,
      p.toAmount,
      p.merchant,
      p.description,
      p.categoryId,
      p.categoryId ? categorySource : p.splits.length ? "manual" : "none",
      p.notes,
      p.isReviewed,
      id,
      userId,
    ],
  );
  await writeChildren(tx, userId, id, p);
  const affected = new Set([...p.affected, prev.account_id, ...(prev.to_account_id ? [prev.to_account_id] : [])]);
  await rebuildAccounts(tx, userId, affected);
  await audit(tx, userId, "update", "transaction", id, {
    before: { type: prev.type, amount: prev.amount, currency: prev.currency, date: prev.date, merchant: prev.merchant, category: prev.category_id },
    after: { type: p.type, amount: p.amount, currency: p.currency, date: p.date, merchant: p.merchant, category: p.categoryId },
  });
}

export async function deleteTransactions(tx: Queryable, userId: string, ids: string[]) {
  if (!ids.length) return 0;
  const rows = await tx.query<{ id: string; account_id: string; to_account_id: string | null; amount: string; merchant: string; type: string; date: string }>(
    "SELECT id, account_id, to_account_id, amount, merchant, type, date FROM transactions WHERE user_id=$1 AND id = ANY($2::uuid[])",
    [userId, ids],
  );
  await tx.query("DELETE FROM transactions WHERE user_id=$1 AND id = ANY($2::uuid[])", [userId, rows.map((r) => r.id)]);
  const affected = new Set<string>();
  for (const r of rows) {
    affected.add(r.account_id);
    if (r.to_account_id) affected.add(r.to_account_id);
    await audit(tx, userId, "delete", "transaction", r.id, { amount: r.amount, merchant: r.merchant, type: r.type, date: r.date });
  }
  await rebuildAccounts(tx, userId, affected);
  return rows.length;
}

export async function setReviewed(tx: Queryable, userId: string, ids: string[], reviewed: boolean) {
  const r = await tx.query("UPDATE transactions SET is_reviewed=$1 WHERE user_id=$2 AND id = ANY($3::uuid[]) RETURNING id", [reviewed, userId, ids]);
  return r.length;
}

/** Bulk categorize (manual): only applies to transactions whose kind matches the category. */
export async function bulkCategorize(tx: Queryable, userId: string, ids: string[], categoryId: string) {
  const cats = await listCategories(tx, userId, { includeArchived: true });
  const c = cats.find((x) => x.id === categoryId);
  if (!c) throw new UserError("Category not found.");
  const types = c.kind === "income" ? ["income"] : ["expense", "refund"];
  const r = await tx.query(
    `UPDATE transactions SET category_id=$1, category_source='manual'
      WHERE user_id=$2 AND id = ANY($3::uuid[]) AND type = ANY($4::text[])
        AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = transactions.id) RETURNING id`,
    [categoryId, userId, ids, types],
  );
  await audit(tx, userId, "bulk_categorize", "transaction", null, { count: r.length, categoryId });
  return { updated: r.length, skipped: ids.length - r.length };
}

export async function listTags(tx: Queryable, userId: string) {
  return tx.query<{ id: string; name: string; color: string; n: number }>(
    `SELECT tg.id, tg.name, tg.color, (SELECT count(*) FROM transaction_tags tt WHERE tt.tag_id = tg.id) AS n
       FROM tags tg WHERE tg.user_id=$1 ORDER BY lower(tg.name)`,
    [userId],
  );
}

export async function deleteTag(tx: Queryable, userId: string, id: string) {
  await tx.query("DELETE FROM tags WHERE id=$1 AND user_id=$2", [id, userId]);
}

export async function searchTransactions(tx: Queryable, userId: string, q: string, base: string) {
  return listTransactions(tx, userId, { q, sort: "date_desc", page: 1, pageSize: 8 }, base);
}
