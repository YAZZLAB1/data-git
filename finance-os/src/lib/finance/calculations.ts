/**
 * Centralized financial calculations. Pure functions over integer cents, all
 * amounts already converted to one reporting currency by the caller.
 */
import { addDays, addMonths, addWeeks, addYears, differenceInCalendarDays, differenceInCalendarMonths, endOfMonth, getDaysInMonth, parseISO, format } from "date-fns";
import type { Cents } from "./money";

// ------------------------------------------------------------------ report lines
/** One reportable movement (a transaction or one of its splits), in reporting currency. */
export interface ReportLine {
  transactionId: string;
  date: string;
  type: "income" | "expense" | "refund";
  amount: Cents; // always positive
  categoryId: string | null;
  merchant: string;
  accountId: string;
}

export interface PeriodSummary {
  income: Cents;
  expenses: Cents; // expenses net of refunds
  net: Cents;
  savingsRate: number | null; // percent, null when no income
}

export function summarize(lines: ReportLine[]): PeriodSummary {
  let income = 0;
  let expenses = 0;
  for (const l of lines) {
    if (l.type === "income") income += l.amount;
    else if (l.type === "expense") expenses += l.amount;
    else if (l.type === "refund") expenses -= l.amount;
  }
  return { income, expenses, net: income - expenses, savingsRate: savingsRate(income, expenses) };
}

/** Savings Rate = (Income − Expenses) / Income × 100. Undefined without income. */
export function savingsRate(income: Cents, expenses: Cents): number | null {
  if (income <= 0) return null;
  return ((income - expenses) / income) * 100;
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Net spending per expense category (expenses minus refunds). */
export function spendingByCategory(lines: ReportLine[]): Map<string | null, Cents> {
  const m = new Map<string | null, Cents>();
  for (const l of lines) {
    if (l.type === "income") continue;
    const sign = l.type === "refund" ? -1 : 1;
    m.set(l.categoryId, (m.get(l.categoryId) ?? 0) + sign * l.amount);
  }
  return m;
}

export function incomeByCategory(lines: ReportLine[]): Map<string | null, Cents> {
  const m = new Map<string | null, Cents>();
  for (const l of lines) if (l.type === "income") m.set(l.categoryId, (m.get(l.categoryId) ?? 0) + l.amount);
  return m;
}

export function spendingByMerchant(lines: ReportLine[]): Map<string, Cents> {
  const m = new Map<string, Cents>();
  for (const l of lines) {
    if (l.type === "income") continue;
    const key = l.merchant.trim() || "(no merchant)";
    const sign = l.type === "refund" ? -1 : 1;
    m.set(key, (m.get(key) ?? 0) + sign * l.amount);
  }
  return m;
}

// ------------------------------------------------------------------ net worth
export interface AccountValue {
  cls: "asset" | "liability";
  natural: Cents; // natural balance in reporting currency (owed amount for liabilities)
}

export function netWorth(accounts: AccountValue[]) {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (a.cls === "asset") assets += a.natural;
    else liabilities += a.natural;
  }
  return { assets, liabilities, netWorth: assets - liabilities };
}

// ------------------------------------------------------------------ budgets
export type BudgetState = "ok" | "warning" | "over";
export const BUDGET_WARNING_THRESHOLD = 0.8;

/** Budget Remaining = Budget − Actual Spending + Eligible Rollover. */
export function budgetStatus(budgeted: Cents, spent: Cents, rollover: Cents = 0) {
  const available = budgeted + rollover;
  const remaining = available - spent;
  const ratio = available > 0 ? spent / available : spent > 0 ? Infinity : 0;
  const state: BudgetState = ratio > 1 ? "over" : ratio >= BUDGET_WARNING_THRESHOLD ? "warning" : "ok";
  return { budgeted, rollover, available, spent, remaining, percent: Number.isFinite(ratio) ? ratio * 100 : 100, state };
}

/**
 * Rollover carried into a month: unused amount of the previous month (never
 * negative — overspending is not carried as debt), chained over prior months.
 * `history` is oldest → newest, each with that month's allocation and spending.
 */
export function rolloverChain(history: { budgeted: Cents; spent: Cents; rollover: boolean }[]): Cents {
  let carry = 0;
  for (const h of history) {
    if (!h.rollover) {
      carry = 0;
      continue;
    }
    carry = Math.max(0, h.budgeted + carry - h.spent);
  }
  return carry;
}

