import type { Queryable } from "@/server/db";
import { format, parseISO, subMonths } from "date-fns";
import { centsToDecimal, toCents, type Cents } from "@/lib/finance/money";
import { estimatedCompletion, goalProgress, monthsRemaining, requiredMonthlyContribution } from "@/lib/finance/calculations";
import { transactionSchema } from "@/lib/validation";
import { createTransaction, deleteTransactions } from "./transactions";
import { getAccountRow } from "./accounts";
import { audit } from "./audit";
import { UserError } from "./errors";

export interface GoalRow {
  id: string;
  name: string;
  kind: string;
  target_amount: string;
  currency: string;
  target_date: string | null;
  linked_account_id: string | null;
  linked_account_name: string | null;
  description: string | null;
  status: "active" | "completed" | "archived";
  is_emergency_fund: boolean;
  created_at: string;
}

export interface GoalView extends GoalRow {
  saved: Cents;
  target: Cents;
  remaining: Cents;
  progress: number;
  monthsLeft: number | null;
  requiredMonthly: Cents | null;
  averageMonthly: Cents; // last 3 months
  estimatedCompletion: string | null;
  onTrack: boolean | null;
  contributions: { id: string; amount: string; date: string; note: string | null; transaction_id: string | null }[];
}

export async function listGoals(tx: Queryable, userId: string, today: string): Promise<GoalView[]> {
  const goals = await tx.query<GoalRow>(
    `SELECT g.id, g.name, g.kind, g.target_amount, g.currency, g.target_date, g.linked_account_id, a.name AS linked_account_name,
            g.description, g.status, g.is_emergency_fund, g.created_at
       FROM savings_goals g LEFT JOIN accounts a ON a.id = g.linked_account_id
      WHERE g.user_id = $1 ORDER BY g.status, g.target_date NULLS LAST, g.name`,
    [userId],
  );
  const contribs = await tx.query<{ id: string; goal_id: string; amount: string; date: string; note: string | null; transaction_id: string | null }>(
    "SELECT id, goal_id, amount, date, note, transaction_id FROM goal_contributions WHERE user_id=$1 ORDER BY date DESC, created_at DESC",
    [userId],
  );
  const since = format(subMonths(parseISO(today), 3), "yyyy-MM-dd");
  return goals.map((g) => {
    const list = contribs.filter((c) => c.goal_id === g.id);
    const saved = list.reduce((s, c) => s + toCents(c.amount), 0);
    const target = toCents(g.target_amount);
    const recent = list.filter((c) => c.date > since).reduce((s, c) => s + toCents(c.amount), 0);
    const averageMonthly = Math.round(recent / 3);
    const required = requiredMonthlyContribution(target, saved, today, g.target_date);
    const eta = estimatedCompletion(target, saved, averageMonthly, today);
    return {
      ...g,
      saved,
      target,
      remaining: Math.max(0, target - saved),
      progress: goalProgress(saved, target),
      monthsLeft: g.target_date ? monthsRemaining(today, g.target_date) : null,
      requiredMonthly: required,
      averageMonthly,
      estimatedCompletion: eta,
      onTrack: saved >= target ? true : g.target_date && eta ? eta <= g.target_date : g.target_date ? false : null,
      contributions: list,
    };
  });
}

type GoalData = {
  name: string;
  kind: string;
  targetAmount: string;
  currency: string;
  targetDate?: string | null;
  linkedAccountId?: string | null;
  description: string | null;
  isEmergencyFund: boolean;
};

