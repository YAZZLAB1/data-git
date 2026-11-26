/**
 * Accounting conventions — the single source of truth for how a transaction
 * affects account balances and income / expense reports.
 */
import type { Cents } from "./money";

export const TRANSACTION_TYPES = ["expense", "income", "transfer", "refund", "adjustment"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const ASSET_TYPES = ["cash", "checking", "savings", "investment", "other_asset"] as const;
export const LIABILITY_TYPES = ["credit_card", "personal_loan", "mortgage", "other_liability"] as const;
export const ACCOUNT_TYPES = [...ASSET_TYPES, ...LIABILITY_TYPES] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AccountClass = "asset" | "liability";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: "Cash",
  checking: "Checking",
  savings: "Savings",
  investment: "Investment",
  other_asset: "Other asset",
  credit_card: "Credit card",
  personal_loan: "Personal loan",
  mortgage: "Mortgage",
  other_liability: "Other debt",
};

export function accountClass(type: string): AccountClass {
  return (LIABILITY_TYPES as readonly string[]).includes(type) ? "liability" : "asset";
}

/** Liquid accounts used for emergency-fund coverage. */
export function isLiquid(type: string): boolean {
  return type === "cash" || type === "checking" || type === "savings";
}

export interface LedgerTx {
  type: TransactionType;
  account_id: string;
  to_account_id?: string | null;
  account_amount: Cents; // signed only for adjustments
  to_amount?: Cents | null;
}

/**
 * Change in an account's *value* (asset perspective) caused by a transaction.
 * A liability's value is minus the amount owed, so a card purchase lowers its
 * value (more owed) and a payment into the card raises it (less owed).
 */
export function accountValueDelta(tx: LedgerTx, accountId: string): Cents {
  let d = 0;
  if (tx.account_id === accountId) {
    switch (tx.type) {
      case "income":
      case "refund":
        d += tx.account_amount;
        break;
      case "expense":
      case "transfer":
        d -= tx.account_amount;
        break;
      case "adjustment":
        d += tx.account_amount;
        break;
    }
  }
  if (tx.type === "transfer" && tx.to_account_id === accountId) d += tx.to_amount ?? 0;
  return d;
}

/** Natural balance shown to the user: amount owed for liabilities, value for assets. */
export function naturalBalance(cls: AccountClass, value: Cents): Cents {
  return (cls === "liability" ? 0 - value : value) + 0;
}

/** Account value from its natural opening balance. */
export function openingValue(cls: AccountClass, openingNatural: Cents): Cents {
  return (cls === "liability" ? 0 - openingNatural : openingNatural) + 0;
}

/** Whether a transaction type participates in income / expense reporting. */
export function isReportable(type: TransactionType): boolean {
  return type === "income" || type === "expense" || type === "refund";
}

export function categoryKindFor(type: TransactionType): "income" | "expense" | null {
  if (type === "income") return "income";
  if (type === "expense" || type === "refund") return "expense";
  return null;
}
