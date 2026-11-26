import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { budgetHistory, getBudgetMonth } from "@/server/services/budgets";
import { BudgetsView } from "@/components/budgets/budgets-view";
import { isISODate, monthStart, todayInZone } from "@/lib/period";

export const metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayInZone(user.timezone);
  const month = monthStart(isISODate(sp.month) ? sp.month : today);
  const data = await withUser(user.id, async (tx) => ({
    budget: await getBudgetMonth(tx, user.id, month, user.baseCurrency),
    history: await budgetHistory(tx, user.id, month, 6, user.baseCurrency),
  }));
  return <BudgetsView {...data} currentMonth={monthStart(today)} rolloverDefault={user.budgetRolloverDefault} />;
}
