/**
 * Database driver abstraction. Two interchangeable backends:
 *  - `pg`     : any PostgreSQL 15+ server (incl. Supabase) when DATABASE_URL is set.
 *  - PGlite   : embedded PostgreSQL persisted to disk, used when DATABASE_URL is empty.
 * Both return DATE as 'YYYY-MM-DD' strings, NUMERIC as strings (never floats),
 * timestamps as ISO strings and bigint counts as numbers.
 */
import fs from "node:fs";
import path from "node:path";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Tx extends Queryable {
  /** Run multi-statement SQL without parameters. */
  exec(sql: string): Promise<void>;
}

export interface Driver extends Queryable {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  kind: "pg" | "pglite";
}

function normalizeTimestamp(v: string): string {
  // '2026-11-26 10:00:00.123+00' -> ISO 8601
  let s = v.replace(" ", "T");
  s = s.replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

const OID = { int8: 20, date: 1082, numeric: 1700, timestamp: 1114, timestamptz: 1184 } as const;

async function createPgDriver(url: string): Promise<Driver> {
  const pg = await import("pg");
  const types = pg.default.types;
  types.setTypeParser(OID.date, (v: string) => v);
  types.setTypeParser(OID.numeric, (v: string) => v);
  types.setTypeParser(OID.int8, (v: string) => Number(v));
  types.setTypeParser(OID.timestamptz, normalizeTimestamp);
  types.setTypeParser(OID.timestamp, normalizeTimestamp);
  const ssl = /sslmode=require|supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined;
  // Serverless platforms run many small instances: keep each pool small.
  const max = Number(process.env.PG_POOL_MAX) || (process.env.VERCEL ? 3 : 10);
  const pool = new pg.default.Pool({ connectionString: url, max, ssl, idleTimeoutMillis: 10_000 });
  return {
    kind: "pg",
    async query(sql, params) {
      const r = await pool.query(sql, params as unknown[]);
      return r.rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: Tx = {
          query: async (sql, params) => (await client.query(sql, params as unknown[])).rows,
          exec: async (sql) => {
            await client.query(sql);
          },
        };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPgliteDriver(dataDir: string | undefined): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) fs.mkdirSync(path.resolve(dataDir), { recursive: true });
  const parsers = {
    [OID.date]: (v: string) => v,
    [OID.numeric]: (v: string) => v,
    [OID.int8]: (v: string) => Number(v),
    [OID.timestamptz]: normalizeTimestamp,
    [OID.timestamp]: normalizeTimestamp,
  };
  const db = dataDir ? new PGlite(path.resolve(dataDir), { parsers }) : new PGlite({ parsers });
  await db.waitReady;
  return {
    kind: "pglite",
    async query(sql, params) {
      const r = await db.query(sql, params as unknown[]);
      return r.rows as never;
    },
    async exec(sql) {
      await db.exec(sql);
    },
    async transaction(fn) {
      return db.transaction(async (t) => {
        const tx: Tx = {
          query: async (sql, params) => (await t.query(sql, params as unknown[])).rows as never,
          exec: async (sql) => {
            await t.exec(sql);
          },
        };
        return fn(tx);
      });
    },
    async close() {
      await db.close();
    },
  };
}

export async function createDriver(opts: { url?: string; dataDir?: string; memory?: boolean }): Promise<Driver> {
  if (opts.url) return createPgDriver(opts.url);
  return createPgliteDriver(opts.memory ? undefined : opts.dataDir ?? "./.data/pglite");
}