// ------------------------------------------------------------------ goals
/** Progress = Current Savings / Target Amount × 100 (capped display handled by UI). */
export function goalProgress(current: Cents, target: Cents): number {
  if (target <= 0) return 0;
  return (current / target) * 100;
}

/** Whole months remaining until the target date, at least 1 if the date is in the future. */
export function monthsRemaining(today: string, targetDate: string): number {
  const t = parseISO(today);
  const d = parseISO(targetDate);
  if (d <= t) return 0;
  const months = differenceInCalendarMonths(d, t);
  // Count a partial month as a month so the contribution is achievable on time.
  const adjusted = addMonths(t, months) < d ? months + 1 : months;
  return Math.max(1, adjusted);
}

/** Required Monthly Contribution = (Target − Current) / Remaining Months. */
export function requiredMonthlyContribution(target: Cents, current: Cents, today: string, targetDate: string | null): Cents | null {
  const remaining = Math.max(0, target - current);
  if (remaining === 0) return 0;
  if (!targetDate) return null;
  const months = monthsRemaining(today, targetDate);
  if (months === 0) return remaining; // past due: everything is due now
  return Math.ceil(remaining / months);
}

/** Estimated completion date from an average monthly contribution pace. */
export function estimatedCompletion(target: Cents, current: Cents, avgMonthly: Cents, today: string): string | null {
  const remaining = target - current;
  if (remaining <= 0) return today;
  if (avgMonthly <= 0) return null;
  const months = Math.ceil(remaining / avgMonthly);
  if (months > 600) return null;
  return format(addMonths(parseISO(today), months), "yyyy-MM-dd");
}

// ------------------------------------------------------------------ recurring
export const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "annually", "custom"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
  custom: "Custom interval",
};

export function monthlyEquivalent(amount: Cents, frequency: Frequency, intervalDays?: number | null): Cents {
  switch (frequency) {
    case "weekly":
      return Math.round((amount * 52) / 12);
    case "biweekly":
      return Math.round((amount * 26) / 12);
    case "monthly":
      return amount;
    case "quarterly":
      return Math.round(amount / 3);
    case "annually":
      return Math.round(amount / 12);
    case "custom":
      return intervalDays && intervalDays > 0 ? Math.round((amount * 365) / intervalDays / 12) : 0;
  }
}

export function nextOccurrence(date: string, frequency: Frequency, intervalDays?: number | null): string {
  const d = parseISO(date);
  let n: Date;
  switch (frequency) {
    case "weekly":
      n = addWeeks(d, 1);
      break;
    case "biweekly":
      n = addWeeks(d, 2);
      break;
    case "monthly":
      n = addMonths(d, 1);
      break;
    case "quarterly":
      n = addMonths(d, 3);
      break;
    case "annually":
      n = addYears(d, 1);
      break;
    case "custom":
      n = addDays(d, Math.max(1, intervalDays ?? 30));
      break;
  }
  return format(n, "yyyy-MM-dd");
}

/** All occurrence dates of a schedule within [from, to]. */
export function occurrencesBetween(start: string, frequency: Frequency, intervalDays: number | null | undefined, from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  let d = start;
  let guard = 0;
  while (d <= to && guard++ < max) {
    if (d >= from) out.push(d);
    d = nextOccurrence(d, frequency, intervalDays);
  }
  return out;
}

// ------------------------------------------------------------------ projections
/** Linear month-end projection from the pace so far. Labelled as a projection in the UI. */
export function projectMonthTotal(spentSoFar: Cents, today: string): { projected: Cents; daysElapsed: number; daysInMonth: number } {
  const d = parseISO(today);
  const daysInMonth = getDaysInMonth(d);
  const daysElapsed = d.getDate();
  return { projected: Math.round((spentSoFar / daysElapsed) * daysInMonth), daysElapsed, daysInMonth };
}

export function daysLeftInMonth(today: string): number {
  const d = parseISO(today);
  return differenceInCalendarDays(endOfMonth(d), d);
}

// ------------------------------------------------------------------ splits
export function validateSplits(total: Cents, splits: { amount: Cents }[]): { ok: boolean; difference: Cents } {
  const sum = splits.reduce((s, x) => s + x.amount, 0);
  return { ok: splits.length === 0 || sum === total, difference: total - sum };
}
