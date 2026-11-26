"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, CalendarClock, Landmark, Plus, Sparkles, TrendingDown, TrendingUp, Upload, Wallet, PiggyBank, AlertTriangle, Scale } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, Tooltip } from "recharts";
import type { OverviewData } from "@/server/queries/overview";
import type { TransactionView } from "@/server/services/transactions";
import { categoryTransactionsAction, getTransactionAction } from "@/server/actions/transactions";
import { loadDemoDataAction } from "@/server/actions/data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Progress } from "@/components/ui/misc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/menu";
import { ChartCard } from "@/components/charts/chart-card";
import { CashFlowChart, DonutChart, HBarChart, type Slice } from "@/components/charts/charts";
import { RangeSelect } from "@/components/common/range-select";
import { AnimatedMoney, Delta, Money } from "@/components/common/money";
import { useFmt } from "@/components/common/prefs";
import { CategoryIcon } from "@/components/common/category-icon";
import { CompactTxRow } from "@/components/transactions/tx-row";
import { useQuickAdd } from "@/components/layout/quick-add";
import { FREQUENCY_LABELS } from "@/lib/finance/calculations";
import { missingRateMessage } from "@/lib/copy";
import { toCents } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

export function OverviewView({ d }: { d: OverviewData }) {
  const f = useFmt();
  const quick = useQuickAdd();
  const [drill, setDrill] = React.useState<{ slice: Slice; rows: TransactionView[] | null } | null>(null);

  if (d.empty.accounts) return <Welcome />;

  const openTx = async (id: string) => {
    const r = await getTransactionAction(id);
    if (r.ok) quick.open({ editing: r.data });
    else toast.error(r.error);
  };
  const openSlice = async (slice: Slice) => {
    if (slice.id === "__other__") return;
    setDrill({ slice, rows: null });
    const r = await categoryTransactionsAction(slice.id, d.period.from, d.period.to);
    if (r.ok) setDrill({ slice, rows: r.data });
    else toast.error(r.error);
  };

  const periodSuffix = d.period.preset === "this_month" ? "vs same days last month" : "vs previous period";

  return (
    <div className="space-y-6">
      {d.missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {d.missing.map((m) => (
              <p key={m.currency}>{missingRateMessage(m.count, m.currency, f.baseCurrency)}</p>
            ))}
          </div>
          <Link href="/settings?tab=currencies" className="ml-auto shrink-0 font-medium underline-offset-4 hover:underline">
            Add rate
          </Link>
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Summary">
        <Metric
          icon={<Scale />}
          label="Net worth"
          help={`Assets ${f.money(d.netWorth.assets)} − liabilities ${f.money(d.netWorth.liabilities)}. Compared with ${f.date(d.netWorth.previousDate)}.`}
          value={<AnimatedMoney cents={d.netWorth.value} />}
          delta={<Delta value={d.netWorth.change} suffix={`vs ${f.shortDate(d.netWorth.previousDate)}`} />}
        />
        <Metric icon={<TrendingUp />} label={`Income · ${d.period.label}`} value={<AnimatedMoney cents={d.summary.income} />} delta={<Delta value={d.changes.income} suffix={periodSuffix} />} />
        <Metric icon={<TrendingDown />} label={`Expenses · ${d.period.label}`} value={<AnimatedMoney cents={d.summary.expenses} />} delta={<Delta value={d.changes.expenses} inverse suffix={periodSuffix} />} />
        <Metric
          icon={<PiggyBank />}
          label="Net savings"
          help="Income minus expenses. Transfers between your own accounts are excluded."
          value={<AnimatedMoney cents={d.summary.net} className={d.summary.net < 0 ? "text-negative" : undefined} />}
          delta={
            <span className="text-xs text-muted-foreground">
              Savings rate <span className="num font-medium text-foreground">{f.pct(d.summary.savingsRate)}</span>
              {d.previous.savingsRate !== null && <> · was {f.pct(d.previous.savingsRate)}</>}
            </span>
          }
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Cash flow"
          description="Income, expenses and net cash flow over time."
          height={300}
          empty={d.cashFlow.every((p) => p.income === 0 && p.expenses === 0)}
          actions={<RangeSelect param="cf" value={d.range.key} from={d.range.from} to={d.range.to} />}
          table={{ headers: ["Period", "Income", "Expenses", "Net"], rows: d.cashFlow.map((p) => [p.label, f.money(p.income), f.money(p.expenses), f.money(p.net)]) }}
        >
          <CashFlowChart data={d.cashFlow} />
        </ChartCard>
        <HealthCard d={d} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-3"
          title="Where your money went"
          description={`Spending by category · ${d.period.label}. Select a category to see its transactions.`}
          height={260}
          empty={d.spend.length === 0}
          table={{ headers: ["Category", "Amount", "Share"], rows: d.spend.map((s) => [s.name, f.money(s.value), f.pct((s.value / d.summary.expenses) * 100)]) }}
        >
          <DonutChart data={d.spend} centerLabel="Total spent" onSelect={openSlice} />
        </ChartCard>
        <ChartCard className="xl:col-span-2" title="Top categories" description={`Highest spending · ${d.period.label}`} height="auto" empty={d.spend.length === 0}>
          <HBarChart data={d.spend.slice(0, 6).map((s) => ({ id: s.id, name: s.name, value: s.value, color: s.color }))} onSelect={(id) => {
            const s = d.spend.find((x) => x.id === id);
            if (s) openSlice(s);
          }} />
        </ChartCard>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <BudgetCard d={d} />
        <Card className="card-hover">
          <CardHeader>
            <div>
              <CardTitle>Recent transactions</CardTitle>
              <CardDescription>Latest activity across all accounts.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/transactions">
                View all <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-3">
            {d.recent.length === 0 ? (
              <EmptyState title="No transactions yet" body="Add your first transaction to see it here." action={<Button size="sm" onClick={() => quick.open()}><Plus /> Add transaction</Button>} />
            ) : (
              <div className="space-y-0.5">
                {d.recent.map((t) => (
                  <CompactTxRow key={t.id} t={t} onClick={() => openTx(t.id)} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="card-hover">
          <CardHeader>
            <div>
              <CardTitle>Upcoming payments</CardTitle>
              <CardDescription>Recurring payments due in the next 31 days.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/recurring">
                Manage <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {d.upcoming.length === 0 ? (
              <EmptyState icon={<CalendarClock />} title="Nothing due soon" body="Add recurring payments like rent and subscriptions to see them here." action={<Button asChild size="sm" variant="outline"><Link href="/recurring">Add recurring payment</Link></Button>} />
            ) : (
              <ul className="divide-y">
                {d.upcoming.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <CategoryIcon icon={r.category_icon ?? "repeat"} color={r.category_color} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {FREQUENCY_LABELS[r.frequency]} · {f.shortDate(r.next_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Money cents={toCents(r.amount)} currency={r.currency} className="text-[13.5px] font-medium" />
                      <p className={cn("text-xs", r.daysUntil < 0 ? "text-negative" : r.daysUntil <= 3 ? "text-warning" : "text-muted-foreground")}>
                        {r.daysUntil < 0 ? `${-r.daysUntil}d overdue` : r.daysUntil === 0 ? "Today" : `in ${r.daysUntil}d`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        {drill && (
          <DialogContent title={drill.slice.name} description={`${f.money(drill.slice.value)} spent · ${d.period.label}`} size="md">
            {drill.rows === null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading transactions…</p>
            ) : drill.rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No transactions in this category for the period.</p>
            ) : (
              <div className="-mx-2 space-y-0.5">
                {drill.rows.map((t) => (
                  <CompactTxRow key={t.id} t={t} onClick={() => { setDrill(null); openTx(t.id); }} />
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button asChild variant="outline" size="sm">
                <Link href={`/transactions?category=${drill.slice.id ?? "uncategorized"}&from=${d.period.from}&to=${d.period.to}`}>
                  Open in Transactions <ArrowRight />
                </Link>
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function Metric({ icon, label, value, delta, help }: { icon: React.ReactNode; label: string; value: React.ReactNode; delta: React.ReactNode; help?: string }) {
  const content = (
    <Card className="card-hover p-5">
      <div className="flex items-center justify-between">
        <span className="truncate text-[13px] font-medium text-muted-foreground">{label}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      </div>
      <div className="mt-3 whitespace-nowrap text-[22px] font-semibold leading-none tracking-tight 2xl:text-[26px]">{value}</div>
      <div className="mt-3">{delta}</div>
    </Card>
  );
  return help ? <Tip content={help}>{<div>{content}</div>}</Tip> : content;
}

function HealthCard({ d }: { d: OverviewData }) {
  const f = useFmt();
  const h = d.health;
  const emergencyPct = h.emergency && h.emergency.target > 0 ? (h.emergency.current / h.emergency.target) * 100 : null;
  return (
    <Card className="card-hover">
      <CardHeader>
        <div>
          <CardTitle>Financial health</CardTitle>
          <CardDescription>A snapshot from your recorded data.</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/insights">
            <Sparkles /> Insights
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <Row label="Savings rate" sub={d.period.label} value={<span className={cn("num", (h.savingsRate ?? 0) < 0 && "text-negative")}>{f.pct(h.savingsRate)}</span>} />
        <Row label="Total debt" sub="Credit cards, loans & mortgages" value={<Money cents={h.totalDebt} />} />
        <div>
          <Row
            label="Monthly spending trend"
            sub="Last complete month vs prior 3-month average"
            value={h.trendChange === null ? <span className="text-muted-foreground">—</span> : <span className={cn("num", h.trendChange > 0 ? "text-negative" : "text-positive")}>{h.trendChange > 0 ? "↑" : "↓"} {f.pct(Math.abs(h.trendChange))}</span>}
          />
          <div className="mt-2 h-10">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={h.trend}>
                <Tooltip cursor={false} content={({ active, payload }) => (active && payload?.[0] ? <div className="rounded-md border bg-popover px-2 py-1 text-xs shadow">{payload[0].payload.label}: {f.money(Number(payload[0].value))}</div> : null)} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} fill="hsl(var(--foreground) / 0.18)" activeBar={{ fill: "var(--chart-expense)" }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <Row label="Budget utilization" sub="This month" value={h.budgetUtilization === null ? <Link className="text-xs text-brand hover:underline" href="/budgets">Set a budget</Link> : <span className="num">{f.pct(h.budgetUtilization)}</span>} />
          {h.budgetUtilization !== null && <Progress className="mt-2" value={h.budgetUtilization} state={h.budgetUtilization > 100 ? "over" : h.budgetUtilization >= 80 ? "warning" : "ok"} />}
        </div>
        <div>
          <Row
            label="Emergency savings"
            sub={h.emergency ? h.emergency.name : "Needs a month of expense history"}
            value={emergencyPct === null ? <span className="text-muted-foreground">—</span> : <span className="num">{f.pct(emergencyPct)}</span>}
          />
          {h.emergency && emergencyPct !== null && (
            <>
              <Progress className="mt-2" value={emergencyPct} state="brand" />
              <p className="mt-1 text-xs text-muted-foreground num">
                {f.money(h.emergency.current, h.emergency.currency, { fractionDigits: 0 })} of {f.money(h.emergency.target, h.emergency.currency, { fractionDigits: 0 })}
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, sub, value }: { label: string; sub?: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      <div className="shrink-0 text-sm font-semibold">{value}</div>
    </div>
  );
}

function BudgetCard({ d }: { d: OverviewData }) {
  const f = useFmt();
  const b = d.budget;
  return (
    <Card className="card-hover">
      <CardHeader>
        <div>
          <CardTitle>Budgets this month</CardTitle>
          <CardDescription>
            {b.count ? (
              <span className="num">
                {f.money(b.totals.spent, undefined, { fractionDigits: 0 })} of {f.money(b.totals.available, undefined, { fractionDigits: 0 })} · {f.money(b.totals.remaining, undefined, { fractionDigits: 0 })} left
              </span>
            ) : (
              "Plan what you want to spend per category."
            )}
          </CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/budgets">
            Open <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {b.items.length === 0 ? (
          <EmptyState icon={<Wallet />} title="No budget for this month" body="Set monthly amounts per category to see what's left as you spend." action={<Button asChild size="sm" variant="outline"><Link href="/budgets">Create budget</Link></Button>} />
        ) : (
          <ul className="space-y-3.5">
            {b.items.map((i) => (
              <li key={i.allocationId}>
                <div className="mb-1.5 flex items-center justify-between gap-2 text-[13px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <CategoryIcon icon={i.category.icon} color={i.category.color} size="sm" />
                    <span className="truncate font-medium">{i.category.name}</span>
                    {i.state === "over" && <Badge tone="negative">Over</Badge>}
                    {i.state === "warning" && <Badge tone="warning">{Math.round(i.percent)}%</Badge>}
                  </span>
                  <span className="num shrink-0 text-muted-foreground">
                    <span className="font-medium text-foreground">{f.money(i.spent, undefined, { fractionDigits: 0 })}</span> / {f.money(i.available, undefined, { fractionDigits: 0 })}
                  </span>
                </div>
                <Progress value={i.percent} state={i.state} />
                <p className={cn("mt-1 text-xs", i.remaining < 0 ? "text-negative" : "text-muted-foreground")}>
                  {i.remaining < 0 ? `${f.money(-i.remaining)} over` : `${f.money(i.remaining)} remaining`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Welcome() {
  const quick = useQuickAdd();
  const [loading, setLoading] = React.useState(false);
  return (
    <div className="mx-auto max-w-3xl py-8">
      <div className="text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <Sparkles className="h-6 w-6" />
        </span>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">Let's set up your finances</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Start with your accounts. Every transaction you add then flows into balances, budgets, charts and insights automatically.</p>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          { icon: <Landmark />, title: "Add an account", body: "Cash, checking, savings, cards or loans.", action: <Button asChild size="sm"><Link href="/accounts?new=1">Add account</Link></Button> },
          { icon: <Upload />, title: "Import a statement", body: "Bring in transactions from a bank CSV.", action: <Button asChild size="sm" variant="outline"><Link href="/transactions/import">Import CSV</Link></Button> },
          { icon: <Plus />, title: "Record a transaction", body: "Takes a few seconds. Press N anywhere.", action: <Button size="sm" variant="outline" onClick={() => quick.open()}>Add transaction</Button> },
        ].map((c) => (
          <Card key={c.title} className="card-hover flex flex-col p-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{c.icon}</span>
            <p className="mt-3 text-sm font-semibold">{c.title}</p>
            <p className="mt-1 flex-1 text-[13px] text-muted-foreground">{c.body}</p>
            <div className="mt-4">{c.action}</div>
          </Card>
        ))}
      </div>
      <div className="mt-6 rounded-xl border border-dashed p-5 text-center">
        <p className="text-sm font-medium">Just exploring?</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Load a year of clearly-labelled sample data. You can remove it any time in Settings → Data.</p>
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          loading={loading}
          onClick={async () => {
            setLoading(true);
            const r = await loadDemoDataAction();
            setLoading(false);
            if (r.ok) toast.success("Sample data loaded");
            else toast.error(r.error);
          }}
        >
          Load sample data
        </Button>
      </div>
    </div>
  );
}
