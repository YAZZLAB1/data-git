import { describe, expect, it } from "vitest";
import { centsToDecimal, toCents, formatMoney } from "@/lib/finance/money";
import { RateTable } from "@/lib/finance/currency";
import {
  budgetStatus,
  goalProgress,
  monthlyEquivalent,
  netWorth,
  nextOccurrence,
  percentChange,
  projectMonthTotal,
  requiredMonthlyContribution,
  rolloverChain,
  savingsRate,
  summarize,
  validateSplits,
} from "@/lib/finance/calculations";
import { accountValueDelta } from "@/lib/finance/ledger";
import { evaluateRules, keywordCategory, type Rule } from "@/lib/finance/rules";
import { detectDateFormat, parseImportAmount, parseImportDate, detectDecimal } from "@/lib/import-parse";
import { normalizeAmountInput } from "@/lib/validation";
import { resolvePeriod } from "@/lib/period";

describe("money", () => {
  it("parses decimals without float drift", () => {
    expect(toCents("0.1")).toBe(10);
    expect(toCents("1234.56")).toBe(123456);
    expect(toCents("-12.345")).toBe(-1235);
    expect(toCents("0.29")).toBe(29);
    expect(centsToDecimal(-1230)).toBe("-12.30");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(formatMoney(123456, "MAD")).toBe("MAD 1,234.56");
  });
  it("normalizes user input", () => {
    expect(normalizeAmountInput("1 234,50")).toBe("1234.50");
    expect(normalizeAmountInput("1,234.50")).toBe("1234.50");
    expect(normalizeAmountInput("1.234,5")).toBe("1234.5");
  });
});

