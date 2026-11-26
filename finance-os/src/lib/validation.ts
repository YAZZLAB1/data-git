import { z } from "zod";
import { CURRENCIES } from "./finance/money";
import { ACCOUNT_TYPES } from "./finance/ledger";
import { FREQUENCIES } from "./finance/calculations";
import { DATE_FORMATS, GOAL_KINDS, NUMBER_LOCALES } from "./constants";

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use a valid date" });
export const uuid = z.string().uuid({ message: "Invalid identifier" });
const MAX = 999_999_999_999;

/** Accepts "1234.5", "1,234.50", "1234,5" and returns a canonical "1234.50"-style string. */
export function normalizeAmountInput(raw: string): string {
  let s = raw.trim().replace(/[\s ']/g, "");
  if (s.includes(",") && s.includes(".")) {
    // the last separator is the decimal one
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    const parts = s.split(",");
    s = parts.length === 2 && parts[1].length <= 2 ? parts.join(".") : parts.join("");
  }
  return s;
}

export const amountString = (opts: { allowZero?: boolean; allowNegative?: boolean } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => normalizeAmountInput(String(v)))
    .refine((s) => (opts.allowNegative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/).test(s), {
      message: "Enter an amount with up to 2 decimals",
    })
    .refine((s) => Math.abs(Number(s)) <= MAX, { message: "Amount is too large" })
    .refine((s) => opts.allowZero || Number(s) !== 0, { message: "Amount must be greater than zero" });

export const rateString = z
  .union([z.string(), z.number()])
  .transform((v) => normalizeAmountInput(String(v)))
  .refine((s) => /^\d+(\.\d{1,8})?$/.test(s) && Number(s) > 0, { message: "Enter a positive rate (up to 8 decimals)" });

export const currencyEnum = z.enum(CURRENCIES);
const optText = (max: number) =>
  z
    .string()
    .max(max, { message: `At most ${max} characters` })
    .optional()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null));

// ------------------------------------------------------------------ auth
export const registerSchema = z.object({
  fullName: z.string().trim().min(1, { message: "Enter your name" }).max(80),
  email: z.string().trim().toLowerCase().email({ message: "Enter a valid email" }),
  password: z
    .string()
    .min(10, { message: "Use at least 10 characters" })
    .max(200)
    .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), { message: "Include letters and numbers" }),
  baseCurrency: currencyEnum.default("MAD"),
  timezone: z.string().max(64).optional(),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: "Enter a valid email" }),
  password: z.string().min(1, { message: "Enter your password" }).max(200),
});
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: registerSchema.shape.password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

// ------------------------------------------------------------------ accounts
export const accountSchema = z.object({
  name: z.string().trim().min(1, { message: "Name is required" }).max(80),
  type: z.enum(ACCOUNT_TYPES),
  institution: optText(80),
  currency: currencyEnum,
  openingBalance: amountString({ allowZero: true, allowNegative: true }),
  openingDate: isoDate,
  notes: optText(1000),
});
export type AccountInput = z.input<typeof accountSchema>;

export const balanceUpdateSchema = z.object({
  accountId: uuid,
  balance: amountString({ allowZero: true, allowNegative: true }),
  date: isoDate,
  note: optText(200),
});

// ------------------------------------------------------------------ transactions
export const splitSchema = z.object({
  categoryId: uuid.nullable(),
  amount: amountString(),
  notes: optText(200),
});

export const transactionSchema = z
  .object({
    type: z.enum(["expense", "income", "transfer", "refund"]),
    amount: amountString(),
    currency: currencyEnum,
    date: isoDate,
    accountId: uuid,
    toAccountId: uuid.optional().nullable(),
    /** Amount received by the destination account for cross-currency transfers. */
    toAmount: amountString().optional().nullable(),
    /** Rate from transaction currency to the account currency when they differ. */
    fxRate: rateString.optional().nullable(),
    merchant: z.string().trim().max(120).default(""),
    description: optText(500),
    categoryId: uuid.optional().nullable(),
    categorySource: z.enum(["manual", "suggestion", "rule", "none"]).default("manual"),
    notes: optText(1000),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    status: z.enum(["posted", "pending"]).default("posted"),
    isReviewed: z.boolean().default(false),
    splits: z.array(splitSchema).max(20).default([]),
  })
  .superRefine((d, ctx) => {
    if (d.type === "transfer") {
      if (!d.toAccountId) ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose the destination account" });
      else if (d.toAccountId === d.accountId)
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose a different destination account" });
    } else if (!d.merchant) {
      ctx.addIssue({ code: "custom", path: ["merchant"], message: "Enter a merchant or description" });
    }
    if (d.type === "transfer" && d.splits.length) ctx.addIssue({ code: "custom", path: ["splits"], message: "Transfers cannot be split" });
  });
export type TransactionInput = z.input<typeof transactionSchema>;
export type TransactionData = z.output<typeof transactionSchema>;

