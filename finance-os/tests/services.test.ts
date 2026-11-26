import { beforeAll, describe, expect, it } from "vitest";
import { withUser } from "@/server/db";
import { setupDb, newUser, txInput } from "./helpers";
import { loadDemoData } from "@/server/services/demo";
import { createAccount, listAccounts } from "@/server/services/accounts";
import { createTransaction, listTransactions, updateTransaction } from "@/server/services/transactions";
import { loadLines, currentNetWorth, netWorthHistory } from "@/server/services/reporting";
import { summarize, spendingByCategory } from "@/lib/finance/calculations";
import { getBudgetMonth, upsertAllocation } from "@/server/services/budgets";
import { refreshInsights } from "@/server/services/insights";
import { assistantTools, RuleBasedAssistant } from "@/server/services/assistant";
import { commitImport, previewImport } from "@/server/services/imports";
import { buildBackup, restoreBackup } from "@/server/services/data";
import { addContribution, listGoals, saveGoal } from "@/server/services/goals";
import { markPaid, saveRecurring, listRecurring } from "@/server/services/recurring";
import { saveRule, suggestCategory } from "@/server/services/rules";
import { upsertRate } from "@/server/services/currency";

const TODAY = "2026-11-26";

beforeAll(async () => {
  await setupDb();
});

describe("reporting", () => {
  it("excludes transfers and nets refunds", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const a = await createAccount(tx, u.id, { name: "A", type: "checking", institution: null, currency: "MAD", openingBalance: "0", openingDate: "2026-11-01", notes: null });
      const b = await createAccount(tx, u.id, { name: "B", type: "savings", institution: null, currency: "MAD", openingBalance: "0", openingDate: "2026-11-01", notes: null });
      await createTransaction(tx, u.id, txInput({ type: "income", amount: "10000", currency: "MAD", date: "2026-11-02", accountId: a, merchant: "Pay", categoryId: u.cat("Salary") }));
      await createTransaction(tx, u.id, txInput({ type: "expense", amount: "500", currency: "MAD", date: "2026-11-03", accountId: a, merchant: "Marjane", categoryId: u.cat("Groceries") }));
      await createTransaction(tx, u.id, txInput({ type: "refund", amount: "100", currency: "MAD", date: "2026-11-04", accountId: a, merchant: "Marjane", categoryId: u.cat("Groceries") }));
      await createTransaction(tx, u.id, txInput({ type: "transfer", amount: "3000", currency: "MAD", date: "2026-11-05", accountId: a, toAccountId: b }));
      const { lines } = await loadLines(tx, u.id, "2026-11-01", "2026-11-30", "MAD");
      const s = summarize(lines);
      expect(s.income).toBe(1_000_000);
      expect(s.expenses).toBe(40_000);
      expect(s.savingsRate).toBeCloseTo(96);
      expect(spendingByCategory(lines).get(u.cat("Groceries"))).toBe(40_000);
      const nw = await currentNetWorth(tx, u.id, "MAD", TODAY);
      expect(nw.netWorth).toBe(1_000_000 - 40_000);
    });
  });

  it("budget progress reflects a new 500 MAD grocery expense", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const a = await createAccount(tx, u.id, { name: "A", type: "checking", institution: null, currency: "MAD", openingBalance: "2000", openingDate: "2026-11-01", notes: null });
      await upsertAllocation(tx, u.id, { month: "2026-11-01", categoryId: u.cat("Groceries"), amount: "3000", rollover: false });
      await createTransaction(tx, u.id, txInput({ type: "expense", amount: "500", currency: "MAD", date: "2026-11-10", accountId: a, merchant: "Marjane", categoryId: u.cat("Groceries") }));
      const bm = await getBudgetMonth(tx, u.id, "2026-11-01", "MAD");
      expect(bm.items[0]).toMatchObject({ budgeted: 300_000, spent: 50_000, remaining: 250_000, state: "ok" });
      expect((await listAccounts(tx, u.id))[0].balance).toBe(150_000);
    });
  });

  it("converts foreign currency with stored rates and reports missing rates", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const eur = await createAccount(tx, u.id, { name: "EUR", type: "checking", institution: null, currency: "EUR", openingBalance: "100", openingDate: "2026-11-01", notes: null });
      await createTransaction(tx, u.id, txInput({ type: "expense", amount: "10", currency: "EUR", date: "2026-11-03", accountId: eur, merchant: "Cafe", categoryId: u.cat("Restaurants") }));
      let r = await loadLines(tx, u.id, "2026-11-01", "2026-11-30", "MAD");
      expect(r.lines).toHaveLength(0);
      expect(r.missing).toEqual([{ currency: "EUR", count: 1 }]);
      await upsertRate(tx, u.id, { baseCurrency: "EUR", quoteCurrency: "MAD", rate: "10.9", rateDate: "2026-11-01" });
      r = await loadLines(tx, u.id, "2026-11-01", "2026-11-30", "MAD");
      expect(r.lines[0].amount).toBe(10_900);
      const nw = await currentNetWorth(tx, u.id, "MAD", TODAY);
      expect(nw.netWorth).toBe(90 * 1090);
    });
  });
});

