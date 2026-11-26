import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { getOverview } from "@/server/queries/overview";
import { OverviewView } from "@/components/overview/overview-view";
import { todayInZone } from "@/lib/period";

export const metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayInZone(user.timezone);
  const data = await withUser(user.id, (tx) => getOverview(tx, user, today, sp));
  return <OverviewView d={data} />;
}
