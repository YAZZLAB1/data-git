"use client";
import * as React from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import type { AnalyticsData } from "@/server/queries/analytics";
import type { TransactionView } from "@/server/services/transactions";
import { categoryTransactionsAction, getTransactionAction } from "@/server/actions/transactions";
import { ChartCard } from "@/components/charts/chart-card";
import { BudgetVsActualChart, CashFlowChart, DailyHeatmap, DonutChart, HBarChart, MonthlyFlowBars, NetWorthChart, SavingsRateChart, StackedCategoryChart, type Slice } from "@/components/charts/charts";
import { RangeSelect } from "@/components/common/range-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFmt } from "@/components/common/prefs";
import { useUpdateParams } from "@/components/layout/period-filter";
import { useQuickAdd } from "@/components/layout/quick-add";
import { CompactTxRow } from "@/components/transactions/tx-row";
import { PALETTE } from "@/lib/constants";
import { missingRateMessage } from "@/lib/copy";
import { cn } from "@/lib/utils";

const AS_OF = { today: "Today", m1: "End of last month", m3: "3 months ago", m6: "6 months ago", m12: "12 months ago" };

export function AnalyticsView({ d }: { d: AnalyticsData }) {
  const f = useFmt();
  const update = useUpdateParams();
  const [tab, setTab] = React.useState(d.tab);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onValueChange={(t) => {
            setTab(t);
            update({ tab: t === "cashflow" ? null : t });
          }}
        >
          <TabsList>
            <TabsTrigger value="cashflow">Cash flow</TabsTrigger>
            <TabsTrigger value="spending">Spending</TabsTrigger>
            <TabsTrigger value="networth">Net worth & accounts</TabsTrigger>
            <TabsTrigger value="budgets">Budgets</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          All amounts in {f.baseCurrency}. Transfers between your accounts are excluded from income and expenses.
        </p>
      </div>
      {d.missing.length > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" />
          {d.missing.map((m) => missingRateMessage(m.count, m.currency, f.baseCurrency)).join(" ")}
        </p>
      )}
      {tab === "cashflow" && <CashFlowTab d={d} />}
      {tab === "spending" && <SpendingTab d={d} />}
      {tab === "networth" && <NetWorthTab d={d} />}
      {tab === "budgets" && <BudgetTab d={d} />}
    </div>
  );
}

function CashFlowTab({ d }: { d: AnalyticsData }) {
  const f = useFmt();
  const update = useUpdateParams();
  const s = d.incomeVsExpensesSummary;
  return (
    <div className="space-y-4">
      <ChartCard
        title="Income vs expenses"
        description={`Is spending rising or falling relative to income? Total: ${f.money(s.income, undefined, { fractionDigits: 0 })} in, ${f.money(s.expenses, undefined, { fractionDigits: 0 })} out.`}
        height={320}
        empty={d.incomeVsExpenses.every((p) => !p.income && !p.expenses)}
        actions={<RangeSelect param="r1" value={d.ranges.r1.key} from={d.ranges.r1.from} to={d.ranges.r1.to} />}
        table={{ headers: ["Period", "Income", "Expenses", "Net"], rows: d.incomeVsExpenses.map((p) => [p.label, f.money(p.income), f.money(p.expenses), f.money(p.net)]) }}
      >
        <CashFlowChart data={d.incomeVsExpenses} showNet={false} />
      </ChartCard>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Monthly cash flow"
          description="Income, expenses and net cash flow per month."
          height={300}
          empty={d.monthly.every((p) => !p.income && !p.expenses)}
          actions={<Select size="sm" className="w-[136px]" aria-label="Months shown" value={d.ranges.r3.key} onValueChange={(v) => update({ r3: v === "12m" ? null : v })} options={[{ value: "6m", label: "Last 6 months" }, { value: "12m", label: "Last 12 months" }]} />}
          table={{ headers: ["Month", "Income", "Expenses", "Net"], rows: d.monthly.map((p) => [p.label, f.money(p.income), f.money(p.expenses), f.money(p.net)]) }}
        >
          <MonthlyFlowBars data={d.monthly} />
        </ChartCard>
        <ChartCard
          title="Savings rate"
          description="(Income − expenses) ÷ income, per month. Months without income are left blank."
          height={300}
          empty={d.rate.every((p) => p.rate === null)}
          actions={<RangeSelect param="r7" value={d.ranges.r7.key} from={d.ranges.r7.from} to={d.ranges.r7.to} options={["3m", "6m", "12m", "custom"]} />}
          table={{ headers: ["Month", "Income", "Expenses", "Savings rate"], rows: d.rate.map((p) => [p.label, f.money(p.income), f.money(p.expenses), f.pct(p.rate)]) }}
        >
          <SavingsRateChart data={d.rate} />
        </ChartCard>
      </div>
    </div>
  );
}

