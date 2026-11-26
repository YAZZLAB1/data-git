import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { listCategories } from "@/server/services/categories";
import { listRules } from "@/server/services/rules";
import { listRates } from "@/server/services/currency";
import { listSessions } from "@/server/services/users";
import { listAudit } from "@/server/services/audit";
import { listTags } from "@/server/services/transactions";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const data = await withUser(user.id, async (tx) => {
    const usage = await tx.query<{ category_id: string; n: number }>(
      `SELECT category_id, count(*) AS n FROM (
         SELECT category_id FROM transactions WHERE user_id=$1 AND category_id IS NOT NULL
         UNION ALL SELECT category_id FROM transaction_splits WHERE user_id=$1 AND category_id IS NOT NULL) x GROUP BY category_id`,
      [user.id],
    );
    const [{ n: accountCount }] = await tx.query<{ n: number }>("SELECT count(*) AS n FROM accounts WHERE user_id=$1", [user.id]);
    return {
      categories: await listCategories(tx, user.id, { includeArchived: true }),
      usage: Object.fromEntries(usage.map((u) => [u.category_id, Number(u.n)])),
      rules: await listRules(tx, user.id),
      rates: await listRates(tx, user.id),
      sessions: await listSessions(tx, user.id),
      audit: await listAudit(tx, user.id, 80),
      tags: await listTags(tx, user.id),
      accountCount: Number(accountCount),
    };
  });
  return (
    <SettingsView
      tab={sp.tab ?? "profile"}
      user={{ fullName: user.fullName, email: user.email, avatarData: user.avatarData, baseCurrency: user.baseCurrency, dateFormat: user.dateFormat, numberLocale: user.numberLocale, theme: user.theme, timezone: user.timezone, budgetRolloverDefault: user.budgetRolloverDefault, emergencyFundMonths: user.emergencyFundMonths, sessionId: user.sessionId }}
      {...data}
    />
  );
}
