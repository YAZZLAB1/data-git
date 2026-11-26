import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { loadShell } from "@/server/queries/shell";
import { AppShell } from "@/components/layout/app-shell";
import { todayInZone } from "@/lib/period";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const today = todayInZone(user.timezone);
  const shell = await withUser(user.id, (tx) => loadShell(tx, user, today));
  return (
    <AppShell
      user={{ fullName: user.fullName, email: user.email, avatarData: user.avatarData, baseCurrency: user.baseCurrency, theme: user.theme }}
      prefs={{ baseCurrency: user.baseCurrency, locale: user.numberLocale, dateFormat: user.dateFormat, today, timezone: user.timezone }}
      accounts={shell.accounts}
      categories={shell.categories}
      tags={shell.tags}
      notifications={shell.notifications}
    >
      {children}
    </AppShell>
  );
}
