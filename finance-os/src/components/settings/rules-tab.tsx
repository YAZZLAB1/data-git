"use client";
import * as React from "react";
import { toast } from "sonner";
import { Pencil, Play, Plus, Trash2, Wand2, X } from "lucide-react";
import type { Category } from "@/server/services/categories";
import type { Rule, RuleAction, RuleCondition } from "@/lib/finance/rules";
import { applyRuleAction, deleteRuleAction, previewRuleAction, saveRuleAction } from "@/server/actions/finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge, EmptyState, Switch } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm";
import { useQuickAdd } from "@/components/layout/quick-add";
import { Section } from "./settings-view";

const FIELD_LABELS = { merchant: "Merchant", description: "Description", account: "Account", amount: "Amount", type: "Type" } as const;
const OP_LABELS = { contains: "contains", equals: "equals", starts_with: "starts with", gt: "is greater than", lt: "is less than", between: "is between" } as const;
const OPS_FOR = { merchant: ["contains", "equals", "starts_with"], description: ["contains", "equals", "starts_with"], account: ["equals"], amount: ["equals", "gt", "lt", "between"], type: ["equals"] } as const;
const ACTION_LABELS = { set_category: "Set category", add_tag: "Add tag", rename_merchant: "Rename merchant", mark_reviewed: "Mark as reviewed" } as const;

type R = Rule & { times_applied: number };

