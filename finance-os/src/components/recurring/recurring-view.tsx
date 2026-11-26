"use client";
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarCheck, CalendarClock, MoreHorizontal, Pencil, Plus, Repeat, SkipForward, Sparkles, Trash2, Check } from "lucide-react";
import type { RecurringCandidate, RecurringView as Item } from "@/server/services/recurring";
import { deleteRecurringAction, markPaidAction, saveRecurringAction, skipOccurrenceAction } from "@/server/actions/finance";
import { recurringSchema, type RecurringInput } from "@/lib/validation";
import { FREQUENCIES, FREQUENCY_LABELS } from "@/lib/finance/calculations";
import { CURRENCIES, toCents } from "@/lib/finance/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select, NONE } from "@/components/ui/select";
import { Badge, EmptyState, Switch, Checkbox } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/confirm";
import { CategoryIcon } from "@/components/common/category-icon";
import { AnimatedMoney, Money } from "@/components/common/money";
import { useFmt, usePrefs } from "@/components/common/prefs";
import { useQuickAdd } from "@/components/layout/quick-add";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

export function RecurringView({ items, totals, candidates }: { items: Item[]; totals: { monthly: number; annual: number; count: number; unconverted: number }; candidates: RecurringCandidate[] }) {
  const f = useFmt();
  const confirm = useConfirm();
  const [form, setForm] = React.useState<{ item: Item | null; defaults?: Partial<RecurringInput> } | null>(null);
  const [paying, setPaying] = React.useState<Item | null>(null);
  const upcoming = items.filter((i) => i.is_active && i.daysUntil <= 30);
  const next30 = upcoming.reduce((s, i) => s + (i.baseAmount ?? 0), 0);

  const when = (d: number) => (d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue` : d === 0 ? "Due today" : d === 1 ? "Tomorrow" : `In ${d} days`);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Monthly commitments", value: totals.monthly, sub: "All active payments, normalized to a month" },
          { label: "Annual commitments", value: totals.annual, sub: "Monthly × 12" },
          { label: "Due in the next 30 days", value: next30, sub: `${upcoming.length} payment${upcoming.length === 1 ? "" : "s"}` },
        ].map((c) => (
          <Card key={c.label} className="card-hover p-5">
            <p className="text-[13px] font-medium text-muted-foreground">{c.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              <AnimatedMoney cents={c.value} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>
          </Card>
        ))}
        <Card className="card-hover flex flex-col justify-between p-5">
          <div>
            <p className="text-[13px] font-medium text-muted-foreground">Active payments</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight num">{totals.count}</p>
            {totals.unconverted > 0 && <p className="mt-1 text-xs text-warning">{totals.unconverted} not in totals: missing exchange rate</p>}
          </div>
          <Button size="sm" className="mt-3 self-start" onClick={() => setForm({ item: null })}>
            <Plus /> Add recurring payment
          </Button>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Upcoming</CardTitle>
              <CardDescription>Next 30 days. Mark a payment as paid to record it and move to the next date.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <EmptyState icon={<CalendarClock />} title="Nothing due in the next 30 days" />
            ) : (
              <ul className="space-y-2">
                {upcoming.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 rounded-xl border p-3">
                    <div className={cn("flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-center", i.daysUntil < 0 ? "bg-negative-soft text-negative" : i.daysUntil <= 3 ? "bg-warning-soft text-warning" : "bg-muted")}>
                      <span className="text-[10px] font-medium uppercase leading-none">{f.shortDate(i.next_date).split(" ")[1]}</span>
                      <span className="text-base font-semibold leading-tight">{f.shortDate(i.next_date).split(" ")[0]}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{i.name}</p>
                      <p className={cn("text-xs", i.daysUntil < 0 ? "text-negative" : "text-muted-foreground")}>
                        {when(i.daysUntil)} · {i.account_name ?? "No account"}
                      </p>
                    </div>
                    <Money cents={toCents(i.amount)} currency={i.currency} className="text-sm font-semibold" />
                    <Button size="sm" variant="outline" onClick={() => setPaying(i)}>
                      <Check /> Paid
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader className="border-b pb-4">
            <div>
              <CardTitle>All recurring payments</CardTitle>
              <CardDescription>Rent, utilities, insurance, subscriptions, loan payments and memberships.</CardDescription>
            </div>
          </CardHeader>
          {items.length === 0 ? (
            <EmptyState icon={<Repeat />} title={COPY.empty.recurring.title} body={COPY.empty.recurring.body} action={<Button size="sm" onClick={() => setForm({ item: null })}><Plus /> Add recurring payment</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-5 py-2.5 font-medium">Payment</th>
                    <th className="px-3 py-2.5 font-medium">Frequency</th>
                    <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-3 py-2.5 text-right font-medium">Per month</th>
                    <th className="px-3 py-2.5 font-medium">Next</th>
                    <th className="px-3 py-2.5 font-medium">Active</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((i) => (
                    <tr key={i.id} className={cn(!i.is_active && "opacity-60")}>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <CategoryIcon icon={i.category_icon ?? "repeat"} color={i.category_color} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{i.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{[i.category_name, i.account_name].filter(Boolean).join(" · ") || "No category"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{i.frequency === "custom" ? `Every ${i.interval_days} days` : FREQUENCY_LABELS[i.frequency]}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Money cents={toCents(i.amount)} currency={i.currency} />
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground num">{i.monthly === null ? "No rate" : f.money(i.monthly)}</td>
                      <td className="px-3 py-2.5 num">{f.date(i.next_date)}</td>
                      <td className="px-3 py-2.5">
                        <Switch
                          checked={i.is_active}
                          aria-label={`${i.name} active`}
                          onCheckedChange={async (c) => {
                            const r = await saveRecurringAction(i.id, { name: i.name, merchant: i.merchant, amount: i.amount, currency: i.currency, frequency: i.frequency, intervalDays: i.interval_days, categoryId: i.category_id, accountId: i.account_id, nextDate: i.next_date, isActive: c, notes: i.notes });
                            if (!r.ok) toast.error(r.error);
                            else toast.success(c ? "Payment resumed" : "Payment paused");
                          }}
                        />
                      </td>
                      <td className="pr-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${i.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onSelect={() => setPaying(i)}>
                              <CalendarCheck /> Mark as paid
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={async () => {
                                const r = await skipOccurrenceAction(i.id);
                                if (r.ok) toast.success(`Skipped. Next payment ${f.date(r.data)}`);
                                else toast.error(r.error);
                              }}
                            >
                              <SkipForward /> Skip this occurrence
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setForm({ item: i })}>
                              <Pencil /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              destructive
                              onSelect={async () => {
                                if (!(await confirm({ title: `Delete “${i.name}”?`, description: "Past transactions stay recorded. This can't be undone.", confirmLabel: "Delete recurring payment", destructive: true }))) return;
                                const r = await deleteRecurringAction(i.id);
                                if (r.ok) toast.success("Recurring payment deleted");
                                else toast.error(r.error);
                              }}
                            >
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {candidates.length > 0 && (
        <Card id="suggestions">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand" /> Possible recurring payments
              </CardTitle>
              <CardDescription>Found in your transactions: regular intervals with similar amounts. Track them to see upcoming dates.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {candidates.map((c) => (
                <li key={c.merchant + c.currency} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c.merchant}</p>
                    <p className="text-xs text-muted-foreground">
                      {FREQUENCY_LABELS[c.frequency]} · {c.occurrences} payments · last {f.date(c.lastDate)}
                    </p>
                  </div>
                  <Money cents={toCents(c.averageAmount)} currency={c.currency} className="text-sm font-medium" />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setForm({ item: null, defaults: { name: c.merchant, merchant: c.merchant, amount: c.averageAmount, currency: c.currency as RecurringInput["currency"], frequency: c.frequency, nextDate: c.nextDate, accountId: c.accountId, categoryId: c.categoryId } })}
                  >
                    <Plus /> Track
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <RecurringForm open={!!form} onOpenChange={(o) => !o && setForm(null)} item={form?.item ?? null} defaults={form?.defaults} />
      <PaidDialog item={paying} onClose={() => setPaying(null)} />
    </div>
  );
}

function RecurringForm({ open, onOpenChange, item, defaults }: { open: boolean; onOpenChange: (o: boolean) => void; item: Item | null; defaults?: Partial<RecurringInput> }) {
  const quick = useQuickAdd();
  const prefs = usePrefs();
  const form = useForm<RecurringInput>({
    resolver: zodResolver(recurringSchema),
    values: item
      ? { name: item.name, merchant: item.merchant, amount: item.amount, currency: item.currency as RecurringInput["currency"], frequency: item.frequency, intervalDays: item.interval_days, categoryId: item.category_id, accountId: item.account_id, nextDate: item.next_date, isActive: item.is_active, notes: item.notes }
      : { name: "", merchant: "", amount: "", currency: prefs.baseCurrency as RecurringInput["currency"], frequency: "monthly", intervalDays: null, categoryId: null, accountId: quick.accounts.find((a) => !a.isArchived)?.id ?? null, nextDate: prefs.today, isActive: true, notes: "", ...defaults },
  });
  const e = form.formState.errors;
  const freq = form.watch("frequency");
  const submit = form.handleSubmit(async (v) => {
    const r = await saveRecurringAction(item?.id ?? null, v);
    if (!r.ok) return toast.error(r.error);
    toast.success("Recurring payment saved");
    onOpenChange(false);
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={item ? "Edit recurring payment" : "Add recurring payment"} description="Used for upcoming reminders and your monthly commitments. Paying it records an expense.">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <Field label="Name" error={e.name?.message} className="col-span-2">
            <Input autoFocus placeholder="e.g. Internet" {...form.register("name")} />
          </Field>
          <Field label="Amount" error={e.amount?.message}>
            <Input inputMode="decimal" className="num" {...form.register("amount")} />
          </Field>
          <Field label="Currency">
            <Controller control={form.control} name="currency" render={({ field }) => <Select aria-label="Currency" value={field.value} onValueChange={field.onChange} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />} />
          </Field>
          <Field label="Frequency">
            <Controller control={form.control} name="frequency" render={({ field }) => <Select aria-label="Frequency" value={field.value} onValueChange={field.onChange} options={FREQUENCIES.map((x) => ({ value: x, label: FREQUENCY_LABELS[x] }))} />} />
          </Field>
          {freq === "custom" ? (
            <Field label="Every (days)" error={e.intervalDays?.message}>
              <Input inputMode="numeric" {...form.register("intervalDays")} />
            </Field>
          ) : (
            <Field label="Next payment date" error={e.nextDate?.message}>
              <Input type="date" {...form.register("nextDate")} />
            </Field>
          )}
          {freq === "custom" && (
            <Field label="Next payment date" error={e.nextDate?.message} className="col-span-2">
              <Input type="date" {...form.register("nextDate")} />
            </Field>
          )}
          <Field label="Category">
            <Controller
              control={form.control}
              name="categoryId"
              render={({ field }) => <Select aria-label="Category" value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)} options={[{ value: NONE, label: "No category" }, ...quick.categories.filter((c) => c.kind === "expense" && !c.isArchived).map((c) => ({ value: c.id, label: c.name }))]} />}
            />
          </Field>
          <Field label="Paid from">
            <Controller
              control={form.control}
              name="accountId"
              render={({ field }) => <Select aria-label="Account" value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)} options={[{ value: NONE, label: "No account" }, ...quick.accounts.filter((a) => !a.isArchived).map((a) => ({ value: a.id, label: a.name }))]} />}
            />
          </Field>
          <Field label="Merchant (optional)" className="col-span-2" hint="Used when recording the payment and to match transactions.">
            <Input {...form.register("merchant")} />
          </Field>
          <Field label="Notes (optional)" className="col-span-2">
            <Textarea rows={2} {...form.register("notes")} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Controller control={form.control} name="isActive" render={({ field }) => <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />} /> Active
          </label>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {item ? "Save changes" : "Add recurring payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaidDialog({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const prefs = usePrefs();
  const f = useFmt();
  const [record, setRecord] = React.useState(true);
  const [date, setDate] = React.useState(prefs.today);
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (item) {
      setRecord(!!item.account_id);
      setDate(prefs.today);
      setAmount(item.amount);
    }
  }, [item, prefs.today]);
  if (!item) return null;
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Mark “${item.name}” as paid`} description={`Due ${f.date(item.next_date)}. The next payment date moves forward one ${item.frequency === "custom" ? `${item.interval_days}-day interval` : "period"}.`} size="sm">
        <div className="space-y-4">
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox className="mt-0.5" checked={record} disabled={!item.account_id} onCheckedChange={(c) => setRecord(c === true)} />
            <span>
              Record an expense transaction
              <span className="block text-xs text-muted-foreground">{item.account_id ? `From ${item.account_name}. Leave unticked if you already recorded it or imported it.` : "Add an account to this payment to record it automatically."}</span>
            </span>
          </label>
          {record && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paid on">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label={`Amount (${item.currency})`}>
                <Input inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const r = await markPaidAction(item.id, { recordTransaction: record, date, amount: record ? amount : null });
                setBusy(false);
                if (!r.ok) return toast.error(r.error);
                toast.success(`${item.name} marked as paid. Next payment ${f.date(r.data.next)}`);
                onClose();
              }}
            >
              Mark as paid
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
