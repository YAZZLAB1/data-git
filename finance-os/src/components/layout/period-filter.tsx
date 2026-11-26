"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { PERIOD_PRESETS, resolvePeriod, type PeriodPreset } from "@/lib/period";
import { Select } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { usePrefs } from "@/components/common/prefs";

export function useUpdateParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return React.useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
}

export function PeriodFilter() {
  const params = useSearchParams();
  const update = useUpdateParams();
  const { today } = usePrefs();
  const period = resolvePeriod({ period: params.get("period") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined }, today);
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(period.from);
  const [to, setTo] = React.useState(period.to);
  return (
    <div className="flex items-center gap-1.5">
      <Select
        size="sm"
        aria-label="Reporting period"
        className="w-[160px]"
        value={period.preset}
        onValueChange={(v) => {
          if (v === "custom") {
            setFrom(period.from);
            setTo(period.to);
            setOpen(true);
          } else update({ period: v === "this_month" ? null : v, from: null, to: null });
        }}
        options={(Object.keys(PERIOD_PRESETS) as PeriodPreset[]).map((k) => ({ value: k, label: k === "custom" && period.preset === "custom" ? period.label : PERIOD_PRESETS[k] }))}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="Custom date range">
            <CalendarRange />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-3">
          <p className="text-sm font-medium">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From">
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <Button
            className="w-full"
            size="sm"
            disabled={!from || !to}
            onClick={() => {
              update({ period: "custom", from, to });
              setOpen(false);
            }}
          >
            Apply range
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
