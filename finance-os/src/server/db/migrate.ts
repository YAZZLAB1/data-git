import fs from "node:fs";
import path from "node:path";
import type { Driver } from "./driver";

export const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

/** Applies pending SQL migrations in filename order. Idempotent. */
export async function runMigrations(db: Driver, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await db.transaction(async (tx) => {
      if (db.kind === "pg") await tx.query("SELECT pg_advisory_xact_lock(727274)");
      const again = await tx.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (again.length) return;
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    ran.push(file);
  }
  return ran;
}
