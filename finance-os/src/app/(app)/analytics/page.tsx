import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { getAnalytics } from "@/server/queries/analytics";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { todayInZone } from "@/lib/period";

export const metadata = { title: "Analytics & Reports" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayInZone(user.timezone);
  const data = await withUser(user.id, (tx) => getAnalytics(tx, user, today, sp));
  return <AnalyticsView d={data} />;
}
