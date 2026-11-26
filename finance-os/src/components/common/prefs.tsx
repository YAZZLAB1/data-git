"use client";
import * as React from "react";
import { format, parseISO } from "date-fns";
import { formatMoney, type FormatOptions } from "@/lib/finance/money";

export interface Prefs {
  baseCurrency: string;
  locale: string;
  dateFormat: string;
  today: string;
  timezone: string;
}

const PrefsContext = React.createContext<Prefs>({ baseCurrency: "MAD", locale: "en-US", dateFormat: "dd MMM yyyy", today: "2026-01-01", timezone: "UTC" });

export function PrefsProvider({ value, children }: { value: Prefs; children: React.ReactNode }) {
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  return React.useContext(PrefsContext);
}

export function useFmt() {
  const p = usePrefs();
  return React.useMemo(
    () => ({
      ...p,
      money: (cents: number, currency?: string, opts: FormatOptions = {}) => formatMoney(cents, currency ?? p.baseCurrency, { locale: p.locale, ...opts }),
      date: (iso: string) => {
        try {
          return format(parseISO(iso), p.dateFormat);
        } catch {
          return iso;
        }
      },
      shortDate: (iso: string) => {
        try {
          return format(parseISO(iso), "d MMM");
        } catch {
          return iso;
        }
      },
      pct: (n: number | null | undefined, digits?: number) => {
        if (n === null || n === undefined || !Number.isFinite(n)) return "—";
        const d = digits ?? (Math.abs(n) < 10 ? 1 : 0);
        return `${n.toFixed(d)}%`;
      },
    }),
    [p],
  );
}
