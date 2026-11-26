import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db";
import { listGoals } from "@/server/services/goals";
import { GoalsView } from "@/components/goals/goals-view";
import { todayInZone } from "@/lib/period";

export const metadata = { title: "Savings Goals" };

export default async function GoalsPage() {
  const user = await requireUser();
  const today = todayInZone(user.timezone);
  const goals = await withUser(user.id, (tx) => listGoals(tx, user.id, today));
  return <GoalsView goals={goals} />;
}
