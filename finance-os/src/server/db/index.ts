import "server-only";
import { createDriver, databaseUrl, type Driver, type Queryable, type Tx } from "./driver";
import { runMigrations } from "./migrate";

export type { Queryable, Tx };

type Holder = { promise?: Promise<Driver> };
const g = globalThis as unknown as { __financeDb?: Holder };
const holder: Holder = (g.__financeDb ??= {});

/** Shared database handle (survives dev hot reloads). Migrations run on first use. */
export function getDb(): Promise<Driver> {
  if (!holder.promise) {
    holder.promise = (async () => {
      if (!databaseUrl() && process.env.VERCEL) {
        throw new Error(
          "DATABASE_URL is not set. The embedded database can't persist on Vercel; add a PostgreSQL connection string (e.g. Neon or Supabase) in Project Settings → Environment Variables and redeploy.",
        );
      }
      const db = await createDriver({
        url: databaseUrl(),
        dataDir: process.env.PGLITE_DATA_DIR || "./.data/pglite",
      });
      await runMigrations(db);
      return db;
    })().catch((e) => {
      holder.promise = undefined;
      throw e;
    });
  }
  return holder.promise;
}

/** For tests: inject a driver (e.g. in-memory PGlite). */
export function setDbForTesting(db: Driver) {
  holder.promise = Promise.resolve(db);
}

/**
 * Runs `fn` in a transaction scoped to one user. The transaction switches to the
 * least-privileged `finance_app` role and sets app.user_id, so row-level security
 * policies restrict every statement to that user's rows.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query("SET LOCAL ROLE finance_app");
    await tx.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    return fn(tx);
  });
}

/** Privileged access, used only by authentication (user lookup, session validation). */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}
