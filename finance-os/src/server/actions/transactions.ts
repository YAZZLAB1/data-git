"use server";
import { z } from "zod";
import { transactionSchema, uuid, isoDate } from "@/lib/validation";
import * as svc from "@/server/services/transactions";
import { suggestCategory } from "@/server/services/rules";
import { toCents } from "@/lib/finance/money";
import { run } from "./helpers";

const ids = z.array(uuid).min(1).max(500);

export async function createTransactionAction(input: unknown) {
  return run(async ({ user, tx }) => (await svc.createTransaction(tx, user.id, transactionSchema.parse(input))).id, { message: "Transaction added" });
}

export async function updateTransactionAction(id: string, input: unknown) {
  return run(({ user, tx }) => svc.updateTransaction(tx, user.id, uuid.parse(id), transactionSchema.parse(input)), { message: "Transaction updated" });
}

export async function deleteTransactionsAction(input: string[]) {
  return run(({ user, tx }) => svc.deleteTransactions(tx, user.id, ids.parse(input)));
}

export async function setReviewedAction(input: string[], reviewed: boolean) {
  return run(({ user, tx }) => svc.setReviewed(tx, user.id, ids.parse(input), z.boolean().parse(reviewed)));
}

export async function bulkCategorizeAction(input: string[], categoryId: string) {
  return run(({ user, tx }) => svc.bulkCategorize(tx, user.id, ids.parse(input), uuid.parse(categoryId)));
}

export async function getTransactionAction(id: string) {
  return run(({ user, tx }) => svc.getTransaction(tx, user.id, uuid.parse(id)), { revalidate: false });
}

const suggestSchema = z.object({
  merchant: z.string().max(120),
  description: z.string().max(500).optional().nullable(),
  accountId: uuid,
  amount: z.string().max(20).optional(),
  type: z.enum(["expense", "income", "refund", "transfer"]),
});

export async function suggestCategoryAction(input: unknown) {
  return run(
    async ({ user, tx }) => {
      const d = suggestSchema.parse(input);
      let cents = 0;
      try {
        cents = Math.abs(toCents((d.amount ?? "").replace(",", ".") || "0"));
      } catch {
        cents = 0;
      }
      return suggestCategory(tx, user.id, { merchant: d.merchant, description: d.description, accountId: d.accountId, amountCents: cents, type: d.type });
    },
    { revalidate: false },
  );
}

export async function searchTransactionsAction(q: string) {
  return run(async ({ user, tx }) => (await svc.searchTransactions(tx, user.id, z.string().max(100).parse(q), user.baseCurrency)).rows, { revalidate: false });
}

/** Transactions of one category in a period (chart drill-down). */
export async function categoryTransactionsAction(categoryId: string | null, from: string, to: string) {
  return run(
    async ({ user, tx }) =>
      (
        await svc.listTransactions(
          tx,
          user.id,
          { category: categoryId ? uuid.parse(categoryId) : "uncategorized", from: isoDate.parse(from), to: isoDate.parse(to), sort: "amount_desc", page: 1, pageSize: 100 },
          user.baseCurrency,
        )
      ).rows.filter((r) => r.type === "expense" || r.type === "refund"),
    { revalidate: false },
  );
}

export async function deleteTagAction(id: string) {
  return run(({ user, tx }) => svc.deleteTag(tx, user.id, uuid.parse(id)), { message: "Tag deleted" });
}
