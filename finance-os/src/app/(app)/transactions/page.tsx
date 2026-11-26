import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { listTransactions } from "@/server/services/transactions";
import { transactionFilterSchema } from "@/lib/validation";
import { TransactionsView } from "@/components/transactions/transactions-view";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const clean = Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = transactionFilterSchema.safeParse(clean);
  const filters = parsed.success ? parsed.data : transactionFilterSchema.parse({});
  const data = await withUser(user.id, (tx) => listTransactions(tx, user.id, filters, user.baseCurrency));
  return <TransactionsView data={data} filters={filters} invalidFilters={!parsed.success} />;
}
