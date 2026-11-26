import type { Cents } from "./money";

export interface ExchangeRateRecord {
  base_currency: string;
  quote_currency: string;
  rate: string; // NUMERIC string: 1 base = rate quote
  rate_date: string; // YYYY-MM-DD
}

export interface ResolvedRate {
  rate: number; // multiply an amount in `from` by this to get `to`
  rateDate: string; // date of the stored rate(s) used
  /** True when no rate on/before the date existed and the closest later rate was used. */
  estimated: boolean;
  path: string; // human readable, e.g. "EUR→MAD" or "USD→EUR→MAD (cross)"
}

export interface Conversion extends ResolvedRate {
  cents: Cents;
}

/**
 * Lookup table over user-entered exchange rates. Only stored rates are used:
 * direct pair, inverse pair, or a cross rate through one intermediate currency.
 * If nothing is stored, conversion returns null — amounts are never treated as
 * directly additive across currencies.
 */
export class RateTable {
  private byPair = new Map<string, { date: string; rate: number }[]>();

  constructor(rates: ExchangeRateRecord[]) {
    for (const r of rates) {
      const rate = Number(r.rate);
      if (!(rate > 0)) continue;
      this.push(`${r.base_currency}>${r.quote_currency}`, r.rate_date, rate);
      this.push(`${r.quote_currency}>${r.base_currency}`, r.rate_date, 1 / rate, true);
    }
    for (const list of this.byPair.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  }

  private push(key: string, date: string, rate: number, inverse = false) {
    const list = this.byPair.get(key) ?? [];
    // A direct quote for the same date wins over an inverted one.
    const existing = list.find((x) => x.date === date);
    if (existing) {
      if (!inverse) existing.rate = rate;
    } else list.push({ date, rate });
    this.byPair.set(key, list);
  }

  private pick(from: string, to: string, date: string): { rate: number; date: string; estimated: boolean } | null {
    const list = this.byPair.get(`${from}>${to}`);
    if (!list || list.length === 0) return null;
    let best: { date: string; rate: number } | null = null;
    for (const x of list) {
      if (x.date <= date) best = x;
      else break;
    }
    if (best) return { rate: best.rate, date: best.date, estimated: false };
    return { rate: list[0].rate, date: list[0].date, estimated: true };
  }

  currencies(): string[] {
    const s = new Set<string>();
    for (const k of this.byPair.keys()) k.split(">").forEach((c) => s.add(c));
    return [...s];
  }

  resolve(from: string, to: string, date: string): ResolvedRate | null {
    if (from === to) return { rate: 1, rateDate: date, estimated: false, path: from };
    const direct = this.pick(from, to, date);
    if (direct && !direct.estimated) return { rate: direct.rate, rateDate: direct.date, estimated: false, path: `${from}→${to}` };
    let cross: ResolvedRate | null = null;
    for (const mid of this.currencies()) {
      if (mid === from || mid === to) continue;
      const a = this.pick(from, mid, date);
      const b = this.pick(mid, to, date);
      if (!a || !b) continue;
      const candidate: ResolvedRate = {
        rate: a.rate * b.rate,
        rateDate: a.date < b.date ? a.date : b.date,
        estimated: a.estimated || b.estimated,
        path: `${from}→${mid}→${to} (cross)`,
      };
      if (!candidate.estimated) return candidate;
      cross ??= candidate;
    }
    if (direct) return { rate: direct.rate, rateDate: direct.date, estimated: true, path: `${from}→${to}` };
    return cross;
  }

  convert(cents: Cents, from: string, to: string, date: string): Conversion | null {
    const r = this.resolve(from, to, date);
    if (!r) return null;
    return { ...r, cents: Math.round(cents * r.rate) };
  }
}
