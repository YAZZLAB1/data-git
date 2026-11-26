import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { balanceHistory, getAccount } from "@/server/services/accounts";
import { listTransactions } from "@/server/services/transactions";
import { uuid } from "@/lib/validation";
import { AccountDetail } from "@/components/accounts/account-detail";
import { UserError } from "@/server/services/errors";

export const metadata = { title: "Account" };

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  try {
    const data = await withUser(user.id, async (tx) => ({
      account: await getAccount(tx, user.id, id),
      history: await balanceHistory(tx, user.id, id),
      transactions: (await listTransactions(tx, user.id, { account: id, sort: "date_desc", page: 1, pageSize: 25 }, user.baseCurrency)).rows,
    }));
    return <AccountDetail {...data} />;
  } catch (e) {
    if (e instanceof UserError) notFound();
    throw e;
  }
}
