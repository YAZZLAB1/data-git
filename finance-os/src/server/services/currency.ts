import type { Queryable } from "@/server/db";
import { RateTable, type ExchangeRateRecord } from "@/lib/finance/currency";
import { audit } from "./audit";

export interface RateRow extends ExchangeRateRecord {
  id: string;
  source: string;
  created_at: string;
}

export async function listRates(tx: Queryable, userId: string) {
  return tx.query<RateRow>(
    "SELECT id, base_currency, quote_currency, rate, rate_date, source, created_at FROM exchange_rates WHERE user_id=$1 ORDER BY rate_date DESC, base_currency, quote_currency",
    [userId],
  );
}

export async function loadRateTable(tx: Queryable, userId: string): Promise<RateTable> {
  return new RateTable(await listRates(tx, userId));
}

export async function upsertRate(tx: Queryable, userId: string, d: { baseCurrency: string; quoteCurrency: string; rate: string; rateDate: string }) {
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO exchange_rates (user_id, base_currency, quote_currency, rate, rate_date, source)
     VALUES ($1,$2,$3,$4,$5,'manual')
     ON CONFLICT (user_id, base_currency, quote_currency, rate_date) DO UPDATE SET rate = EXCLUDED.rate
     RETURNING id`,
    [userId, d.baseCurrency, d.quoteCurrency, d.rate, d.rateDate],
  );
  await audit(tx, userId, "upsert", "exchange_rate", row.id, d);
  return row.id;
}

export async function deleteRate(tx: Queryable, userId: string, id: string) {
  await tx.query("DELETE FROM exchange_rates WHERE id=$1 AND user_id=$2", [id, userId]);
  await audit(tx, userId, "delete", "exchange_rate", id);
}