describe("sample data, insights and assistant", () => {
  it("loads sample data with consistent balances and history", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      await loadDemoData(tx, u.id, TODAY);
      const accounts = await listAccounts(tx, u.id);
      expect(accounts.length).toBe(6);
      const card = accounts.find((a) => a.type === "credit_card")!;
      expect(card.balance).toBeGreaterThanOrEqual(0);
      const hist = await netWorthHistory(tx, u.id, "MAD", ["2025-12-31", "2026-06-30", TODAY]);
      expect(hist.hasData).toBe(true);
      const nw = await currentNetWorth(tx, u.id, "MAD", TODAY);
      expect(hist.points[2].netWorth).toBe(nw.netWorth);
      const insights = await refreshInsights(tx, u.id, { base: "MAD", locale: "en-US", today: TODAY });
      expect(insights.length).toBeGreaterThan(2);
      expect(insights.some((i) => i.type === "recurring")).toBe(true);
      const tools = assistantTools(tx, u.id, "MAD", TODAY);
      const bot = new RuleBasedAssistant(tools, "MAD", "en-US", TODAY, 3);
      const a1 = await bot.answer("How much did I spend on restaurants?");
      expect(a1.answer).toMatch(/restaurants/);
      const a2 = await bot.answer("Can I afford a 5,000 MAD purchase?");
      expect(a2.calculation.length).toBeGreaterThan(2);
      const goals = await listGoals(tx, u.id, TODAY);
      expect(goals.find((g) => g.name === "New motorcycle")!.saved).toBe(1_250_000);
    });
  });
});

describe("goals & recurring", () => {
  it("contributions move money by transfer without creating expenses", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const a = await createAccount(tx, u.id, { name: "A", type: "checking", institution: null, currency: "MAD", openingBalance: "5000", openingDate: "2026-11-01", notes: null });
      const s = await createAccount(tx, u.id, { name: "S", type: "savings", institution: null, currency: "MAD", openingBalance: "0", openingDate: "2026-11-01", notes: null });
      const g = await saveGoal(tx, u.id, null, { name: "Bike", kind: "motorcycle", targetAmount: "3000", currency: "MAD", targetDate: "2027-05-26", linkedAccountId: s, description: null, isEmergencyFund: false });
      await addContribution(tx, u.id, { goalId: g, amount: "1000", date: "2026-11-20", note: null, fromAccountId: a });
      const [goal] = await listGoals(tx, u.id, TODAY);
      expect(goal.saved).toBe(100_000);
      expect(goal.progress).toBeCloseTo(33.33, 1);
      expect(goal.requiredMonthly).toBe(Math.ceil(200_000 / 6));
      const { lines } = await loadLines(tx, u.id, "2026-11-01", "2026-11-30", "MAD");
      expect(lines).toHaveLength(0);
      const accts = await listAccounts(tx, u.id);
      expect(accts.find((x) => x.id === s)!.balance).toBe(100_000);
    });
  });

  it("marking a recurring payment paid records the expense and advances the date", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const a = await createAccount(tx, u.id, { name: "A", type: "checking", institution: null, currency: "MAD", openingBalance: "5000", openingDate: "2026-11-01", notes: null });
      const id = await saveRecurring(tx, u.id, null, { name: "Netflix", merchant: "Netflix", amount: "99", currency: "MAD", frequency: "monthly", nextDate: "2026-11-30", categoryId: u.cat("Subscriptions"), accountId: a, isActive: true, notes: null });
      const r = await markPaid(tx, u.id, id, { recordTransaction: true, date: "2026-11-26" });
      expect(r.next).toBe("2026-12-30");
      const [rec] = await listRecurring(tx, u.id, "MAD", TODAY);
      expect(rec.monthly).toBe(9900);
      expect((await listAccounts(tx, u.id))[0].balance).toBe(500_000 - 9_900);
    });
  });
});

describe("rules & suggestions", () => {
  it("applies rules but never overrides a manual category", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const a = await createAccount(tx, u.id, { name: "A", type: "checking", institution: null, currency: "MAD", openingBalance: "5000", openingDate: "2026-11-01", notes: null });
      await saveRule(tx, u.id, null, { name: "Netflix", matchMode: "all", conditions: [{ field: "merchant", operator: "contains", value: "netflix" }], actions: [{ type: "set_category", value: u.cat("Subscriptions") }], priority: 1, isActive: true });
      const s = await suggestCategory(tx, u.id, { merchant: "NETFLIX.COM", accountId: a, amountCents: 9900, type: "expense" });
      expect(s).toMatchObject({ categoryId: u.cat("Subscriptions"), source: "rule" });
      await createTransaction(tx, u.id, txInput({ type: "expense", amount: "99", currency: "MAD", date: "2026-11-02", accountId: a, merchant: "Netflix" }));
      await createTransaction(tx, u.id, txInput({ type: "expense", amount: "99", currency: "MAD", date: "2026-11-02", accountId: a, merchant: "Netflix", categoryId: u.cat("Entertainment"), categorySource: "manual" }));
      const list = await listTransactions(tx, u.id, { sort: "date_desc", page: 1, pageSize: 50 }, "MAD");
      expect(list.rows.map((r) => r.category_name).sort()).toEqual(["Entertainment", "Subscriptions"]);
      const kw = await suggestCategory(tx, u.id, { merchant: "Carrefour Market", accountId: a, amountCents: 100, type: "expense" });
      expect(kw?.categoryId).toBe(u.cat("Groceries"));
      // Editing the amount of a rule-categorized transaction keeps its provenance.
      const ruleTx = list.rows.find((r) => r.category_name === "Subscriptions")!;
      await updateTransaction(tx, u.id, ruleTx.id, txInput({ type: "expense", amount: "109", currency: "MAD", date: "2026-11-02", accountId: a, merchant: "Netflix", categoryId: u.cat("Subscriptions"), categorySource: "manual" }));
      const [row] = await tx.query<{ category_source: string }>("SELECT category_source FROM transactions WHERE id=$1", [ruleTx.id]);
      expect(row.category_source).toBe("rule");
    });
  });
});

