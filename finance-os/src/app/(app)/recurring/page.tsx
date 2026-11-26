import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { detectRecurring, listRecurring, recurringTotals } from "@/server/services/recurring";
import { RecurringView } from "@/components/recurring/recurring-view";
import { todayInZone } from "@/lib/period";

export const metadata = { title: "Recurring Payments" };

export default async function RecurringPage() {
  const user = await requireUser();
  const today = todayInZone(user.timezone);
  const data = await withUser(user.id, async (tx) => {
    const items = await listRecurring(tx, user.id, user.baseCurrency, today);
    return { items, totals: recurringTotals(items), candidates: await detectRecurring(tx, user.id, today) };
  });
  return <RecurringView {...data} />;
}
