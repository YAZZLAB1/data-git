import type { Queryable } from "@/server/db";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { centsToDecimal, toCents } from "@/lib/finance/money";
import { normalizeMerchant } from "@/lib/finance/rules";
import { parseImportAmount, parseImportDate, type ImportDateFormat } from "@/lib/import-parse";
import { transactionSchema } from "@/lib/validation";
import { getAccountRow, rebuildSnapshots } from "./accounts";
import { listCategories } from "./categories";
import { listRules, suggestCategory } from "./rules";
import { createTransaction } from "./transactions";
import { loadRateTable } from "./currency";
import { audit } from "./audit";
import { UserError } from "./errors";

export interface RawImportRow {
  date: string;
  amount?: string;
  debit?: string;
  credit?: string;
  merchant: string;
  description?: string;
  category?: string;
  notes?: string;
}

export interface ImportOptions {
  accountId: string;
  dateFormat: ImportDateFormat;
  decimal: "." | ",";
  amountMode: "signed" | "debit_credit";
  /** signed mode: whether negative numbers are expenses (bank default) or income. */
  negativeIs: "expense" | "income";
}

export interface PreviewRow {
  index: number;
  status: "valid" | "duplicate" | "invalid";
  errors: string[];
  duplicateOf?: string;
  date: string | null;
  amount: string | null;
  type: "income" | "expense" | null;
  merchant: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySource: "import" | "rule" | "history" | "keywords" | null;
  notes: string | null;
}

export const MAX_IMPORT_ROWS = 5000;

/** Validate rows and flag likely duplicates. Server-side; never trusts client parsing. */
export async function previewImport(tx: Queryable, userId: string, rows: RawImportRow[], opts: ImportOptions): Promise<PreviewRow[]> {
  if (rows.length === 0) throw new UserError("The file has no data rows.");
  if (rows.length > MAX_IMPORT_ROWS) throw new UserError(`Import up to ${MAX_IMPORT_ROWS} rows at a time. Split the file and import it in parts.`);
  const account = await getAccountRow(tx, userId, opts.accountId);
  if (account.is_archived) throw new UserError(`"${account.name}" is archived. Restore it before importing.`);
  const cats = await listCategories(tx, userId);
  const rules = await listRules(tx, userId);

  const parsed: PreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const errors: string[] = [];
    const date = parseImportDate(r.date, opts.dateFormat);
    if (!date) errors.push(`Date “${(r.date ?? "").slice(0, 30)}” doesn't match ${opts.dateFormat}`);
    else if (date < account.opening_date) errors.push(`Date is before the account's opening date (${account.opening_date})`);
    let signed: number | null = null;
    if (opts.amountMode === "signed") {
      signed = parseImportAmount(r.amount ?? "", opts.decimal);
      if (signed === null) errors.push(`Amount “${(r.amount ?? "").slice(0, 30)}” isn't a number`);
      else if (opts.negativeIs === "income") signed = -signed;
    } else {
      const debit = r.debit?.trim() ? parseImportAmount(r.debit, opts.decimal) : 0;
      const credit = r.credit?.trim() ? parseImportAmount(r.credit, opts.decimal) : 0;
      if (debit === null || credit === null) errors.push("Debit/credit isn't a number");
      else signed = Math.abs(credit) - Math.abs(debit);
    }
    if (signed === 0) errors.push("Amount is zero");
    const merchant = (r.merchant ?? "").trim().slice(0, 120) || (r.description ?? "").trim().slice(0, 120);
    if (!merchant) errors.push("Merchant / description is empty");
    const type = signed === null || signed === 0 ? null : signed < 0 ? "expense" : "income";
    const kind = type === "income" ? "income" : "expense";
    let categoryId: string | null = null;
    let categoryName: string | null = null;
    let categorySource: PreviewRow["categorySource"] = null;
    if (r.category?.trim()) {
      const c = cats.find((x) => x.kind === kind && x.name.toLowerCase() === r.category!.trim().toLowerCase());
      if (c) {
        categoryId = c.id;
        categoryName = c.name;
        categorySource = "import";
      }
    }
    if (!categoryId && type && merchant) {
      const s = await suggestCategory(tx, userId, { merchant, description: r.description, accountId: account.id, amountCents: Math.abs(signed ?? 0), type }, { rules, categories: cats });
      if (s) {
        categoryId = s.categoryId;
        categoryName = cats.find((c) => c.id === s.categoryId)?.name ?? null;
        categorySource = s.source;
      }
    }
    parsed.push({
      index: i,
      status: errors.length ? "invalid" : "valid",
      errors,
      date,
      amount: signed !== null ? centsToDecimal(Math.abs(signed)) : null,
      type,
      merchant,
      description: r.description?.trim().slice(0, 500) || null,
      categoryId,
      categoryName,
      categorySource,
      notes: r.notes?.trim().slice(0, 1000) || null,
    });
  }

  // Duplicate detection against existing transactions in this account (±2 days, same amount & direction, similar merchant).
  const valid = parsed.filter((p) => p.status === "valid");
  if (valid.length) {
    const dates = valid.map((p) => p.date!).sort();
    const existing = await tx.query<{ id: string; date: string; amount: string; type: string; merchant: string }>(
      `SELECT id, date, amount, type, merchant FROM transactions
        WHERE user_id=$1 AND account_id=$2 AND date BETWEEN $3 AND $4 AND type IN ('income','expense','refund')`,
      [userId, account.id, format(addDays(parseISO(dates[0]), -2), "yyyy-MM-dd"), format(addDays(parseISO(dates[dates.length - 1]), 2), "yyyy-MM-dd")],
    );
    const similar = (a: string, b: string) => {
      const x = normalizeMerchant(a);
      const y = normalizeMerchant(b);
      return x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y));
    };
    const seen: PreviewRow[] = [];
    for (const p of valid) {
      const dir = p.type === "income" ? ["income", "refund"] : ["expense"];
      const hit = existing.find(
        (e) =>
          dir.includes(e.type) &&
          toCents(e.amount) === toCents(p.amount!) &&
          Math.abs(differenceInCalendarDays(parseISO(e.date), parseISO(p.date!))) <= 2 &&
          similar(e.merchant, p.merchant),
      );
      const inFile = seen.find((s) => s.date === p.date && s.amount === p.amount && s.type === p.type && normalizeMerchant(s.merchant) === normalizeMerchant(p.merchant));
      if (hit) {
        p.status = "duplicate";
        p.duplicateOf = `Matches “${hit.merchant}” on ${hit.date}`;
      } else if (inFile) {
        p.status = "duplicate";
        p.duplicateOf = `Same as row ${inFile.index + 2} in this file`;
      }
      seen.push(p);
    }
  }
  return parsed;
}

