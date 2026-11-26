/** Pure helpers for CSV import: date & amount parsing with explicit formats. */
import { toCents, type Cents } from "./finance/money";
import { isValid, parse, format } from "date-fns";

export const IMPORT_DATE_FORMATS = {
  "yyyy-MM-dd": "2026-03-31",
  "dd/MM/yyyy": "31/03/2026",
  "MM/dd/yyyy": "03/31/2026",
  "dd-MM-yyyy": "31-03-2026",
  "dd.MM.yyyy": "31.03.2026",
  "yyyy/MM/dd": "2026/03/31",
  "dd/MM/yy": "31/03/26",
  "d MMM yyyy": "31 Mar 2026",
} as const;
export type ImportDateFormat = keyof typeof IMPORT_DATE_FORMATS;

export function parseImportDate(raw: string, fmt: ImportDateFormat): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  // Accept a trailing time component ("2026-03-31 14:22").
  const datePart = s.replace(/[T ]\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  const d = parse(datePart, fmt, new Date(2000, 0, 1));
  if (!isValid(d) || d.getFullYear() < 1970 || d.getFullYear() > 2100) return null;
  return format(d, "yyyy-MM-dd");
}

/**
 * Detect the date format that parses the most non-empty samples, so one bad
 * row doesn't derail detection. Ties go to the earlier (more common) format.
 */
export function detectDateFormat(samples: string[]): ImportDateFormat | null {
  const vals = samples.map((s) => s?.trim()).filter(Boolean).slice(0, 200);
  if (!vals.length) return null;
  const order: ImportDateFormat[] = ["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy", "dd-MM-yyyy", "dd.MM.yyyy", "yyyy/MM/dd", "dd/MM/yy", "d MMM yyyy"];
  let best: ImportDateFormat | null = null;
  let bestScore = 0;
  for (const f of order) {
    const score = vals.filter((v) => parseImportDate(v, f) !== null).length;
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Parse an amount with an explicit decimal separator. Handles currency codes and
 * symbols, thousands separators, "(12.50)" and trailing "12.50-" negatives.
 */
export function parseImportAmount(raw: string, decimal: "." | ","): Cents | null {
  let s = (raw ?? "").trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[A-Za-z€$£\s ']/g, "").replace(/د\.م\./g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (decimal === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cents = toCents(s);
  return negative ? -cents : cents;
}

export function detectDecimal(samples: string[]): "." | "," {
  let comma = 0;
  let dot = 0;
  for (const raw of samples.slice(0, 100)) {
    const s = (raw ?? "").replace(/[^\d.,]/g, "");
    const m = /[.,](\d{1,2})$/.exec(s);
    if (!m) continue;
    if (s[s.length - m[1].length - 1] === ",") comma++;
    else dot++;
  }
  return comma > dot ? "," : ".";
}
