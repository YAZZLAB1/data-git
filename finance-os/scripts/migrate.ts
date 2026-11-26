/** Apply database migrations: `npm run db:migrate` (uses DATABASE_URL or the embedded PGlite store). */
import { createDriver, databaseUrl } from "../src/server/db/driver";
import { runMigrations } from "../src/server/db/migrate";

async function main() {
  const db = await createDriver({ url: databaseUrl(), dataDir: process.env.PGLITE_DATA_DIR || "./.data/pglite" });
  const ran = await runMigrations(db);
  console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