function SpendingTab({ d }: { d: AnalyticsData }) {
  const f = useFmt();
  const quick = useQuickAdd();
  const [selected, setSelected] = React.useState<Slice | null>(null);
  const [rows, setRows] = React.useState<TransactionView[] | null>(null);
  const defaultSel = d.trend.categories.slice(0, 5).map((c) => c.key);
  const [chosen, setChosen] = React.useState<string[]>(defaultSel);
  React.useEffect(() => setChosen(d.trend.categories.slice(0, 5).map((c) => c.key)), [d.trend.categories]);

  const select = async (s: Slice) => {
    if (s.id === "__other__") return;
    if (selected?.id === s.id) {
      setSelected(null);
      setRows(null);
      return;
    }
    setSelected(s);
    setRows(null);
    const r = await categoryTransactionsAction(s.id, d.period.from, d.period.to);
    if (r.ok) setRows(r.data);
    else toast.error(r.error);
  };
  // Each series keeps its category colour (matching the donut); a colour already used by an
  // earlier visible series falls back to the next unused palette slot so stacks stay distinguishable.
  const series = (() => {
    const used = new Set<string>();
    return d.trend.categories
      .filter((c) => chosen.includes(c.key))
      .map((c) => {
        let color = c.color.toLowerCase();
        if (used.has(color)) color = PALETTE.find((p) => !used.has(p.toLowerCase())) ?? color;
        used.add(color.toLowerCase());
        return { key: c.key, name: c.name, color };
      });
  })();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-3"
          title="Spending by category"
          description={`${d.period.label} (change it in the top bar). Select a category to list its transactions.`}
          height={280}
          empty={d.byCategory.length === 0}
          table={{ headers: ["Category", "Amount", "Share"], rows: d.byCategory.map((c) => [c.name, f.money(c.value), f.pct((c.value / d.byCategory.reduce((s, x) => s + x.value, 0)) * 100)]) }}
        >
          <DonutChart data={d.byCategory} centerLabel="Total spent" onSelect={select} selected={selected?.id ?? null} />
        </ChartCard>
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>{selected ? selected.name : "Transactions"}</CardTitle>
              <CardDescription>{selected ? `${f.money(selected.value)} · ${d.period.label}` : "Select a category in the chart to filter this list."}</CardDescription>
            </div>
            {selected && (
              <Button variant="ghost" size="icon-sm" aria-label="Clear category filter" onClick={() => { setSelected(null); setRows(null); }}>
                <X />
              </Button>
            )}
          </CardHeader>
          <CardContent className="max-h-[300px] overflow-y-auto px-3">
            {!selected ? (
              <p className="px-2 py-10 text-center text-sm text-muted-foreground">No category selected.</p>
            ) : rows === null ? (
              <p className="px-2 py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                {rows.map((t) => (
                  <CompactTxRow key={t.id} t={t} onClick={async () => { const r = await getTransactionAction(t.id); if (r.ok) quick.open({ editing: r.data }); }} />
                ))}
                <Button asChild variant="ghost" size="sm" className="mt-2 w-full">
                  <Link href={`/transactions?category=${selected.id ?? "uncategorized"}&from=${d.period.from}&to=${d.period.to}`}>
                    Open in Transactions <ArrowRight />
                  </Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <ChartCard
        title="Spending trends"
        description="Compare categories over time. Choose which categories to show."
        height={320}
        empty={d.trend.rows.length === 0 || series.length === 0}
        actions={<RangeSelect param="r5" value={d.ranges.r5.key} from={d.ranges.r5.from} to={d.ranges.r5.to} options={["3m", "6m", "12m", "custom"]} />}
        table={{ headers: ["Period", ...series.map((s) => s.name)], rows: d.trend.rows.map((r) => [String(r.label), ...series.map((s) => f.money(Number(r[s.key] ?? 0)))]) }}
        footer={
          <div className="mt-3 flex flex-wrap gap-1.5">
            {d.trend.categories.map((c) => {
              const on = chosen.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChosen((x) => (on ? x.filter((k) => k !== c.key) : x.length >= 8 ? x : [...x, c.key]))}
                  className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-foreground/20 bg-foreground text-background" : "text-muted-foreground hover:bg-accent")}
                >
                  {c.name}
                </button>
              );
            })}
            <span className="self-center text-xs text-muted-foreground">Up to 8 at a time.</span>
          </div>
        }
      >
        <StackedCategoryChart data={d.trend.rows} series={series} />
      </ChartCard>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Daily expenses"
          description="Darker days are the days you spent the most."
          height="auto"
          empty={d.daily.every((x) => x.value === 0)}
          actions={<RangeSelect param="r8" value={d.ranges.r8.key} from={d.ranges.r8.from} to={d.ranges.r8.to} options={["30d", "3m", "6m", "12m", "custom"]} />}
          table={{ headers: ["Date", "Spent"], rows: [...d.daily].filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 60).map((x) => [f.date(x.date), f.money(x.value)]) }}
        >
          <DailyHeatmap days={d.daily} />
        </ChartCard>
        <ChartCard title="Top merchants" description={`Where your money went · ${d.period.label}`} height="auto" empty={d.merchants.length === 0} table={{ headers: ["Merchant", "Spent"], rows: d.merchants.map((m) => [m.name, f.money(m.value)]) }}>
          <HBarChart data={d.merchants.map((m) => ({ name: m.name, value: m.value }))} color="var(--chart-net)" />
        </ChartCard>
      </div>
    </div>
  );
}

