"use client";
import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn("peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-ring disabled:opacity-50 data-[state=checked]:bg-brand data-[state=unchecked]:bg-input", className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ className, ...props }: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn("peer h-4 w-4 shrink-0 rounded-[5px] border border-input bg-card shadow-sm focus-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:text-primary-foreground", className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {props.checked === "indeterminate" ? <Minus className="h-3 w-3" /> : <Check className="h-3 w-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-medium transition-all focus-ring data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:text-foreground", className)}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

export function Badge({ className, tone = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "positive" | "negative" | "warning" | "info" | "brand" | "outline" }) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    positive: "bg-positive-soft text-positive",
    negative: "bg-negative-soft text-negative",
    warning: "bg-warning-soft text-warning",
    info: "bg-info-soft text-info",
    brand: "bg-brand-soft text-brand",
    outline: "border text-muted-foreground",
  };
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)} {...props} />;
}

export function Progress({ value, state = "ok", className, height = "h-2" }: { value: number; state?: "ok" | "warning" | "over" | "brand"; className?: string; height?: string }) {
  const color = { ok: "bg-foreground/70", warning: "bg-warning", over: "bg-negative", brand: "bg-brand" }[state];
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-muted", height, className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("relative overflow-hidden rounded-md bg-muted before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/40 before:to-transparent dark:before:via-white/5", className)} />;
}

export function EmptyState({ icon, title, body, action, className }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
