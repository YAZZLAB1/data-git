"use server";
import { z } from "zod";
import {
  accountSchema,
  allocationSchema,
  balanceUpdateSchema,
  categorySchema,
  contributionSchema,
  exchangeRateSchema,
  goalSchema,
  isoDate,
  recurringSchema,
  ruleSchema,
  uuid,
  amountString,
} from "@/lib/validation";
import * as accounts from "@/server/services/accounts";
import * as categories from "@/server/services/categories";
import * as rules from "@/server/services/rules";
import * as budgets from "@/server/services/budgets";
import * as recurring from "@/server/services/recurring";
import * as goals from "@/server/services/goals";
import * as currency from "@/server/services/currency";
import * as insights from "@/server/services/insights";
import { assistantTools, RuleBasedAssistant } from "@/server/services/assistant";
import { run } from "./helpers";

// ------------------------------------------------------------------ accounts
export async function createAccountAction(input: unknown) {
  return run(({ user, tx }) => accounts.createAccount(tx, user.id, accountSchema.parse(input)), { message: "Account created" });
}
export async function updateAccountAction(id: string, input: unknown) {
  return run(({ user, tx }) => accounts.updateAccount(tx, user.id, uuid.parse(id), accountSchema.parse(input)), { message: "Account updated" });
}
export async function archiveAccountAction(id: string, archived: boolean) {
  return run(({ user, tx }) => accounts.setArchived(tx, user.id, uuid.parse(id), z.boolean().parse(archived)));
}
export async function deleteAccountAction(id: string) {
  return run(({ user, tx }) => accounts.deleteAccount(tx, user.id, uuid.parse(id)), { message: "Account deleted" });
}
export async function updateBalanceAction(input: unknown) {
  return run(async ({ user, tx }) => {
    const d = balanceUpdateSchema.parse(input);
    return accounts.updateBalance(tx, user.id, d.accountId, d.balance, d.date, d.note);
  });
}

// ------------------------------------------------------------------ categories
export async function createCategoryAction(input: unknown) {
  return run(({ user, tx }) => categories.createCategory(tx, user.id, categorySchema.parse(input)), { message: "Category created" });
}
export async function updateCategoryAction(id: string, input: unknown) {
  return run(({ user, tx }) => categories.updateCategory(tx, user.id, uuid.parse(id), categorySchema.parse(input)), { message: "Category updated" });
}
export async function deleteCategoryAction(id: string, reassignTo: string | null) {
  return run(({ user, tx }) => categories.deleteCategory(tx, user.id, uuid.parse(id), reassignTo ? uuid.parse(reassignTo) : null), { message: "Category deleted" });
}
export async function categoryUsageAction(id: string) {
  return run(({ user, tx }) => categories.categoryUsage(tx, user.id, uuid.parse(id)), { revalidate: false });
}

// ------------------------------------------------------------------ rules
export async function saveRuleAction(id: string | null, input: unknown) {
  return run(({ user, tx }) => rules.saveRule(tx, user.id, id ? uuid.parse(id) : null, ruleSchema.parse(input)), { message: "Rule saved" });
}
export async function deleteRuleAction(id: string) {
  return run(({ user, tx }) => rules.deleteRule(tx, user.id, uuid.parse(id)), { message: "Rule deleted" });
}
export async function previewRuleAction(id: string) {
  return run(({ user, tx }) => rules.previewRule(tx, user.id, uuid.parse(id)), { revalidate: false });
}
export async function applyRuleAction(id: string) {
  return run(({ user, tx }) => rules.applyRuleToExisting(tx, user.id, uuid.parse(id)));
}

// ------------------------------------------------------------------ budgets
export async function upsertAllocationAction(input: unknown) {
  return run(({ user, tx }) => budgets.upsertAllocation(tx, user.id, allocationSchema.parse(input)), { message: "Budget saved" });
}
export async function removeAllocationAction(id: string) {
  return run(({ user, tx }) => budgets.removeAllocation(tx, user.id, uuid.parse(id)), { message: "Category removed from budget" });
}
export async function copyPreviousBudgetAction(month: string) {
  return run(({ user, tx }) => budgets.copyPreviousBudget(tx, user.id, isoDate.parse(month)));
}
export async function fillBudgetFromAveragesAction(month: string) {
  return run(({ user, tx }) => budgets.fillFromAverages(tx, user.id, isoDate.parse(month), user.baseCurrency, user.budgetRolloverDefault));
}

// ------------------------------------------------------------------ recurring
export async function saveRecurringAction(id: string | null, input: unknown) {
  return run(({ user, tx }) => recurring.saveRecurring(tx, user.id, id ? uuid.parse(id) : null, recurringSchema.parse(input)), { message: "Recurring payment saved" });
}
export async function deleteRecurringAction(id: string) {
  return run(({ user, tx }) => recurring.deleteRecurring(tx, user.id, uuid.parse(id)), { message: "Recurring payment deleted" });
}
export async function markPaidAction(id: string, input: unknown) {
  const s = z.object({ recordTransaction: z.boolean(), date: isoDate, amount: amountString().optional().nullable() });
  return run(({ user, tx }) => recurring.markPaid(tx, user.id, uuid.parse(id), s.parse(input)));
}
export async function skipOccurrenceAction(id: string) {
  return run(({ user, tx }) => recurring.skipOccurrence(tx, user.id, uuid.parse(id)));
}

// ------------------------------------------------------------------ goals
export async function saveGoalAction(id: string | null, input: unknown) {
  return run(({ user, tx }) => goals.saveGoal(tx, user.id, id ? uuid.parse(id) : null, goalSchema.parse(input)), { message: "Goal saved" });
}
export async function setGoalStatusAction(id: string, status: string) {
  return run(({ user, tx }) => goals.setGoalStatus(tx, user.id, uuid.parse(id), z.enum(["active", "completed", "archived"]).parse(status)));
}
export async function deleteGoalAction(id: string) {
  return run(({ user, tx }) => goals.deleteGoal(tx, user.id, uuid.parse(id)), { message: "Goal deleted" });
}
export async function addContributionAction(input: unknown) {
  return run(({ user, tx }) => goals.addContribution(tx, user.id, contributionSchema.parse(input)), { message: "Contribution added" });
}
export async function removeContributionAction(id: string) {
  return run(({ user, tx }) => goals.removeContribution(tx, user.id, uuid.parse(id)), { message: "Contribution removed" });
}

// ------------------------------------------------------------------ currency
export async function upsertRateAction(input: unknown) {
  return run(({ user, tx }) => currency.upsertRate(tx, user.id, exchangeRateSchema.parse(input)), { message: "Exchange rate saved" });
}
export async function deleteRateAction(id: string) {
  return run(({ user, tx }) => currency.deleteRate(tx, user.id, uuid.parse(id)), { message: "Exchange rate deleted" });
}

// ------------------------------------------------------------------ insights & assistant
export async function setInsightStatusAction(id: string, status: string) {
  return run(({ user, tx }) => insights.setInsightStatus(tx, user.id, uuid.parse(id), z.enum(["active", "dismissed", "completed"]).parse(status)));
}
export async function askAssistantAction(question: string) {
  return run(
    async ({ user, tx, today }) => {
      const q = z.string().trim().min(2, { message: "Ask a question about your finances." }).max(300).parse(question);
      const bot = new RuleBasedAssistant(assistantTools(tx, user.id, user.baseCurrency, today), user.baseCurrency, user.numberLocale, today, user.emergencyFundMonths);
      return bot.answer(q);
    },
    { revalidate: false },
  );
}
