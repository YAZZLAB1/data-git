import { createDriver, type Driver } from "@/server/db/driver";
import { runMigrations } from "@/server/db/migrate";
import { setDbForTesting, withSystem, withUser } from "@/server/db";
import { registerUser } from "@/server/services/users";
import { listCategories } from "@/server/services/categories";
import { transactionSchema, type TransactionInput } from "@/lib/validation";

let db: Driver | null = null;

/**
 * In-memory PGlite by default. Set TEST_DATABASE_URL to run the same suite against a
 * real PostgreSQL server (run with --no-file-parallelism; tests use unique users).
 */
export async function setupDb() {
  db = process.env.TEST_DATABASE_URL ? await createDriver({ url: process.env.TEST_DATABASE_URL }) : await createDriver({ memory: true });
  await runMigrations(db);
  setDbForTesting(db);
  return db;
}

let n = 0;
export async function newUser(currency = "MAD") {
  n += 1;
  const id = await withSystem((tx) =>
    registerUser(tx, { fullName: `User ${n}`, email: `user${n}-${Date.now()}@example.com`, password: "password123", baseCurrency: currency }),
  );
  const cats = await withUser(id, (tx) => listCategories(tx, id));
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  return { id, cat };
}

export function txInput(i: TransactionInput) {
  return transactionSchema.parse(i);
}
