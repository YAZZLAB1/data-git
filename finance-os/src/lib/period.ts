import { addDays, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth, startOfYear, subDays, subMonths, isValid } from "date-fns";

export const fmtISO = (d: Date) => format(d, "yyyy-MM-dd");

export const PERIOD_PRESETS = {
  this_month: "This month",
  last_month: "Last month",
  last_30: "Last 30 days",
  last_90: "Last 3 months",
  ytd: "Year to date",
  last_12m: "Last 12 months",
  custom: "Custom range",
} as const;
export type PeriodPreset = keyof typeof PERIOD_PRESETS;

export interface Period {
  preset: PeriodPreset;
  from: string;
  to: string;
  label: string;
  /** The comparison window immediately before. */
  prevFrom: string;
  prevTo: string;
}

export function isISODate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && isValid(parseISO(s));
}

/** Resolve a period from URL params. Defaults to the current calendar month. */
export function resolvePeriod(params: { period?: string; from?: string; to?: string }, today: string): Period {
  const t = parseISO(today);
  const preset = (params.period && params.period in PERIOD_PRESETS ? params.period : "this_month") as PeriodPreset;
  let from: Date;
  let to: Date;
  let prevFrom: Date;
  let prevTo: Date;
  switch (preset) {
    case "last_month": {
      from = startOfMonth(subMonths(t, 1));
      to = endOfMonth(from);
      prevFrom = startOfMonth(subMonths(t, 2));
      prevTo = endOfMonth(prevFrom);
      break;
    }
    case "this_month": {
      from = startOfMonth(t);
      to = t;
      // Compare month-to-date with the same days of the previous month.
      prevFrom = startOfMonth(subMonths(t, 1));
      const sameDay = addDays(prevFrom, t.getDate() - 1);
      prevTo = sameDay > endOfMonth(prevFrom) ? endOfMonth(prevFrom) : sameDay;
      break;
    }
    case "custom": {
      const f = isISODate(params.from) ? parseISO(params.from) : startOfMonth(t);
      const e = isISODate(params.to) ? parseISO(params.to) : t;
      from = f <= e ? f : e;
      to = f <= e ? e : f;
      const len = differenceInCalendarDays(to, from) + 1;
      prevTo = subDays(from, 1);
      prevFrom = subDays(prevTo, len - 1);
      break;
    }
    default: {
      to = t;
      if (preset === "last_30") from = subDays(t, 29);
      else if (preset === "last_90") from = subDays(t, 89);
      else if (preset === "ytd") from = startOfYear(t);
      else from = addDays(subMonths(t, 12), 1);
      const len = differenceInCalendarDays(to, from) + 1;
      prevTo = subDays(from, 1);
      prevFrom = subDays(prevTo, len - 1);
    }
  }
  const label = preset === "custom" ? `${format(from, "d MMM yyyy")} – ${format(to, "d MMM yyyy")}` : PERIOD_PRESETS[preset];
  return { preset, from: fmtISO(from), to: fmtISO(to), prevFrom: fmtISO(prevFrom), prevTo: fmtISO(prevTo), label };
}

export const RANGE_OPTIONS = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  "12m": "Last 12 months",
  custom: "Custom",
} as const;
export type RangeKey = keyof typeof RANGE_OPTIONS;

export interface ChartRange {
  key: RangeKey;
  from: string;
  to: string;
  granularity: "day" | "week" | "month";
}

/** Range for an individual chart (its own selector). */
export function resolveRange(key: string | undefined, today: string, fallback: RangeKey = "6m", custom?: { from?: string; to?: string }): ChartRange {
  const k = (key && key in RANGE_OPTIONS ? key : fallback) as RangeKey;
  const t = parseISO(today);
  let from: Date;
  let to = t;
  switch (k) {
    case "7d":
      from = subDays(t, 6);
      break;
    case "30d":
      from = subDays(t, 29);
      break;
    case "3m":
      from = addDays(subMonths(t, 3), 1);
      break;
    case "6m":
      from = startOfMonth(subMonths(t, 5));
      break;
    case "12m":
      from = startOfMonth(subMonths(t, 11));
      break;
    case "custom": {
      const f = isISODate(custom?.from) ? parseISO(custom!.from!) : startOfMonth(subMonths(t, 5));
      const e = isISODate(custom?.to) ? parseISO(custom!.to!) : t;
      from = f <= e ? f : e;
      to = f <= e ? e : f;
      break;
    }
  }
  const days = differenceInCalendarDays(to, from) + 1;
  const granularity = days <= 31 ? "day" : days <= 100 ? "week" : "month";
  return { key: k, from: fmtISO(from), to: fmtISO(to), granularity };
}

export function monthStart(iso: string): string {
  return fmtISO(startOfMonth(parseISO(iso)));
}

export function monthEnd(iso: string): string {
  return fmtISO(endOfMonth(parseISO(iso)));
}

/** Today's date in a given IANA timezone, as YYYY-MM-DD. */
export function todayInZone(timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return fmtISO(new Date());
  }
}
