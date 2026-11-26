import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { refreshInsights } from "@/server/services/insights";
import { ASSISTANT_SUGGESTIONS } from "@/server/services/assistant";
import { InsightsView } from "@/components/insights/insights-view";
import { todayInZone } from "@/lib/period";

export const metadata = { title: "Financial Insights" };

export default async function InsightsPage() {
  const user = await requireUser();
  const today = todayInZone(user.timezone);
  const insights = await withUser(user.id, (tx) => refreshInsights(tx, user.id, { base: user.baseCurrency, locale: user.numberLocale, today }));
  return <InsightsView insights={insights} suggestions={ASSISTANT_SUGGESTIONS} />;
}
