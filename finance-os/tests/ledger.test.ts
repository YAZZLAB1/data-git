import { beforeAll, describe, expect, it } from "vitest";
import { withUser } from "@/server/db";
import { setupDb, newUser, txInput } from "./helpers";
import { createAccount, listAccounts, updateBalance, balanceHistory } from "@/server/services/accounts";
import { createTransaction, updateTransaction, deleteTransactions } from "@/server/services/transactions";

beforeAll(async () => {
  await setupDb();
});

describe("ledger & balances", () => {
  it("updates balances for expenses, income, transfers and card payments", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const checking = await createAccount(tx, u.id, { name: "Checking", type: "checking", institution: null, currency: "MAD", openingBalance: "10000", openingDate: "2026-01-01", notes: null });
      const card = await createAccount(tx, u.id, { name: "Card", type: "credit_card", institution: null, currency: "MAD", openingBalance: "0", openingDate: "2026-01-01", notes: null });
      await createTransaction(tx, u.id, txInput({ type: "expense", amount: "500", currency: "MAD", date: "2026-01-05", accountId: checking, merchant: "Marjane", categoryId: u.cat("Groceries") }));
      await createTransaction(tx, u.id, txInput({ type: "income", amount: "8000", currency: "MAD", date: "2026-01-25", accountId: checking, merchant: "Employer", categoryId: u.cat("Salary") }));
      await createTransaction(tx, u.id, txInput({ type: "expense", amount: "1200", currency: "MAD", date: "2026-01-10", accountId: card, merchant: "Zara", categoryId: u.cat("Shopping") }));
      // Paying the card is a transfer: card owed goes down, checking goes down, no new expense.
      await createTransaction(tx, u.id, txInput({ type: "transfer", amount: "1200", currency: "MAD", date: "2026-01-28", accountId: checking, toAccountId: card }));
      const accts = await listAccounts(tx, u.id);
      const c = accts.find((a) => a.id === checking)!;
      const k = accts.find((a) => a.id === card)!;
      expect(c.balance).toBe((10000 - 500 + 8000 - 1200) * 100);
      expect(k.balance).toBe(0);
      expect(k.cls).toBe("liability");
      const hist = await balanceHistory(tx, u.id, checking);
      expect(hist[0]).toMatchObject({ date: "2025-12-31", balance: "10000.00", source: "opening" });
      expect(hist.at(-1)).toMatchObject({ date: "2026-01-28", balance: "16300.00" });
    });
  });

  it("recalculates on edit and delete, and supports balance adjustments", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const a = await createAccount(tx, u.id, { name: "Cash", type: "cash", institution: null, currency: "MAD", openingBalance: "100", openingDate: "2026-01-01", notes: null });
      const { id } = await createTransaction(tx, u.id, txInput({ type: "expense", amount: "40", currency: "MAD", date: "2026-01-02", accountId: a, merchant: "Cafe" }));
      await updateTransaction(tx, u.id, id, txInput({ type: "expense", amount: "60", currency: "MAD", date: "2026-01-02", accountId: a, merchant: "Cafe" }));
      expect((await listAccounts(tx, u.id))[0].balance).toBe(4000);
      await updateBalance(tx, u.id, a, "55.50", "2026-01-03", null);
      expect((await listAccounts(tx, u.id))[0].balance).toBe(5550);
      await deleteTransactions(tx, u.id, [id]);
      expect((await listAccounts(tx, u.id))[0].balance).toBe(5550 + 6000);
    });
  });

  it("rejects transactions dated before the account opened and bad splits", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const a = await createAccount(tx, u.id, { name: "Cash", type: "cash", institution: null, currency: "MAD", openingBalance: "0", openingDate: "2026-02-01", notes: null });
      await expect(createTransaction(tx, u.id, txInput({ type: "expense", amount: "10", currency: "MAD", date: "2026-01-15", accountId: a, merchant: "X" }))).rejects.toThrow(/opening date/);
      await expect(
        createTransaction(tx, u.id, txInput({ type: "expense", amount: "100", currency: "MAD", date: "2026-02-15", accountId: a, merchant: "X", splits: [{ categoryId: u.cat("Groceries"), amount: "60" }, { categoryId: u.cat("Shopping"), amount: "30" }] })),
      ).rejects.toThrow(/add up/);
    });
  });

  it("requires an exchange rate for foreign-currency amounts", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const a = await createAccount(tx, u.id, { name: "Checking", type: "checking", institution: null, currency: "MAD", openingBalance: "0", openingDate: "2026-01-01", notes: null });
      await expect(createTransaction(tx, u.id, txInput({ type: "expense", amount: "10", currency: "EUR", date: "2026-01-15", accountId: a, merchant: "Hotel" }))).rejects.toThrow(/exchange rate/);
      await createTransaction(tx, u.id, txInput({ type: "expense", amount: "10", currency: "EUR", fxRate: "10.85", date: "2026-01-15", accountId: a, merchant: "Hotel" }));
      expect((await listAccounts(tx, u.id))[0].balance).toBe(-10850);
    });
  });
});