describe("csv import", () => {
  it("validates rows, detects duplicates and imports", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const a = await createAccount(tx, u.id, { name: "A", type: "checking", institution: null, currency: "MAD", openingBalance: "0", openingDate: "2026-10-01", notes: null });
      await createTransaction(tx, u.id, txInput({ type: "expense", amount: "250.50", currency: "MAD", date: "2026-11-03", accountId: a, merchant: "Marjane Californie" }));
      const rows = [
        { date: "03/11/2026", amount: "-250,50", merchant: "MARJANE CALIFORNIE" },
        { date: "05/11/2026", amount: "-1.234,00", merchant: "IKEA" },
        { date: "31/02/2026", amount: "-10", merchant: "Bad date" },
        { date: "06/11/2026", amount: "abc", merchant: "Bad amount" },
        { date: "07/11/2026", amount: "15000", merchant: "Salary Atlas" },
      ];
      const opts = { accountId: a, dateFormat: "dd/MM/yyyy" as const, decimal: "," as const, amountMode: "signed" as const, negativeIs: "expense" as const };
      const p = await previewImport(tx, u.id, rows, opts);
      expect(p.map((r) => r.status)).toEqual(["duplicate", "valid", "invalid", "invalid", "valid"]);
      expect(p[1].amount).toBe("1234.00");
      const r = await commitImport(tx, u.id, "statement.csv", rows, opts, []);
      expect(r).toMatchObject({ imported: 2, duplicates: 1, invalid: 2 });
      expect((await listAccounts(tx, u.id))[0].balance).toBe(-25_050 - 123_400 + 1_500_000);
    });
  });
});

describe("security & backup", () => {
  it("row-level security hides other users' data", async () => {
    const a = await newUser();
    const b = await newUser();
    const acct = await withUser(a.id, (tx) => createAccount(tx, a.id, { name: "Secret", type: "checking", institution: null, currency: "MAD", openingBalance: "999", openingDate: "2026-11-01", notes: null }));
    // Even a query that forgets to filter by user_id only sees the caller's rows.
    const seen = await withUser(b.id, (tx) => tx.query("SELECT id FROM accounts"));
    expect(seen).toHaveLength(0);
    const tx2 = await withUser(b.id, (tx) => tx.query("SELECT * FROM ledger_entries"));
    expect(tx2).toHaveLength(0);
    await expect(withUser(b.id, (tx) => tx.query("UPDATE accounts SET name='x' WHERE id=$1 RETURNING id", [acct]))).resolves.toHaveLength(0);
    await expect(
      withUser(b.id, (tx) => tx.query("INSERT INTO accounts (user_id, name, type, currency) VALUES ($1,'x','cash','MAD')", [a.id])),
    ).rejects.toThrow(/row-level security/);
    await expect(withUser(b.id, (tx) => tx.query("SELECT password_hash FROM users"))).rejects.toThrow(/permission denied/);
    // The audit trail is append-only for the application role.
    await expect(withUser(a.id, (tx) => tx.query("DELETE FROM audit_logs WHERE user_id=$1", [a.id]))).rejects.toThrow(/permission denied/);
  });

  it("backs up and restores into another user with identical totals", async () => {
    const a = await newUser();
    const b = await newUser();
    const backup = await withUser(a.id, async (tx) => {
      await loadDemoData(tx, a.id, TODAY);
      return buildBackup(tx, a.id);
    });
    const json = JSON.parse(JSON.stringify(backup));
    await withUser(b.id, (tx) => restoreBackup(tx, b.id, json));
    const nwA = await withUser(a.id, (tx) => currentNetWorth(tx, a.id, "MAD", TODAY));
    const nwB = await withUser(b.id, (tx) => currentNetWorth(tx, b.id, "MAD", TODAY));
    expect(nwB.netWorth).toBe(nwA.netWorth);
    const la = await withUser(a.id, (tx) => loadLines(tx, a.id, "2025-01-01", TODAY, "MAD"));
    const lb = await withUser(b.id, (tx) => loadLines(tx, b.id, "2025-01-01", TODAY, "MAD"));
    expect(summarize(lb.lines)).toEqual(summarize(la.lines));
  });
});
