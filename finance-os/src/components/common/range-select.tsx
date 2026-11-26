"use client";
import * as React from "react";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/period";
import { Select } from "@/components/ui/select";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { useUpdateParams } from "@/components/layout/period-filter";

/** Per-chart date range selector stored in URL params `${param}`, `${param}f`, `${param}t`. */
export function RangeSelect({ param, value, from, to, options }: { param: string; value: RangeKey; from: string; to: string; options?: RangeKey[] }) {
  const update = useUpdateParams();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState(from);
  const [t, setT] = React.useState(to);
  const keys = options ?? (Object.keys(RANGE_OPTIONS) as RangeKey[]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <Select
            size="sm"
            aria-label="Chart date range"
            className="w-[136px]"
            value={value}
            onValueChange={(v) => {
              if (v === "custom") {
                setF(from);
                setT(to);
                setOpen(true);
              } else update({ [param]: v, [`${param}f`]: null, [`${param}t`]: null });
            }}
            options={keys.map((k) => ({ value: k, label: RANGE_OPTIONS[k] }))}
          />
        </span>
      </PopoverAnchor>
      <PopoverContent className="w-72 space-y-3" onOpenAutoFocus={(e) => e.preventDefault()}>
        <p className="text-sm font-medium">Custom range</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            <Input type="date" value={f} max={t} onChange={(e) => setF(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={t} min={f} onChange={(e) => setT(e.target.value)} />
          </Field>
        </div>
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            update({ [param]: "custom", [`${param}f`]: f, [`${param}t`]: t });
            setOpen(false);
          }}
        >
          Apply range
        </Button>
      </PopoverContent>
    </Popover>
  );
}
