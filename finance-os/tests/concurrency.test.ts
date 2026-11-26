import { beforeAll, describe, expect, it } from "vitest";
import { withUser } from "@/server/db";
import { setupDb, newUser, txInput } from "./helpers";
import { balanceHistory, createAccount, listAccounts } from "@/server/services/accounts";
import { createTransaction } from "@/server/services/transactions";

// Only meaningful with real connection-level concurrency (TEST_DATABASE_URL); PGlite serializes anyway.
describe("concurrent writes", () => {
  beforeAll(async () => {
    await setupDb();
  });
  it("keeps balance snapshots consistent with the ledger under parallel writes and transfers", async () => {
    const u = await newUser();
    const [a, b] = await withUser(u.id, async (tx) => [
      await createAccount(tx, u.id, { name: "A", type: "checking", institution: null, currency: "MAD", openingBalance: "1000", openingDate: "2026-01-01", notes: null }),
      await createAccount(tx, u.id, { name: "B", type: "savings", institution: null, currency: "MAD", openingBalance: "1000", openingDate: "2026-01-01", notes: null }),
    ]);
    await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        withUser(u.id, (tx) =>
          createTransaction(
            tx,
            u.id,
            i % 3 === 0
              ? txInput({ type: "transfer", amount: "10", currency: "MAD", date: "2026-02-01", accountId: i % 2 ? a : b, toAccountId: i % 2 ? b : a })
              : txInput({ type: "expense", amount: "5", currency: "MAD", date: "2026-02-01", accountId: i % 2 ? a : b, merchant: `Shop ${i}` }),
          ),
        ),
      ),
    );
    await withUser(u.id, async (tx) => {
      for (const acc of await listAccounts(tx, u.id)) {
        const last = (await balanceHistory(tx, u.id, acc.id)).at(-1)!;
        expect(last.balance).toBe((acc.balance / 100).toFixed(2));
      }
    });
  }, 60_000);
});