function NetWorthTab({ d }: { d: AnalyticsData }) {
  const f = useFmt();
  const update = useUpdateParams();
  const incomplete = d.netWorth.some((p) => p.incomplete);
  const total = d.distribution.reduce((s, x) => s + x.value, 0);
  return (
    <div className="space-y-4">
      <ChartCard
        title="Net worth"
        description="From recorded end-of-day balance snapshots — never projected backward from today's balances."
        height={320}
        empty={!d.netWorthHasData}
        actions={<RangeSelect param="r4" value={d.ranges.r4.key} from={d.ranges.r4.from} to={d.ranges.r4.to} options={["3m", "6m", "12m", "custom"]} />}
        table={{ headers: ["Date", "Assets", "Liabilities", "Net worth"], rows: d.netWorth.map((p) => [f.date(p.date), f.money(p.assets), f.money(p.liabilities), f.money(p.netWorth)]) }}
        footer={incomplete ? <p className="mt-2 text-xs text-warning">Some points exclude foreign-currency balances because no exchange rate was stored for that date.</p> : undefined}
      >
        <NetWorthChart data={d.netWorth} />
      </ChartCard>
      <ChartCard
        title="Money by account"
        description={`How your assets are spread across accounts · as of ${f.date(d.asOf.date)}`}
        height={260}
        empty={d.distribution.length === 0}
        actions={<Select size="sm" className="w-[160px]" aria-label="As of" value={d.asOf.key} onValueChange={(v) => update({ asof: v === "today" ? null : v })} options={Object.entries(AS_OF).map(([k, l]) => ({ value: k, label: l }))} />}
        table={{ headers: ["Account", "Balance", "Share"], rows: d.distribution.map((a) => [a.name, f.money(a.value), f.pct((a.value / total) * 100)]) }}
      >
        <DonutChart data={d.distribution.map((a, i) => ({ id: a.id, name: a.name, value: a.value, color: PALETTE[i % PALETTE.length] }))} centerLabel="Total assets" />
      </ChartCard>
    </div>
  );
}

function BudgetTab({ d }: { d: AnalyticsData }) {
  const f = useFmt();
  const update = useUpdateParams();
  return (
    <ChartCard
      title="Budget vs actual"
      description={`Planned (including rollover) vs actual spending per category · ${format(parseISO(d.budget.month), "MMMM yyyy")}`}
      height={360}
      empty={d.budget.items.length === 0}
      actions={<Select size="sm" className="w-[160px]" aria-label="Budget month" value={d.budget.month} onValueChange={(v) => update({ bm: v })} options={d.budget.months.map((m) => ({ value: m, label: format(parseISO(m), "MMMM yyyy") }))} />}
      table={{ headers: ["Category", "Budget", "Actual", "Difference"], rows: d.budget.items.map((i) => [i.name, f.money(i.budget), f.money(i.actual), f.money(i.budget - i.actual)]) }}
      footer={
        <div className="mt-3 flex justify-end">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/budgets?month=${d.budget.month}`}>
              Edit this budget <ArrowRight />
            </Link>
          </Button>
        </div>
      }
    >
      <BudgetVsActualChart data={d.budget.items} />
    </ChartCard>
  );
}
