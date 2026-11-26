import { beforeAll, describe, expect, it } from "vitest";
import { withUser } from "@/server/db";
import { setupDb, newUser } from "./helpers";
import { createAccount, listAccounts, balanceHistory } from "@/server/services/accounts";
import { commitImport } from "@/server/services/imports";
import { saveRule } from "@/server/services/rules";

beforeAll(async () => {
  await setupDb();
});

describe("csv import at scale", () => {
  it("imports 1,000 rows with rules applied and a consistent final balance", async () => {
    const u = await newUser();
    await withUser(u.id, async (tx) => {
      const a = await createAccount(tx, u.id, { name: "A", type: "checking", institution: null, currency: "MAD", openingBalance: "0", openingDate: "2025-01-01", notes: null });
      await saveRule(tx, u.id, null, { name: "Coffee", matchMode: "all", conditions: [{ field: "merchant", operator: "contains", value: "coffee" }], actions: [{ type: "set_category", value: u.cat("Restaurants") }], priority: 1, isActive: true });
      const rows = Array.from({ length: 1000 }, (_, i) => ({
        date: `2026-${String((i % 10) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
        amount: i % 10 === 0 ? "1500.00" : `-${(i % 97) + 1}.25`,
        merchant: `${i % 10 === 0 ? "Employer" : i % 3 === 0 ? "Coffee shop" : "Store"} ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`,
      }));
      const t0 = Date.now();
      const r = await commitImport(tx, u.id, "big.csv", rows, { accountId: a, dateFormat: "yyyy-MM-dd", decimal: ".", amountMode: "signed", negativeIs: "expense" }, []);
      const ms = Date.now() - t0;
      console.log(`imported ${r.imported} rows in ${ms}ms`);
      expect(r.imported).toBe(1000);
      const expected = rows.reduce((s, x) => s + Math.round(Number(x.amount) * 100), 0);
      expect((await listAccounts(tx, u.id))[0].balance).toBe(expected);
      expect((await balanceHistory(tx, u.id, a)).at(-1)!.balance).toBe((expected / 100).toFixed(2));
      const [{ n }] = await tx.query<{ n: number }>("SELECT count(*) AS n FROM transactions WHERE user_id=$1 AND category_source='rule'", [u.id]);
      expect(Number(n)).toBeGreaterThan(200);
    });
  }, 300_000);
});