describe("calculations", () => {
  it("summarizes income, expenses and savings rate", () => {
    const s = summarize([
      { transactionId: "1", date: "2026-01-01", type: "income", amount: 10000, categoryId: null, merchant: "", accountId: "a" },
      { transactionId: "2", date: "2026-01-02", type: "expense", amount: 3000, categoryId: null, merchant: "", accountId: "a" },
      { transactionId: "3", date: "2026-01-03", type: "refund", amount: 500, categoryId: null, merchant: "", accountId: "a" },
    ]);
    expect(s).toEqual({ income: 10000, expenses: 2500, net: 7500, savingsRate: 75 });
    expect(savingsRate(0, 100)).toBeNull();
  });
  it("net worth = assets − liabilities", () => {
    expect(netWorth([{ cls: "asset", natural: 1000 }, { cls: "liability", natural: 300 }])).toEqual({ assets: 1000, liabilities: 300, netWorth: 700 });
  });
  it("budget remaining includes rollover and flags states", () => {
    expect(budgetStatus(1000, 500, 200)).toMatchObject({ available: 1200, remaining: 700, state: "ok" });
    expect(budgetStatus(1000, 850).state).toBe("warning");
    expect(budgetStatus(1000, 1001).state).toBe("over");
    expect(rolloverChain([{ budgeted: 1000, spent: 600, rollover: true }, { budgeted: 1000, spent: 900, rollover: true }])).toBe(500);
    expect(rolloverChain([{ budgeted: 1000, spent: 1600, rollover: true }])).toBe(0);
  });
  it("goal math", () => {
    expect(goalProgress(2500, 10000)).toBe(25);
    expect(requiredMonthlyContribution(10000, 4000, "2026-01-15", "2026-07-15")).toBe(1000);
    expect(requiredMonthlyContribution(10000, 10000, "2026-01-15", "2026-07-15")).toBe(0);
  });
  it("recurring normalization", () => {
    expect(monthlyEquivalent(1200, "annually")).toBe(100);
    expect(monthlyEquivalent(100, "weekly")).toBe(433);
    expect(nextOccurrence("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextOccurrence("2026-01-01", "custom", 10)).toBe("2026-01-11");
  });
  it("projections and changes", () => {
    expect(projectMonthTotal(1000, "2026-11-10").projected).toBe(3000);
    expect(percentChange(118, 100)).toBeCloseTo(18);
    expect(percentChange(5, 0)).toBeNull();
    expect(validateSplits(1000, [{ amount: 600 }, { amount: 400 }]).ok).toBe(true);
    expect(validateSplits(1000, [{ amount: 600 }]).difference).toBe(400);
  });
  it("ledger deltas for liabilities", () => {
    expect(accountValueDelta({ type: "expense", account_id: "card", account_amount: 500 }, "card")).toBe(-500);
    expect(accountValueDelta({ type: "transfer", account_id: "chk", to_account_id: "card", account_amount: 500, to_amount: 500 }, "card")).toBe(500);
  });
});

describe("currency", () => {
  const t = new RateTable([
    { base_currency: "EUR", quote_currency: "MAD", rate: "10.8", rate_date: "2026-01-01" },
    { base_currency: "EUR", quote_currency: "MAD", rate: "11", rate_date: "2026-02-01" },
    { base_currency: "USD", quote_currency: "MAD", rate: "10", rate_date: "2026-01-01" },
  ]);
  it("uses the latest rate on or before the date", () => {
    expect(t.convert(1000, "EUR", "MAD", "2026-01-20")).toMatchObject({ cents: 10800, rateDate: "2026-01-01", estimated: false });
    expect(t.convert(1000, "EUR", "MAD", "2026-03-01")?.cents).toBe(11000);
  });
  it("inverts and crosses rates", () => {
    expect(t.convert(10800, "MAD", "EUR", "2026-01-20")?.cents).toBe(1000);
    expect(t.convert(1000, "EUR", "USD", "2026-01-20")?.cents).toBe(1080);
  });
  it("flags estimates and never invents rates", () => {
    expect(t.convert(1000, "EUR", "MAD", "2025-12-01")?.estimated).toBe(true);
    expect(t.convert(1000, "GBP", "MAD", "2026-01-20")).toBeNull();
  });
});

describe("rules", () => {
  const rule = (over: Partial<Rule>): Rule => ({ id: "r", name: "r", match_mode: "all", conditions: [], actions: [], priority: 1, is_active: true, ...over });
  it("matches multiple conditions", () => {
    const r = rule({
      conditions: [
        { field: "merchant", operator: "starts_with", value: "uber" },
        { field: "amount", operator: "lt", value: "100" },
      ],
      actions: [{ type: "set_category", value: "transport" }, { type: "add_tag", value: "rides" }],
    });
    expect(evaluateRules([r], { merchant: "Uber trip", accountId: "a", amountCents: 5000, type: "expense" })).toMatchObject({ categoryId: "transport", tags: ["rides"] });
    expect(evaluateRules([r], { merchant: "Uber trip", accountId: "a", amountCents: 15000, type: "expense" }).categoryId).toBeNull();
  });
  it("keyword fallback", () => {
    expect(keywordCategory("NETFLIX.COM", "expense")).toBe("Subscriptions");
    expect(keywordCategory("Monthly salary", "income")).toBe("Salary");
  });
});

describe("import parsing", () => {
  it("parses dates and amounts", () => {
    expect(parseImportDate("31/03/2026", "dd/MM/yyyy")).toBe("2026-03-31");
    expect(parseImportDate("31/02/2026", "dd/MM/yyyy")).toBeNull();
    expect(detectDateFormat(["13/01/2026", "02/02/2026"])).toBe("dd/MM/yyyy");
    expect(detectDateFormat(["24/11/2026", "31/02/2026", "20/11/2026"])).toBe("dd/MM/yyyy");
    expect(parseImportAmount("(1,234.50)", ".")).toBe(-123450);
    expect(parseImportAmount("1.234,50 MAD", ",")).toBe(123450);
    expect(parseImportAmount("12.50-", ".")).toBe(-1250);
    expect(detectDecimal(["1.234,50", "12,00"])).toBe(",");
  });
});

describe("periods", () => {
  it("compares month-to-date with the same days last month", () => {
    const p = resolvePeriod({ period: "this_month" }, "2026-03-31");
    expect(p).toMatchObject({ from: "2026-03-01", to: "2026-03-31", prevFrom: "2026-02-01", prevTo: "2026-02-28" });
  });
});
