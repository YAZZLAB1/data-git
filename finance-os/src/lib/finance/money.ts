/**
 * Money is handled as integer minor units ("cents") in memory and as NUMERIC
 * strings in the database. Floats are never used for stored amounts.
 */
export type Cents = number;

export const CURRENCIES = ["MAD", "EUR", "USD", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_LABELS: Record<Currency, string> = {
  MAD: "Moroccan Dirham",
  EUR: "Euro",
  USD: "US Dollar",
  GBP: "British Pound",
};

/** Parse a NUMERIC string / number into integer cents without float drift. */
export function toCents(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${value}`);
    return Math.round(value * 100);
  }
  const s = value.trim();
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`Invalid amount: ${value}`);
  const sign = m[1] === "-" ? -1 : 1;
  const whole = m[2] ? parseInt(m[2], 10) : 0;
  const fracRaw = (m[3] ?? "").padEnd(3, "0");
  // round half away from zero on the 3rd decimal
  let frac = parseInt(fracRaw.slice(0, 2), 10);
  if (parseInt(fracRaw[2], 10) >= 5) frac += 1;
  const cents = whole * 100 + frac;
  return sign * cents || 0;
}

/** Integer cents -> NUMERIC string with 2 decimals ("-12.30"). */
export function centsToDecimal(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function centsToNumber(cents: Cents): number {
  return Math.round(cents) / 100;
}

export interface FormatOptions {
  locale?: string;
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
  compact?: boolean;
  hideCurrency?: boolean;
  fractionDigits?: number;
}

const fmtCache = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: Cents, currency: string, opts: FormatOptions = {}): string {
  const locale = opts.locale ?? "en-US";
  const digits = opts.fractionDigits ?? (opts.compact ? undefined : 2);
  const key = [locale, currency, opts.signDisplay, opts.compact, opts.hideCurrency, digits].join("|");
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: opts.hideCurrency ? "decimal" : "currency",
      currency: opts.hideCurrency ? undefined : currency,
      currencyDisplay: "code",
      signDisplay: opts.signDisplay ?? "auto",
      notation: opts.compact ? "compact" : "standard",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits ?? (opts.compact ? 1 : 2),
    });
    fmtCache.set(key, f);
  }
  // Use a regular space between code and number for readability ("MAD 1,234.00").
  return f.format(centsToNumber(cents)).replace(/ /g, " ");
}

export function sumCents(values: Cents[]): Cents {
  let t = 0;
  for (const v of values) t += v;
  return t;
}