export function RulesTab({ rules, categories }: { rules: R[]; categories: Category[] }) {
  const quick = useQuickAdd();
  const confirm = useConfirm();
  const [edit, setEdit] = React.useState<{ rule: R | null } | null>(null);
  const describe = (r: R) => {
    const cond = r.conditions
      .map((c) => {
        const v = c.field === "account" ? (quick.accounts.find((a) => a.id === c.value)?.name ?? "unknown account") : c.value;
        return `${FIELD_LABELS[c.field]} ${OP_LABELS[c.operator]} “${v}”${c.operator === "between" ? ` and “${c.value2}”` : ""}`;
      })
      .join(r.match_mode === "all" ? " and " : " or ");
    const act = r.actions
      .map((a) => (a.type === "set_category" ? `category → ${categories.find((c) => c.id === a.value)?.name ?? "deleted category"}` : a.type === "add_tag" ? `tag #${a.value}` : a.type === "rename_merchant" ? `rename to “${a.value}”` : "mark reviewed"))
      .join(", ");
    return { cond, act };
  };
  return (
    <Section title="Transaction rules" description="Rules categorize new and imported transactions automatically. A category you choose yourself is never overridden.">
      {rules.length === 0 ? (
        <EmptyState icon={<Wand2 />} title="No rules yet" body="Example: if merchant contains “Netflix”, set category to Subscriptions." />
      ) : (
        <ul className="space-y-2">
          {rules.map((r) => {
            const d = describe(r);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {r.name} {!r.is_active && <Badge tone="outline">Paused</Badge>}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">If</span> {d.cond} <span className="font-medium text-foreground/80">then</span> {d.act}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Priority {r.priority} · applied {r.times_applied} times</p>
                </div>
                <Switch
                  checked={r.is_active}
                  aria-label={`${r.name} active`}
                  onCheckedChange={async (c) => {
                    const res = await saveRuleAction(r.id, { name: r.name, matchMode: r.match_mode, conditions: r.conditions, actions: r.actions, priority: r.priority, isActive: c });
                    if (!res.ok) toast.error(res.error);
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const p = await previewRuleAction(r.id);
                    if (!p.ok) return toast.error(p.error);
                    if (p.data === 0) return toast.message("No existing transactions match this rule (manually categorized ones are skipped).");
                    if (!(await confirm({ title: `Apply “${r.name}” to ${p.data} transaction${p.data === 1 ? "" : "s"}?`, description: "Only transactions that weren't categorized by you are changed.", confirmLabel: "Apply rule" }))) return;
                    const res = await applyRuleAction(r.id);
                    if (res.ok) toast.success(`Rule applied to ${res.data} transactions`);
                    else toast.error(res.error);
                  }}
                >
                  <Play /> Apply to existing
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.name}`} onClick={() => setEdit({ rule: r })}>
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${r.name}`}
                  onClick={async () => {
                    if (!(await confirm({ title: `Delete rule “${r.name}”?`, description: "Transactions it already categorized keep their category.", confirmLabel: "Delete rule", destructive: true }))) return;
                    const res = await deleteRuleAction(r.id);
                    if (res.ok) toast.success("Rule deleted");
                    else toast.error(res.error);
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Button className="mt-4" size="sm" onClick={() => setEdit({ rule: null })}>
        <Plus /> New rule
      </Button>
      <RuleDialog state={edit} categories={categories} onClose={() => setEdit(null)} />
    </Section>
  );
}

function RuleDialog({ state, categories, onClose }: { state: { rule: R | null } | null; categories: Category[]; onClose: () => void }) {
  const quick = useQuickAdd();
  const blank = { name: "", matchMode: "all" as "all" | "any", conditions: [{ field: "merchant", operator: "contains", value: "" }] as RuleCondition[], actions: [{ type: "set_category", value: "" }] as RuleAction[], priority: 100, isActive: true };
  const [v, setV] = React.useState(blank);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (state) setV(state.rule ? { name: state.rule.name, matchMode: state.rule.match_mode, conditions: state.rule.conditions, actions: state.rule.actions, priority: state.rule.priority, isActive: state.rule.is_active } : blank);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state) return null;
  const setCond = (i: number, c: Partial<RuleCondition>) => setV({ ...v, conditions: v.conditions.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  const setAct = (i: number, a: Partial<RuleAction>) => setV({ ...v, actions: v.actions.map((x, j) => (j === i ? { ...x, ...a } : x)) });
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={state.rule ? "Edit rule" : "New rule"} size="lg">
        <div className="space-y-5">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="Rule name">
              <Input autoFocus value={v.name} maxLength={80} placeholder="e.g. Streaming services" onChange={(e) => setV({ ...v, name: e.target.value })} />
            </Field>
            <Field label="Priority" hint="Lower runs first.">
              <Input type="number" min={0} value={v.priority} onChange={(e) => setV({ ...v, priority: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              If
              <Select size="sm" className="w-[90px]" aria-label="Match mode" value={v.matchMode} onValueChange={(m) => setV({ ...v, matchMode: m as "all" })} options={[{ value: "all", label: "all" }, { value: "any", label: "any" }]} />
              of these conditions match
            </div>
            {v.conditions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2">
                <Select size="sm" className="w-[130px]" aria-label="Field" value={c.field} onValueChange={(f) => setCond(i, { field: f as RuleCondition["field"], operator: OPS_FOR[f as keyof typeof OPS_FOR][0], value: "" })} options={Object.entries(FIELD_LABELS).map(([k, l]) => ({ value: k, label: l }))} />
                <Select size="sm" className="w-[150px]" aria-label="Operator" value={c.operator} onValueChange={(o) => setCond(i, { operator: o as RuleCondition["operator"] })} options={OPS_FOR[c.field].map((o) => ({ value: o, label: OP_LABELS[o] }))} />
                {c.field === "account" ? (
                  <Select size="sm" className="w-[200px]" aria-label="Account" value={c.value || undefined} placeholder="Choose account" onValueChange={(val) => setCond(i, { value: val })} options={quick.accounts.map((a) => ({ value: a.id, label: a.name }))} />
                ) : c.field === "type" ? (
                  <Select size="sm" className="w-[160px]" aria-label="Type" value={c.value || undefined} placeholder="Choose type" onValueChange={(val) => setCond(i, { value: val })} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }, { value: "refund", label: "Refund" }]} />
                ) : (
                  <Input className="h-8 w-[200px]" inputMode={c.field === "amount" ? "decimal" : undefined} placeholder={c.field === "amount" ? "e.g. 100" : "e.g. netflix"} value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} aria-label="Value" />
                )}
                {c.operator === "between" && <Input className="h-8 w-[120px]" inputMode="decimal" placeholder="and…" value={c.value2 ?? ""} onChange={(e) => setCond(i, { value2: e.target.value })} aria-label="Upper value" />}
                <Button variant="ghost" size="icon-sm" aria-label="Remove condition" disabled={v.conditions.length === 1} onClick={() => setV({ ...v, conditions: v.conditions.filter((_, j) => j !== i) })}>
                  <X />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setV({ ...v, conditions: [...v.conditions, { field: "merchant", operator: "contains", value: "" }] })}>
              <Plus /> Add condition
            </Button>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Then</p>
            {v.actions.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2">
                <Select size="sm" className="w-[170px]" aria-label="Action" value={a.type} onValueChange={(t) => setAct(i, { type: t as RuleAction["type"], value: "" })} options={Object.entries(ACTION_LABELS).map(([k, l]) => ({ value: k, label: l }))} />
                {a.type === "set_category" && (
                  <Select size="sm" className="w-[220px]" aria-label="Category" value={a.value || undefined} placeholder="Choose category" onValueChange={(val) => setAct(i, { value: val })} options={categories.filter((c) => !c.is_archived).map((c) => ({ value: c.id, label: c.name, group: c.kind === "income" ? "Income" : "Expenses" }))} />
                )}
                {(a.type === "add_tag" || a.type === "rename_merchant") && <Input className="h-8 w-[220px]" value={a.value} placeholder={a.type === "add_tag" ? "tag name" : "new merchant name"} onChange={(e) => setAct(i, { value: e.target.value })} aria-label="Action value" />}
                <Button variant="ghost" size="icon-sm" aria-label="Remove action" disabled={v.actions.length === 1} onClick={() => setV({ ...v, actions: v.actions.filter((_, j) => j !== i) })}>
                  <X />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setV({ ...v, actions: [...v.actions, { type: "add_tag", value: "" }] })}>
              <Plus /> Add action
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const r = await saveRuleAction(state.rule?.id ?? null, v);
                setBusy(false);
                if (!r.ok) return toast.error(r.error);
                toast.success("Rule saved");
                onClose();
              }}
            >
              {state.rule ? "Save rule" : "Create rule"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
