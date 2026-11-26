"use client";
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const NONE = "__none__";

export interface Option {
  value: string;
  label: React.ReactNode;
  group?: string;
  disabled?: boolean;
}

/** Simple select. Use NONE for an empty option (Radix disallows ""). */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  invalid,
  disabled,
  size = "md",
  id,
  "aria-label": ariaLabel,
}: {
  value: string | null | undefined;
  onValueChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  id?: string;
  "aria-label"?: string;
}) {
  const groups = Array.from(new Set(options.map((o) => o.group ?? "")));
  return (
    <SelectPrimitive.Root value={value ?? undefined} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 data-[placeholder]:text-muted-foreground/70 [&>span]:truncate",
          size === "sm" ? "h-8 text-[13px]" : "h-9",
          invalid && "border-negative",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="relative z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-card-hover data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <SelectPrimitive.Viewport className="p-1">
            {groups.map((g) => (
              <SelectPrimitive.Group key={g}>
                {g && <SelectPrimitive.Label className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g}</SelectPrimitive.Label>}
                {options
                  .filter((o) => (o.group ?? "") === g)
                  .map((o) => (
                    <SelectPrimitive.Item
                      key={o.value}
                      value={o.value}
                      disabled={o.disabled}
                      className="relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-8 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                    >
                      <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                      <SelectPrimitive.ItemIndicator className="absolute right-2">
                        <Check className="h-4 w-4" />
                      </SelectPrimitive.ItemIndicator>
                    </SelectPrimitive.Item>
                  ))}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
