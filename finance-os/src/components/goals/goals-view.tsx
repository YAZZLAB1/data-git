"use client";
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Archive, Bike, Car, CheckCircle2, ChevronDown, Home, MoreHorizontal, Palmtree, Pencil, PiggyBank, Plus, ShieldCheck, Target, Trash2, Undo2, Wallet, Minus, Info } from "lucide-react";
import type { GoalView } from "@/server/services/goals";
import { addContributionAction, deleteGoalAction, removeContributionAction, saveGoalAction, setGoalStatusAction } from "@/server/actions/finance";
import { goalSchema, type GoalInput } from "@/lib/validation";
import { GOAL_KINDS } from "@/lib/constants";
import { CURRENCIES, toCents, centsToDecimal } from "@/lib/finance/money";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select, NONE } from "@/components/ui/select";
import { Badge, EmptyState, Progress, Switch } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/confirm";
import { useFmt, usePrefs } from "@/components/common/prefs";
import { useQuickAdd } from "@/components/layout/quick-add";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<string, React.ElementType> = { emergency: ShieldCheck, vacation: Palmtree, motorcycle: Bike, car: Car, house: Home, debt: Wallet, general: PiggyBank };

export function GoalsView({ goals }: { goals: GoalView[] }) {
  const [form, setForm] = React.useState<{ goal: GoalView | null } | null>(null);
  const [contrib, setContrib] = React.useState<GoalView | null>(null);
  const active = goals.filter((g) => g.status === "active");
  const done = goals.filter((g) => g.status !== "active");
  const [showDone, setShowDone] = React.useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Progress = saved ÷ target. Monthly contribution = what's left ÷ months remaining. {COPY.goalContributionNote}
        </p>
        <Button size="sm" onClick={() => setForm({ goal: null })}>
          <Plus /> New goal
        </Button>
      </div>
      {goals.length === 0 ? (
        <Card>
          <EmptyState icon={<Target />} title={COPY.empty.goals.title} body={COPY.empty.goals.body} action={<Button size="sm" onClick={() => setForm({ goal: null })}><Plus /> New goal</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {active.map((g) => (
            <GoalCard key={g.id} g={g} onEdit={() => setForm({ goal: g })} onContribute={() => setContrib(g)} />
          ))}
        </div>
      )}
      {done.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowDone((s) => !s)}>
            <ChevronDown className={cn("transition-transform", showDone && "rotate-180")} /> {showDone ? "Hide" : "Show"} {done.length} completed or archived
          </Button>
          {showDone && (
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {done.map((g) => (
                <GoalCard key={g.id} g={g} onEdit={() => setForm({ goal: g })} onContribute={() => setContrib(g)} />
              ))}
            </div>
          )}
        </div>
      )}
      <GoalForm open={!!form} goal={form?.goal ?? null} onOpenChange={(o) => !o && setForm(null)} />
      <ContributionDialog goal={contrib} onClose={() => setContrib(null)} />
    </div>
  );
}