export async function saveGoal(tx: Queryable, userId: string, id: string | null, d: GoalData) {
  if (d.linkedAccountId) await getAccountRow(tx, userId, d.linkedAccountId);
  if (d.isEmergencyFund) await tx.query("UPDATE savings_goals SET is_emergency_fund=false WHERE user_id=$1 AND id IS DISTINCT FROM $2", [userId, id]);
  const vals = [d.name, d.kind, d.targetAmount, d.currency, d.targetDate || null, d.linkedAccountId || null, d.description, d.isEmergencyFund];
  if (id) {
    const r = await tx.query(
      `UPDATE savings_goals SET name=$1, kind=$2, target_amount=$3, currency=$4, target_date=$5, linked_account_id=$6, description=$7, is_emergency_fund=$8
        WHERE id=$9 AND user_id=$10 RETURNING id`,
      [...vals, id, userId],
    );
    if (!r.length) throw new UserError("Goal not found.");
    await audit(tx, userId, "update", "goal", id, { name: d.name, target: d.targetAmount });
    return id;
  }
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO savings_goals (name, kind, target_amount, currency, target_date, linked_account_id, description, is_emergency_fund, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [...vals, userId],
  );
  await audit(tx, userId, "create", "goal", row.id, { name: d.name, target: d.targetAmount });
  return row.id;
}

export async function setGoalStatus(tx: Queryable, userId: string, id: string, status: "active" | "completed" | "archived") {
  await tx.query("UPDATE savings_goals SET status=$1 WHERE id=$2 AND user_id=$3", [status, id, userId]);
  await audit(tx, userId, "status", "goal", id, { status });
}

export async function deleteGoal(tx: Queryable, userId: string, id: string) {
  await tx.query("DELETE FROM savings_goals WHERE id=$1 AND user_id=$2", [id, userId]);
  await audit(tx, userId, "delete", "goal", id);
}

/**
 * Add a contribution (or a withdrawal, when negative). If a source account is
 * given and the goal has a linked account, the money is moved with a transfer —
 * never recorded as an expense.
 */
export async function addContribution(
  tx: Queryable,
  userId: string,
  d: { goalId: string; amount: string; date: string; note: string | null; fromAccountId?: string | null },
) {
  const [g] = await tx.query<GoalRow>("SELECT id, name, currency, linked_account_id FROM savings_goals WHERE id=$1 AND user_id=$2", [d.goalId, userId]);
  if (!g) throw new UserError("Goal not found.");
  const cents = toCents(d.amount);
  let transactionId: string | null = null;
  if (d.fromAccountId) {
    if (!g.linked_account_id) throw new UserError("Link an account to this goal to move money with the contribution.");
    if (d.fromAccountId === g.linked_account_id) throw new UserError("Choose a source account different from the goal's linked account.", "fromAccountId");
    const from = await getAccountRow(tx, userId, d.fromAccountId);
    const linked = await getAccountRow(tx, userId, g.linked_account_id);
    const outflow = cents > 0;
    const src = outflow ? from : linked;
    const dst = outflow ? linked : from;
    const input = transactionSchema.parse({
      type: "transfer",
      amount: centsToDecimal(Math.abs(cents)),
      currency: g.currency,
      date: d.date,
      accountId: src.id,
      toAccountId: dst.id,
      merchant: `${outflow ? "Contribution to" : "Withdrawal from"} ${g.name}`,
      notes: d.note,
      isReviewed: true,
    });
    transactionId = (await createTransaction(tx, userId, input)).id;
  }
  const [row] = await tx.query<{ id: string }>(
    "INSERT INTO goal_contributions (user_id, goal_id, amount, date, note, transaction_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [userId, g.id, centsToDecimal(cents), d.date, d.note, transactionId],
  );
  await audit(tx, userId, "contribute", "goal", g.id, { amount: centsToDecimal(cents), date: d.date, transactionId });
  return row.id;
}

/** Remove a contribution. A transfer created with it is removed too, restoring balances. */
export async function removeContribution(tx: Queryable, userId: string, id: string) {
  const [c] = await tx.query<{ goal_id: string; transaction_id: string | null; amount: string }>(
    "SELECT goal_id, transaction_id, amount FROM goal_contributions WHERE id=$1 AND user_id=$2",
    [id, userId],
  );
  if (!c) throw new UserError("Contribution not found.");
  await tx.query("DELETE FROM goal_contributions WHERE id=$1 AND user_id=$2", [id, userId]);
  if (c.transaction_id) await deleteTransactions(tx, userId, [c.transaction_id]);
  await audit(tx, userId, "remove_contribution", "goal", c.goal_id, { amount: c.amount });
}