export const transactionFilterSchema = z.object({
  q: z.string().max(100).optional(),
  account: uuid.optional(),
  category: z.union([uuid, z.literal("uncategorized")]).optional(),
  type: z.enum(["expense", "income", "transfer", "refund", "adjustment"]).optional(),
  tag: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  reviewed: z.enum(["yes", "no"]).optional(),
  sort: z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc"]).default("date_desc"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});
export type TransactionFilters = z.output<typeof transactionFilterSchema>;

// ------------------------------------------------------------------ categories / tags / rules
export const categorySchema = z.object({
  name: z.string().trim().min(1, { message: "Name is required" }).max(60),
  kind: z.enum(["expense", "income"]),
  icon: z.string().max(40).default("circle-dashed"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: "Use a hex colour" }),
  isDiscretionary: z.boolean().default(false),
});

export const ruleConditionSchema = z.object({
  field: z.enum(["merchant", "description", "account", "amount", "type"]),
  operator: z.enum(["contains", "equals", "starts_with", "gt", "lt", "between"]),
  value: z.string().trim().min(1, { message: "Value is required" }).max(200),
  value2: z.string().trim().max(200).optional().nullable(),
});
export const ruleActionSchema = z.object({
  type: z.enum(["set_category", "add_tag", "rename_merchant", "mark_reviewed"]),
  value: z.string().trim().max(200).default(""),
});
export const ruleSchema = z.object({
  name: z.string().trim().min(1, { message: "Name is required" }).max(80),
  matchMode: z.enum(["all", "any"]),
  conditions: z.array(ruleConditionSchema).min(1, { message: "Add at least one condition" }).max(10),
  actions: z.array(ruleActionSchema).min(1, { message: "Add at least one action" }).max(10),
  priority: z.coerce.number().int().min(0).max(10000).default(100),
  isActive: z.boolean().default(true),
});
export type RuleInput = z.input<typeof ruleSchema>;
export type RuleCondition = z.output<typeof ruleConditionSchema>;
export type RuleAction = z.output<typeof ruleActionSchema>;

// ------------------------------------------------------------------ budgets
export const allocationSchema = z.object({
  month: isoDate,
  categoryId: uuid,
  amount: amountString({ allowZero: true }),
  rollover: z.boolean().default(false),
});

// ------------------------------------------------------------------ recurring
export const recurringSchema = z
  .object({
    name: z.string().trim().min(1, { message: "Name is required" }).max(80),
    merchant: optText(120),
    amount: amountString(),
    currency: currencyEnum,
    frequency: z.enum(FREQUENCIES),
    intervalDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
    categoryId: uuid.optional().nullable(),
    accountId: uuid.optional().nullable(),
    nextDate: isoDate,
    isActive: z.boolean().default(true),
    notes: optText(500),
  })
  .superRefine((d, ctx) => {
    if (d.frequency === "custom" && !d.intervalDays)
      ctx.addIssue({ code: "custom", path: ["intervalDays"], message: "Enter the interval in days" });
  });
export type RecurringInput = z.input<typeof recurringSchema>;

// ------------------------------------------------------------------ goals
export const goalSchema = z.object({
  name: z.string().trim().min(1, { message: "Name is required" }).max(80),
  kind: z.enum(Object.keys(GOAL_KINDS) as [keyof typeof GOAL_KINDS, ...(keyof typeof GOAL_KINDS)[]]).default("general"),
  targetAmount: amountString(),
  currency: currencyEnum,
  targetDate: isoDate.optional().nullable().or(z.literal("").transform(() => null)),
  linkedAccountId: uuid.optional().nullable(),
  description: optText(500),
  isEmergencyFund: z.boolean().default(false),
});
export type GoalInput = z.input<typeof goalSchema>;

export const contributionSchema = z.object({
  goalId: uuid,
  amount: amountString({ allowNegative: true }),
  date: isoDate,
  note: optText(200),
  /** Optionally move the money with a transfer into the goal's linked account. */
  fromAccountId: uuid.optional().nullable(),
});

// ------------------------------------------------------------------ currency
export const exchangeRateSchema = z
  .object({
    baseCurrency: currencyEnum,
    quoteCurrency: currencyEnum,
    rate: rateString,
    rateDate: isoDate,
  })
  .refine((d) => d.baseCurrency !== d.quoteCurrency, { message: "Choose two different currencies", path: ["quoteCurrency"] });

// ------------------------------------------------------------------ settings
export const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(80),
  avatarData: z
    .string()
    .max(400_000, { message: "Image is too large" })
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, { message: "Unsupported image" })
    .optional()
    .nullable(),
});
export const preferencesSchema = z.object({
  baseCurrency: currencyEnum,
  dateFormat: z.enum(DATE_FORMATS),
  numberLocale: z.enum(Object.keys(NUMBER_LOCALES) as [keyof typeof NUMBER_LOCALES, ...(keyof typeof NUMBER_LOCALES)[]]),
  theme: z.enum(["light", "dark", "system"]),
  timezone: z.string().min(1).max(64),
  budgetRolloverDefault: z.boolean(),
  emergencyFundMonths: z.coerce.number().int().min(1).max(24),
});