/**
 * Import rows: re-validates everything server-side, inserts valid rows (and the
 * duplicates the user explicitly selected), and records an import history entry.
 */
export async function commitImport(
  tx: Queryable,
  userId: string,
  filename: string,
  rows: RawImportRow[],
  opts: ImportOptions,
  includeDuplicateIndexes: number[],
) {
  const preview = await previewImport(tx, userId, rows, opts);
  const account = await getAccountRow(tx, userId, opts.accountId);
  const include = new Set(includeDuplicateIndexes);
  const toImport = preview.filter((p) => p.status === "valid" || (p.status === "duplicate" && include.has(p.index)));
  const [imp] = await tx.query<{ id: string }>(
    "INSERT INTO imports (user_id, filename, account_id, total_rows) VALUES ($1,$2,$3,$4) RETURNING id",
    [userId, filename.slice(0, 200), account.id, rows.length],
  );
  const rates = await loadRateTable(tx, userId);
  const cache = { rules: await listRules(tx, userId), categories: await listCategories(tx, userId, { includeArchived: true }) };
  for (const p of toImport) {
    const input = transactionSchema.parse({
      type: p.type,
      amount: p.amount,
      currency: account.currency,
      date: p.date,
      accountId: account.id,
      merchant: p.merchant,
      description: p.description,
      categoryId: p.categoryId,
      categorySource: p.categoryId ? (p.categorySource === "import" ? "manual" : "suggestion") : "none",
      notes: p.notes,
    });
    await createTransaction(tx, userId, input, { importId: imp.id, categorySourceOverride: p.categorySource === "import" ? "import" : undefined, rates, skipSnapshots: true, cache });
  }
  await rebuildSnapshots(tx, userId, account.id);
  const invalid = preview.filter((p) => p.status === "invalid");
  const dupes = preview.filter((p) => p.status === "duplicate");
  const skippedDupes = dupes.filter((p) => !include.has(p.index)).length;
  const errors = invalid.slice(0, 200).map((p) => ({ row: p.index + 2, errors: p.errors }));
  await tx.query("UPDATE imports SET imported_rows=$1, duplicate_rows=$2, error_rows=$3, skipped_rows=$4, errors=$5 WHERE id=$6 AND user_id=$7", [
    toImport.length,
    dupes.length,
    invalid.length,
    skippedDupes + invalid.length,
    JSON.stringify(errors),
    imp.id,
    userId,
  ]);
  await audit(tx, userId, "import", "transactions", imp.id, { filename, imported: toImport.length, duplicates: dupes.length, invalid: invalid.length });
  return { importId: imp.id, imported: toImport.length, duplicates: dupes.length, skippedDuplicates: skippedDupes, invalid: invalid.length, errors };
}

export async function listImports(tx: Queryable, userId: string) {
  return tx.query<{
    id: string;
    filename: string;
    account_name: string | null;
    total_rows: number;
    imported_rows: number;
    duplicate_rows: number;
    error_rows: number;
    skipped_rows: number;
    errors: { row: number; errors: string[] }[];
    created_at: string;
  }>(
    `SELECT i.id, i.filename, a.name AS account_name, i.total_rows, i.imported_rows, i.duplicate_rows, i.error_rows, i.skipped_rows, i.errors, i.created_at
       FROM imports i LEFT JOIN accounts a ON a.id = i.account_id WHERE i.user_id=$1 ORDER BY i.created_at DESC LIMIT 50`,
    [userId],
  );
}

/** Undo an import: remove the transactions it created. */
export async function undoImport(tx: Queryable, userId: string, importId: string) {
  const [imp] = await tx.query<{ account_id: string | null }>("SELECT account_id FROM imports WHERE id=$1 AND user_id=$2", [importId, userId]);
  if (!imp) throw new UserError("Import not found.");
  const r = await tx.query("DELETE FROM transactions WHERE import_id=$1 AND user_id=$2 RETURNING id", [importId, userId]);
  if (imp.account_id) await rebuildSnapshots(tx, userId, imp.account_id);
  await tx.query("UPDATE imports SET imported_rows=0 WHERE id=$1 AND user_id=$2", [importId, userId]);
  await audit(tx, userId, "undo_import", "transactions", importId, { removed: r.length });
  return r.length;
}
