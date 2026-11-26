"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { addMonths, format, parseISO, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, Copy, Plus, Sparkles, Trash2, Wallet, Repeat2, Info } from "lucide-react";
import type { BudgetMonth } from "@/server/services/budgets";
import { copyPreviousBudgetAction, fillBudgetFromAveragesAction, removeAllocationAction, upsertAllocationAction } from "@/server/actions/finance";
import { centsToDecimal, toCents } from "@/lib/finance/money";
import { normalizeAmountInput } from "@/lib/validation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge, EmptyState, Progress, Switch } from "@/components/ui/misc";
import { Tip } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/confirm";
import { ChartCard, Legend } from "@/components/charts/chart-card";
import { BudgetVsActualChart } from "@/components/charts/charts";
import { CategoryIcon } from "@/components/common/category-icon";
import { AnimatedMoney, Money } from "@/components/common/money";
import { useFmt } from "@/components/common/prefs";
import { useQuickAdd } from "@/components/layout/quick-add";
import { useUpdateParams } from "@/components/layout/period-filter";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, CartesianGrid } from "recharts";

export function BudgetsView({ budget, history, currentMonth, rolloverDefault }: { budget: BudgetMonth; history: { month: string; budgeted: number; spent: number; hasBudget: boolean }[]; currentMonth: string; rolloverDefault: boolean }) {
  const f = useFmt();
  const quick = useQuickAdd();
  const update = useUpdateParams();
  const confirm = useConfirm();
  const [adding, setAdding] = React.useState<{ categoryId: string; amount: string }>({ categoryId: "", amount: "" });
  const [busy, setBusy] = React.useState<string | null>(null);
  const m = parseISO(budget.month);
  const isCurrent = budget.month === currentMonth;
  const isFuture = budget.month > currentMonth;
  const budgetedIds = new Set(budget.items.map((i) => i.category.id));
  const available = quick.categories.filter((c) => c.kind === "expense" && !c.isArchived && !budgetedIds.has(c.id));
  const t = budget.totals;
  const monthEndIso = format(new Date(m.getFullYear(), m.getMonth() + 1, 0), "yyyy-MM-dd");

  const save = async (categoryId: string, amount: string, rollover: boolean) => {
    const r = await upsertAllocationAction({ month: budget.month, categoryId, amount, rollover });
    if (!r.ok) toast.error(r.error);
    return r.ok;
  };
  const run = async (key: string, p: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, msg: (d: unknown) => string) => {
    setBusy(key);
    const r = await p();
    setBusy(null);
    if (r.ok) toast.success(msg(r.data));
    else toast.error(r.error!);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-sm">
          <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => update({ month: format(subMonths(m, 1), "yyyy-MM-dd") })}>
            <ChevronLeft />
          </Button>
          <span className="min-w-[128px] text-center text-sm font-semibold">{format(m, "MMMM yyyy")}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => update({ month: format(addMonths(m, 1), "yyyy-MM-dd") })}>
            <ChevronRight />
          </Button>
        </div>
        {!isCurrent && (
          <Button variant="ghost" size="sm" onClick={() => update({ month: null })}>
            Back to this month
          </Button>
        )}
        {isFuture && <Badge tone="info">Planning ahead</Badge>}
        <div className="ml-auto flex gap-2">
          {budget.previousBudgetMonth && (
            <Button variant="outline" size="sm" loading={busy === "copy"} onClick={() => run("copy", () => copyPreviousBudgetAction(budget.month), (d) => `${(d as { copied: number }).copied} categories copied from ${format(parseISO((d as { from: string }).from), "MMMM")}`)}>
              <Copy /> Copy from {format(parseISO(budget.previousBudgetMonth), "MMMM")}
            </Button>
          )}
          <Button variant="outline" size="sm" loading={busy === "avg"} onClick={() => run("avg", () => fillBudgetFromAveragesAction(budget.month), (d) => `${d} categories filled from your 3-month average`)}>
            <Sparkles /> Fill from averages
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <p className="text-[13px] font-medium text-muted-foreground">{isCurrent ? "Left to spend this month" : `Left in ${format(m, "MMMM")}`}</p>
          <p className={cn("mt-2 text-3xl font-semibold tracking-tight", t.remaining < 0 && "text-negative")}>
            <AnimatedMoney cents={t.remaining} />
          </p>
          <Progress className="mt-4" height="h-2.5" value={t.percent} state={t.percent > 100 ? "over" : t.percent >= 80 ? "warning" : "ok"} />
          <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Budgeted</dt>
              <dd className="num font-medium">{f.money(t.budgeted, undefined, { fractionDigits: 0 })}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Rollover</dt>
              <dd className="num font-medium">{f.money(t.rollover, undefined, { fractionDigits: 0 })}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Spent</dt>
              <dd className="num font-medium">{f.money(t.spent, undefined, { fractionDigits: 0 })}</dd>
            </div>
          </dl>
          {t.unbudgetedSpent > 0 && (
            <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Plus <span className="num font-medium text-foreground">{f.money(t.unbudgetedSpent)}</span> spent in categories without a budget.
            </p>
          )}
        </Card>
        <ChartCard
          className="lg:col-span-2"
          title="Budget vs actual"
          description={`Planned and actual spending per category · ${format(m, "MMMM yyyy")}`}
          height={240}
          empty={budget.items.length === 0}
          table={{ headers: ["Category", "Budget", "Actual", "Remaining"], rows: budget.items.map((i) => [i.category.name, f.money(i.available), f.money(i.spent), f.money(i.remaining)]) }}
        >
          <BudgetVsActualChart data={budget.items.map((i) => ({ name: i.category.name, budget: i.available, actual: i.spent, state: i.state }))} />
        </ChartCard>
      </div>

      <Card>
        <CardHeader className="border-b pb-4">
          <div>
            <CardTitle>Categories</CardTitle>
            <CardDescription>Remaining = budget − spending + rollover. Amber from 80% used, red when over.</CardDescription>
          </div>
        </CardHeader>
        {budget.items.length === 0 ? (
          <EmptyState icon={<Wallet />} title={COPY.empty.budgets.title} body={`${COPY.empty.budgets.body} Copy last month's, fill from your averages, or add categories below.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-5 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 font-medium">Budget</th>
                  <th className="px-3 py-2.5 font-medium">
                    <Tip content="Carry unused budget into next month. Overspending is never carried forward.">
                      <span className="inline-flex items-center gap-1">
                        Rollover <Info className="h-3 w-3" />
                      </span>
                    </Tip>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">Spent</th>
                  <th className="w-[28%] px-3 py-2.5 font-medium">Progress</th>
                  <th className="px-3 py-2.5 text-right font-medium">Remaining</th>
                  <th className="w-10 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {budget.items.map((i) => (
                  <tr key={i.allocationId} className="group">
                    <td className="px-5 py-3">
                      <Link href={`/transactions?category=${i.category.id}&from=${budget.month}&to=${monthEndIso}`} className="flex items-center gap-2.5 font-medium hover:underline">
                        <CategoryIcon icon={i.category.icon} color={i.category.color} size="sm" />
                        {i.category.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <AmountCell initial={i.budgeted} onSave={(v) => save(i.category.id, v, i.rolloverEnabled)} label={`${i.category.name} budget`} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Switch checked={i.rolloverEnabled} aria-label={`Roll over unused ${i.category.name} budget`} onCheckedChange={(c) => save(i.category.id, centsToDecimal(i.budgeted), c)} />
                        {i.rollover > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-positive num">
                            <Repeat2 className="h-3 w-3" />+{f.money(i.rollover, undefined, { fractionDigits: 0 })}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right num">{f.money(i.spent)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Progress value={i.percent} state={i.state} />
                        <span className={cn("w-10 text-right text-xs num", i.state === "over" ? "text-negative" : i.state === "warning" ? "text-warning" : "text-muted-foreground")}>{Math.round(i.percent)}%</span>
                      </div>
                    </td>
                    <td className={cn("px-3 py-3 text-right font-medium num", i.remaining < 0 && "text-negative")}>{f.money(i.remaining).replace(/^-/, "−")}</td>
                    <td className="px-3 py-3">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                        aria-label={`Remove ${i.category.name} from budget`}
                        onClick={async () => {
                          const ok = await confirm({ title: `Remove ${i.category.name} from ${format(m, "MMMM")}'s budget?`, description: "Its spending stays recorded; it just won't have a budget this month.", confirmLabel: "Remove from budget", destructive: true });
                          if (!ok) return;
                          const r = await removeAllocationAction(i.allocationId);
                          if (r.ok) toast.success("Removed from budget");
                          else toast.error(r.error);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <CardContent className="border-t pt-4">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!adding.categoryId) return toast.error("Choose a category to budget for.");
              if (await save(adding.categoryId, adding.amount || "0", rolloverDefault)) {
                toast.success("Budget saved");
                setAdding({ categoryId: "", amount: "" });
              }
            }}
          >
            <Select size="sm" className="w-[220px]" aria-label="Category to budget" placeholder="Add a category…" value={adding.categoryId || undefined} onValueChange={(v) => setAdding((a) => ({ ...a, categoryId: v }))} options={available.map((c) => ({ value: c.id, label: c.name }))} />
            <Input className="h-8 w-[140px] num" inputMode="decimal" placeholder="Monthly amount" aria-label="Monthly amount" value={adding.amount} onChange={(e) => setAdding((a) => ({ ...a, amount: e.target.value }))} />
            <Button type="submit" size="sm" variant="outline">
              <Plus /> Add to budget
            </Button>
          </form>
        </CardContent>
      </Card>

      {budget.unbudgeted.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Spending without a budget</CardTitle>
              <CardDescription>Categories with spending in {format(m, "MMMM")} that you haven't budgeted for.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {budget.unbudgeted.map((u) => (
                <li key={u.category?.id ?? "none"} className="flex items-center gap-3 py-2.5">
                  <CategoryIcon icon={u.category?.icon ?? "circle-dashed"} color={u.category?.color} size="sm" />
                  <span className="flex-1 text-sm">{u.category?.name ?? "Uncategorized"}</span>
                  <Money cents={u.spent} className="text-sm font-medium" />
                  {u.category && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const rounded = Math.ceil(u.spent / 5000) * 5000;
                        if (await save(u.category!.id, centsToDecimal(rounded), rolloverDefault)) toast.success(`${u.category!.name} budget set to ${f.money(rounded)}`);
                      }}
                    >
                      <Plus /> Budget {f.money(Math.ceil(u.spent / 5000) * 5000, undefined, { fractionDigits: 0 })}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ChartCard
        title="Budget history"
        description="Total budgeted (incl. rollover) vs spent in budgeted categories, last 6 months."
        height={220}
        empty={!history.some((h) => h.hasBudget)}
        table={{ headers: ["Month", "Budgeted", "Spent", "Difference"], rows: history.map((h) => [format(parseISO(h.month), "MMM yyyy"), f.money(h.budgeted), f.money(h.spent), f.money(h.budgeted - h.spent)]) }}
      >
        <div className="flex h-full flex-col gap-2">
        <Legend items={[{ label: "Budgeted", color: "var(--chart-budget)" }, { label: "Spent", color: "hsl(var(--foreground) / 0.7)" }]} />
        <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={history.map((h) => ({ ...h, label: format(parseISO(h.month), "MMM yy") }))} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
            <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
              <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-card-hover">
                <p className="mb-1 font-medium">{label}</p>
                <p>Budgeted: <span className="num">{f.money(Number(payload[0].value))}</span></p>
                <p>Spent: <span className="num">{f.money(Number(payload[1]?.value ?? 0))}</span></p>
              </div>
            ) : null} />
            <Bar dataKey="budgeted" name="Budgeted" fill="var(--chart-budget)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="spent" name="Spent" fill="hsl(var(--foreground) / 0.7)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
        </div>
        </div>
      </ChartCard>
    </div>
  );
}

function AmountCell({ initial, onSave, label }: { initial: number; onSave: (v: string) => Promise<boolean>; label: string }) {
  const [value, setValue] = React.useState(centsToDecimal(initial));
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setValue(centsToDecimal(initial)), [initial]);
  const commit = async () => {
    let cents: number;
    try {
      cents = toCents(normalizeAmountInput(value));
    } catch {
      toast.error("Enter a valid amount, e.g. 1500 or 1500.50");
      return setValue(centsToDecimal(initial));
    }
    if (cents === initial) return;
    setSaving(true);
    const ok = await onSave(centsToDecimal(cents));
    setSaving(false);
    if (ok) toast.success("Budget saved");
    else setValue(centsToDecimal(initial));
  };
  return (
    <Input
      aria-label={label}
      className={cn("h-8 w-[120px] num", saving && "opacity-60")}
      inputMode="decimal"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}
