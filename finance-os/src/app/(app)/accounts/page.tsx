import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { listAccounts } from "@/server/services/accounts";
import { currentNetWorth } from "@/server/services/reporting";
import { AccountsView } from "@/components/accounts/accounts-view";
import { todayInZone } from "@/lib/period";

export const metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayInZone(user.timezone);
  const data = await withUser(user.id, async (tx) => {
    const accounts = await listAccounts(tx, user.id, { includeArchived: true });
    const nw = await currentNetWorth(tx, user.id, user.baseCurrency, today);
    return { accounts, nw };
  });
  const base = new Map(data.nw.accounts.map((a) => [a.id, a.baseBalance]));
  return (
    <AccountsView
      openNew={sp.new === "1"}
      totals={{ netWorth: data.nw.netWorth, assets: data.nw.assets, liabilities: data.nw.liabilities, missing: data.nw.missing }}
      accounts={data.accounts.map((a) => ({ ...a, baseBalance: base.get(a.id) ?? null }))}
    />
  );
}