function GoalCard({ g, onEdit, onContribute }: { g: GoalView; onEdit: () => void; onContribute: () => void }) {
  const f = useFmt();
  const confirm = useConfirm();
  const [open, setOpen] = React.useState(false);
  const Icon = KIND_ICON[g.kind] ?? PiggyBank;
  const m = (c: number) => f.money(c, g.currency, { fractionDigits: 0 });
  const reached = g.saved >= g.target;
  const status = async (s: "active" | "completed" | "archived") => {
    const r = await setGoalStatusAction(g.id, s);
    if (r.ok) toast.success(s === "completed" ? "Goal marked complete" : s === "archived" ? "Goal archived" : "Goal reopened");
    else toast.error(r.error);
  };
  return (
    <Card className={cn("card-hover flex flex-col p-5", g.status !== "active" && "opacity-75")}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-semibold">
            {g.name}
            {g.is_emergency_fund && <Badge tone="brand">Emergency fund</Badge>}
          </p>
          <p className="text-xs text-muted-foreground">
            {g.target_date ? `Target ${f.date(g.target_date)}` : "No target date"}
            {g.linked_account_name ? ` · ${g.linked_account_name}` : ""}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${g.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit goal
            </DropdownMenuItem>
            {g.status === "active" ? (
              <>
                <DropdownMenuItem onSelect={() => status("completed")}>
                  <CheckCircle2 /> Mark complete
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => status("archived")}>
                  <Archive /> Archive
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={() => status("active")}>
                <Undo2 /> Reopen
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={async () => {
                if (!(await confirm({ title: `Delete “${g.name}”?`, description: "Its contribution history is removed. Transfers you recorded stay in your transactions. This can't be undone.", confirmLabel: "Delete goal", destructive: true }))) return;
                const r = await deleteGoalAction(g.id);
                if (r.ok) toast.success("Goal deleted");
                else toast.error(r.error);
              }}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-5 flex items-baseline justify-between">
        <span className="text-2xl font-semibold tracking-tight num">{m(g.saved)}</span>
        <span className="text-sm text-muted-foreground num">of {m(g.target)}</span>
      </div>
      <Progress className="mt-2" height="h-2.5" value={g.progress} state="brand" />
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span className="num">{f.pct(Math.min(g.progress, 999))} complete</span>
        <span className="num">{reached ? "Target reached" : `${m(g.remaining)} to go`}</span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-muted/50 p-3 text-xs">
        <div>
          <dt className="text-muted-foreground">Needed per month</dt>
          <dd className="mt-0.5 text-sm font-semibold num">{reached ? "—" : g.requiredMonthly === null ? "Set a date" : m(g.requiredMonthly)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Your 3-month average</dt>
          <dd className="mt-0.5 text-sm font-semibold num">{m(g.averageMonthly)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="flex items-center gap-1 text-muted-foreground">
            Estimated completion
            <span title="Projection based on your average monthly contribution over the last 3 months.">
              <Info className="h-3 w-3" />
            </span>
          </dt>
          <dd className="mt-0.5 flex items-center gap-2 text-sm font-semibold">
            {reached ? "Done" : g.estimatedCompletion ? f.date(g.estimatedCompletion) : "Not enough recent contributions"}
            {!reached && g.onTrack !== null && <Badge tone={g.onTrack ? "positive" : "warning"}>{g.onTrack ? "On track" : "Behind schedule"}</Badge>}
          </dd>
        </div>
      </dl>
      {g.description && <p className="mt-3 text-xs text-muted-foreground">{g.description}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" className="flex-1" onClick={onContribute} disabled={g.status !== "active"}>
          <Plus /> Add contribution
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          History <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      {open && (
        <ul className="mt-3 max-h-56 divide-y overflow-y-auto rounded-lg border text-[13px] animate-fade-up">
          {g.contributions.length === 0 && <li className="px-3 py-3 text-center text-muted-foreground">No contributions yet.</li>}
          {g.contributions.map((c) => (
            <li key={c.id} className="group flex items-center gap-2 px-3 py-2">
              <span className="text-muted-foreground num">{f.date(c.date)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {c.note}
                {c.transaction_id && <Badge tone="info" className="ml-1">Transfer</Badge>}
              </span>
              <span className={cn("num font-medium", toCents(c.amount) < 0 && "text-negative")}>{f.money(toCents(c.amount), g.currency, { signDisplay: "exceptZero" }).replace(/^-/, "−")}</span>
              <button
                className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-negative group-hover:opacity-100 focus:opacity-100"
                aria-label="Remove contribution"
                onClick={async () => {
                  if (!(await confirm({ title: "Remove this contribution?", description: c.transaction_id ? "The transfer recorded with it will be deleted too, restoring both account balances." : "The goal's progress will be recalculated.", confirmLabel: "Remove contribution", destructive: true }))) return;
                  const r = await removeContributionAction(c.id);
                  if (r.ok) toast.success("Contribution removed");
                  else toast.error(r.error);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GoalForm({ open, goal, onOpenChange }: { open: boolean; goal: GoalView | null; onOpenChange: (o: boolean) => void }) {
  const quick = useQuickAdd();
  const prefs = usePrefs();
  const form = useForm<GoalInput>({
    resolver: zodResolver(goalSchema),
    values: goal
      ? { name: goal.name, kind: goal.kind as GoalInput["kind"], targetAmount: goal.target_amount, currency: goal.currency as GoalInput["currency"], targetDate: goal.target_date, linkedAccountId: goal.linked_account_id, description: goal.description, isEmergencyFund: goal.is_emergency_fund }
      : { name: "", kind: "general", targetAmount: "", currency: prefs.baseCurrency as GoalInput["currency"], targetDate: null, linkedAccountId: null, description: "", isEmergencyFund: false },
  });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    const r = await saveGoalAction(goal?.id ?? null, v);
    if (!r.ok) return toast.error(r.error);
    toast.success(goal ? "Goal saved" : "Goal created");
    onOpenChange(false);
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={goal ? "Edit goal" : "New savings goal"} description="Set a target and a date to see how much to put aside each month.">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <Field label="Goal name" error={e.name?.message} className="col-span-2">
            <Input autoFocus placeholder="e.g. New motorcycle" {...form.register("name")} />
          </Field>
          <Field label="Type">
            <Controller control={form.control} name="kind" render={({ field }) => <Select aria-label="Goal type" value={field.value ?? "general"} onValueChange={(v) => { field.onChange(v); if (v === "emergency") form.setValue("isEmergencyFund", true); }} options={Object.entries(GOAL_KINDS).map(([k, l]) => ({ value: k, label: l }))} />} />
          </Field>
          <Field label="Target date (optional)" error={e.targetDate?.message}>
            <Input type="date" {...form.register("targetDate")} />
          </Field>
          <Field label="Target amount" error={e.targetAmount?.message}>
            <Input inputMode="decimal" className="num" {...form.register("targetAmount")} />
          </Field>
          <Field label="Currency">
            <Controller control={form.control} name="currency" render={({ field }) => <Select aria-label="Currency" value={field.value} onValueChange={field.onChange} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />} />
          </Field>
          <Field label="Linked account (optional)" className="col-span-2" hint="Where the money is kept. Lets contributions move money there with a transfer.">
            <Controller
              control={form.control}
              name="linkedAccountId"
              render={({ field }) => <Select aria-label="Linked account" value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)} options={[{ value: NONE, label: "No linked account" }, ...quick.accounts.filter((a) => a.cls === "asset" && !a.isArchived).map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))]} />}
            />
          </Field>
          <Field label="Description (optional)" className="col-span-2">
            <Textarea rows={2} {...form.register("description")} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Controller control={form.control} name="isEmergencyFund" render={({ field }) => <Switch checked={!!field.value} onCheckedChange={field.onChange} />} />
            This is my emergency fund <span className="text-xs text-muted-foreground">(shown in Financial health)</span>
          </label>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {goal ? "Save changes" : "Create goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContributionDialog({ goal, onClose }: { goal: GoalView | null; onClose: () => void }) {
  const prefs = usePrefs();
  const quick = useQuickAdd();
  const f = useFmt();
  const [mode, setMode] = React.useState<"add" | "withdraw">("add");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(prefs.today);
  const [note, setNote] = React.useState("");
  const [from, setFrom] = React.useState<string>(NONE);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (goal) {
      setMode("add");
      setAmount(goal.requiredMonthly ? centsToDecimal(goal.requiredMonthly) : "");
      setDate(prefs.today);
      setNote("");
      setFrom(NONE);
    }
  }, [goal, prefs.today]);
  if (!goal) return null;
  const sources = quick.accounts.filter((a) => !a.isArchived && a.id !== goal.linked_account_id && a.currency === goal.currency);
  return (
    <Dialog open={!!goal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${mode === "add" ? "Add to" : "Withdraw from"} ${goal.name}`} description={COPY.goalContributionNote} size="sm">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(["add", "withdraw"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={cn("flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[13px] font-medium", mode === m ? "bg-card shadow-sm" : "text-muted-foreground")}>
                {m === "add" ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />} {m === "add" ? "Contribute" : "Withdraw"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Amount (${goal.currency})`} hint={goal.requiredMonthly && mode === "add" ? `Suggested: ${f.money(goal.requiredMonthly, goal.currency)}` : undefined}>
              <Input autoFocus inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          {goal.linked_account_id ? (
            <Field label={mode === "add" ? "Move money from (optional)" : "Move money back to (optional)"} hint={`Records a transfer ${mode === "add" ? "into" : "out of"} ${goal.linked_account_name}. Not an expense.`}>
              <Select aria-label="Source account" value={from} onValueChange={setFrom} options={[{ value: NONE, label: "Don't move money — just track it" }, ...sources.map((a) => ({ value: a.id, label: a.name }))]} />
            </Field>
          ) : (
            <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Link an account to this goal to move money with a transfer when you contribute.
            </p>
          )}
          <Field label="Note (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const signed = mode === "withdraw" ? `-${amount.replace(/^-/, "")}` : amount;
                const r = await addContributionAction({ goalId: goal.id, amount: signed, date, note, fromAccountId: from === NONE ? null : from });
                setBusy(false);
                if (!r.ok) return toast.error(r.error);
                toast.success(mode === "add" ? "Contribution added" : "Withdrawal recorded");
                onClose();
              }}
            >
              {mode === "add" ? "Add contribution" : "Record withdrawal"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
