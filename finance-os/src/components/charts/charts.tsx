"use client";
import * as React from "react";
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useFmt } from "@/components/common/prefs";
import { ChartTooltip, Legend } from "./chart-card";
import { OTHER_COLOR } from "@/lib/constants";
import { cn } from "@/lib/utils";

const axisProps = { tickLine: false, axisLine: false, fontSize: 11, tickMargin: 8 } as const;

function useMoneyAxis() {
  const f = useFmt();
  return {
    tick: (v: number) => f.money(v, undefined, { compact: true, hideCurrency: true }),
    full: (v: number) => f.money(v),
  };
}

// ------------------------------------------------------------------ cash flow
export interface FlowPoint {
  label: string;
  income: number;
  expenses: number;
  net: number;
}

export function CashFlowChart({ data, showNet = true }: { data: FlowPoint[]; showNet?: boolean }) {
  const m = useMoneyAxis();
  return (
    <div className="flex h-full flex-col gap-2">
      <Legend
        items={[
          { label: "Income", color: "var(--chart-income)" },
          { label: "Expenses", color: "var(--chart-expense)" },
          ...(showNet ? [{ label: "Net cash flow", color: "var(--chart-net)", dashed: true }] : []),
        ]}
      />
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="g-income" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-income)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--chart-income)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="g-expense" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-expense)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--chart-expense)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis dataKey="label" {...axisProps} minTickGap={24} />
            <YAxis {...axisProps} tickFormatter={m.tick} width={56} />
            <ReferenceLine y={0} stroke="var(--chart-axis)" strokeOpacity={0.4} />
            <Tooltip content={<ChartTooltip format={m.full} />} cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }} />
            <Area type="monotone" dataKey="income" name="Income" stroke="var(--chart-income)" strokeWidth={2} fill="url(#g-income)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} animationDuration={700} />
            <Area type="monotone" dataKey="expenses" name="Expenses" stroke="var(--chart-expense)" strokeWidth={2} fill="url(#g-expense)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} animationDuration={700} />
            {showNet && <Line type="monotone" dataKey="net" name="Net cash flow" stroke="var(--chart-net)" strokeWidth={2} strokeDasharray="5 4" dot={false} animationDuration={700} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ monthly bars
export function MonthlyFlowBars({ data }: { data: FlowPoint[] }) {
  const m = useMoneyAxis();
  return (
    <div className="flex h-full flex-col gap-2">
      <Legend items={[{ label: "Income", color: "var(--chart-income)" }, { label: "Expenses", color: "var(--chart-expense)" }, { label: "Net cash flow", color: "var(--chart-net)", dashed: true }]} />
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="24%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={m.tick} width={56} />
            <ReferenceLine y={0} stroke="var(--chart-axis)" strokeOpacity={0.5} />
            <Tooltip content={<ChartTooltip format={m.full} />} />
            <Bar dataKey="income" name="Income" fill="var(--chart-income)" radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={600} />
            <Bar dataKey="expenses" name="Expenses" fill="var(--chart-expense)" radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={600} />
            <Line type="monotone" dataKey="net" name="Net cash flow" stroke="var(--chart-net)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: "var(--chart-net)", strokeWidth: 0 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ donut
export interface Slice {
  id: string | null;
  name: string;
  value: number;
  color: string;
}

/** Folds anything beyond `max` slices into "Other" so colours stay distinguishable. */
export function foldSlices(data: Slice[], max = 7): (Slice & { folded?: Slice[] })[] {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= max + 1) return sorted;
  const head = sorted.slice(0, max);
  const tail = sorted.slice(max);
  return [...head, { id: "__other__", name: `Other (${tail.length})`, value: tail.reduce((s, x) => s + x.value, 0), color: OTHER_COLOR, folded: tail }];
}

export function DonutChart({
  data,
  onSelect,
  selected,
  centerLabel,
  currency,
  legendLimit = 8,
}: {
  data: Slice[];
  onSelect?: (s: Slice) => void;
  selected?: string | null;
  centerLabel: string;
  currency?: string;
  legendLimit?: number;
}) {
  const f = useFmt();
  const slices = foldSlices(data);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const [hover, setHover] = React.useState<number | null>(null);
  const focus = hover !== null ? slices[hover] : null;
  return (
    <div className="grid h-full grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(180px,1fr)_1.1fr]">
      <div className="relative h-full min-h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="64%"
              outerRadius="92%"
              paddingAngle={1.2}
              stroke="hsl(var(--card))"
              strokeWidth={2}
              cornerRadius={4}
              onMouseEnter={(_, i) => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={(_, i) => onSelect?.(slices[i])}
              animationDuration={700}
              className={cn(onSelect && "cursor-pointer")}
            >
              {slices.map((s, i) => (
                <Cell key={String(s.id) + i} fill={s.color} opacity={selected && selected !== s.id ? 0.35 : hover !== null && hover !== i ? 0.55 : 1} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-[60%] truncate text-[11px] text-muted-foreground">{focus ? focus.name : centerLabel}</span>
          <span className="num text-lg font-semibold tracking-tight">{f.money(focus ? focus.value : total, currency, { fractionDigits: 0 })}</span>
          {focus && <span className="num text-[11px] text-muted-foreground">{f.pct((focus.value / total) * 100)}</span>}
        </div>
      </div>
      <ul className="space-y-0.5">
        {slices.slice(0, legendLimit).map((s, i) => (
          <li key={String(s.id) + i}>
            <button
              type="button"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(s)}
              disabled={!onSelect}
              className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors", onSelect && "hover:bg-accent", selected === s.id && "bg-accent")}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="flex-1 truncate">{s.name}</span>
              <span className="num text-muted-foreground">{f.pct((s.value / total) * 100)}</span>
              <span className="num w-[92px] text-right font-medium">{f.money(s.value, currency, { fractionDigits: 0 })}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ horizontal bars
export function HBarChart({ data, onSelect, color = "var(--chart-expense)" }: { data: { id?: string | null; name: string; value: number; color?: string }[]; onSelect?: (id: string | null | undefined) => void; color?: string }) {
  const f = useFmt();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2.5">
      {data.map((d, i) => (
        <li key={`${d.name}-${i}`}>
          <button type="button" disabled={!onSelect} onClick={() => onSelect?.(d.id)} className={cn("group w-full text-left", onSelect && "cursor-pointer")}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="truncate group-hover:underline">{d.name}</span>
              <span className="num font-medium">{f.money(d.value, undefined, { fractionDigits: 0 })}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? color }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ net worth
export function NetWorthChart({ data }: { data: { label: string; assets: number; liabilities: number; netWorth: number }[] }) {
  const m = useMoneyAxis();
  return (
    <div className="flex h-full flex-col gap-2">
      <Legend items={[{ label: "Net worth", color: "var(--chart-net)" }, { label: "Assets", color: "var(--chart-assets)" }, { label: "Liabilities", color: "var(--chart-liabilities)" }]} />
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={m.tick} width={60} />
            <Tooltip content={<ChartTooltip format={m.full} />} />
            <Line type="monotone" dataKey="assets" name="Assets" stroke="var(--chart-assets)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="liabilities" name="Liabilities" stroke="var(--chart-liabilities)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="netWorth" name="Net worth" stroke="var(--chart-net)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--chart-net)", strokeWidth: 0 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ balance history (single series)
export function BalanceChart({ data, color = "var(--chart-net)" }: { data: { label: string; value: number }[]; color?: string }) {
  const m = useMoneyAxis();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="g-bal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" {...axisProps} minTickGap={30} />
        <YAxis {...axisProps} tickFormatter={m.tick} width={60} />
        <Tooltip content={<ChartTooltip format={m.full} />} />
        <Area type="stepAfter" dataKey="value" name="Balance" stroke={color} strokeWidth={2} fill="url(#g-bal)" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------------ stacked categories
export function StackedCategoryChart({ data, series }: { data: Record<string, number | string>[]; series: { key: string; name: string; color: string }[] }) {
  const m = useMoneyAxis();
  return (
    <div className="flex h-full flex-col gap-2">
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={m.tick} width={56} />
            <Tooltip content={<ChartTooltip format={m.full} />} />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} stroke="hsl(var(--card))" strokeWidth={1} radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={40} animationDuration={600} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ budget vs actual
export function BudgetVsActualChart({ data }: { data: { name: string; budget: number; actual: number; state: "ok" | "warning" | "over" }[] }) {
  const m = useMoneyAxis();
  return (
    <div className="flex h-full flex-col gap-2">
      <Legend items={[{ label: "Budget", color: "var(--chart-budget)" }, { label: "Actual", color: "hsl(var(--foreground) / 0.7)" }, { label: "Over budget", color: "var(--chart-expense)" }]} />
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="name" {...axisProps} interval={0} tick={{ fontSize: 10 }} height={40} tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + "…" : v)} />
            <YAxis {...axisProps} tickFormatter={m.tick} width={56} />
            <Tooltip content={<ChartTooltip format={m.full} />} />
            <Bar dataKey="budget" name="Budget" fill="var(--chart-budget)" radius={[4, 4, 0, 0]} maxBarSize={26} />
            <Bar dataKey="actual" name="Actual" radius={[4, 4, 0, 0]} maxBarSize={26}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.state === "over" ? "var(--chart-expense)" : d.state === "warning" ? "hsl(var(--warning))" : "hsl(var(--foreground) / 0.7)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ savings rate
export function SavingsRateChart({ data }: { data: { label: string; rate: number | null }[] }) {
  const f = useFmt();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="g-rate" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-net)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--chart-net)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v: number) => `${v}%`} width={44} />
        <ReferenceLine y={0} stroke="var(--chart-axis)" strokeOpacity={0.6} />
        <Tooltip content={<ChartTooltip format={(v) => f.pct(v)} />} />
        <Area type="monotone" dataKey="rate" name="Savings rate" stroke="var(--chart-net)" strokeWidth={2} fill="url(#g-rate)" connectNulls dot={{ r: 3, fill: "var(--chart-net)", strokeWidth: 0 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------------ daily heatmap
const RAMP = ["#cce3fd", "#9dc8f7", "#6aabf1", "#338ced", "#1b64be", "#0e3d7e"];

export function DailyHeatmap({ days }: { days: { date: string; value: number }[] }) {
  const f = useFmt();
  const [hover, setHover] = React.useState<{ date: string; value: number } | null>(null);
  if (!days.length) return null;
  const nonzero = days.map((d) => d.value).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))] ?? 0;
  const cuts = [q(0.2), q(0.4), q(0.6), q(0.8), q(0.95)];
  const level = (v: number) => (v <= 0 ? -1 : cuts.findIndex((c) => v <= c) === -1 ? 5 : cuts.findIndex((c) => v <= c));
  const first = new Date(days[0].date + "T00:00:00");
  const offset = (first.getDay() + 6) % 7; // Monday first
  const cells: ({ date: string; value: number } | null)[] = [...Array(offset).fill(null), ...days];
  const weeks: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const top = [...days].sort((a, b) => b.value - a.value).slice(0, 3).filter((d) => d.value > 0);
  return (
    <div className="space-y-3">
      <div className="flex gap-3 overflow-x-auto pb-1">
        <div className="grid grid-rows-7 gap-[3px] pt-0 text-[10px] text-muted-foreground">
          {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((d, i) => (
            <span key={i} className="h-[13px] leading-[13px]">
              {d}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {weeks.map((w, wi) => (
            <div key={wi} className="grid grid-rows-7 gap-[3px]">
              {Array.from({ length: 7 }).map((_, di) => {
                const c = w[di];
                if (!c) return <span key={di} className="h-[13px] w-[13px]" />;
                const l = level(c.value);
                return (
                  <span
                    key={di}
                    role="img"
                    aria-label={`${f.date(c.date)}: ${f.money(c.value)}`}
                    onMouseEnter={() => setHover(c)}
                    onMouseLeave={() => setHover(null)}
                    className="h-[13px] w-[13px] rounded-[3px] ring-inset transition-transform hover:scale-125 hover:ring-1 hover:ring-foreground/40"
                    style={{ background: l < 0 ? "hsl(var(--muted))" : RAMP[l] }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="num min-h-4">{hover ? `${f.date(hover.date)} · ${f.money(hover.value)}` : top.length ? `Highest: ${top.map((t) => `${f.shortDate(t.date)} (${f.money(t.value, undefined, { fractionDigits: 0 })})`).join(", ")}` : "No spending in this range"}</span>
        <span className="flex items-center gap-1">
          Less
          {["hsl(var(--muted))", ...RAMP].map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
