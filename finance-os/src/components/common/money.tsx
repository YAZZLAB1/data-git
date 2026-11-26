"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useFmt } from "./prefs";

/** Formatted amount. `tone="flow"` colours income green and keeps expenses neutral. */
export function Money({
  cents,
  currency,
  className,
  sign,
  tone = "none",
  compact,
}: {
  cents: number;
  currency?: string;
  className?: string;
  sign?: boolean;
  tone?: "none" | "flow" | "signed";
  compact?: boolean;
}) {
  const f = useFmt();
  const color = tone === "flow" ? (cents > 0 ? "text-positive" : "") : tone === "signed" ? (cents > 0 ? "text-positive" : cents < 0 ? "text-negative" : "") : "";
  const text = f.money(cents, currency, { signDisplay: sign ? "exceptZero" : "auto", compact }).replace(/^-/, "−");
  return <span className={cn("num whitespace-nowrap", color, className)}>{text}</span>;
}

/** Smoothly animates between values (respects reduced motion). */
export function AnimatedMoney({ cents, currency, className }: { cents: number; currency?: string; className?: string }) {
  const f = useFmt();
  const [shown, setShown] = React.useState(cents);
  const prev = React.useRef(cents);
  React.useEffect(() => {
    const from = prev.current;
    prev.current = cents;
    if (from === cents || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(cents);
      return;
    }
    const start = performance.now();
    const dur = 600;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (cents - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cents]);
  return <span className={cn("num", className)}>{f.money(shown, currency).replace(/^-/, "−")}</span>;
}

export function Delta({ value, inverse, suffix = "vs previous period", className }: { value: number | null; inverse?: boolean; suffix?: string; className?: string }) {
  const f = useFmt();
  if (value === null || !Number.isFinite(value)) return <span className={cn("text-xs text-muted-foreground", className)}>No comparison data</span>;
  const good = inverse ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.05;
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1 text-xs", className)}>
      <span className={cn("num shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 font-medium", flat ? "bg-muted text-muted-foreground" : good ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative")}>
        {flat ? "0%" : `${value > 0 ? "↑" : "↓"} ${f.pct(Math.abs(value))}`}
      </span>
      <span className="truncate text-muted-foreground">{suffix}</span>
    </span>
  );
}
