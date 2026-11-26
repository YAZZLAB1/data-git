"use client";
import * as React from "react";
import { toast } from "sonner";
import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import type { Category } from "@/server/services/categories";
import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "@/server/actions/finance";
import { deleteTagAction } from "@/server/actions/transactions";
import { PALETTE } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select, NONE } from "@/components/ui/select";
import { Badge, Switch } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm";
import { CategoryIcon, ICON_NAMES, IconByName } from "@/components/common/category-icon";
import { cn } from "@/lib/utils";
import { Section } from "./settings-view";

const COLORS = [...PALETTE, "#8a8a8a", "#0f766e", "#b45309", "#7c3aed"];

export function CategoriesTab({ categories, usage, tags }: { categories: Category[]; usage: Record<string, number>; tags: { id: string; name: string; n: number }[] }) {
  const confirm = useConfirm();
  const [edit, setEdit] = React.useState<{ category: Category | null; kind: "expense" | "income" } | null>(null);
  const [del, setDel] = React.useState<Category | null>(null);
  const groups: { kind: "expense" | "income"; title: string }[] = [
    { kind: "expense", title: "Expense categories" },
    { kind: "income", title: "Income categories" },
  ];
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <Section key={g.kind} title={g.title} description={g.kind === "expense" ? "Discretionary categories feed the savings scenarios in Insights." : undefined}>
          <ul className="divide-y rounded-lg border">
            {categories
              .filter((c) => c.kind === g.kind)
              .map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                  <span className="flex-1 text-sm font-medium">{c.name}</span>
                  {c.is_discretionary && <Badge tone="brand">Discretionary</Badge>}
                  <span className="w-28 text-right text-xs text-muted-foreground num">{usage[c.id] ?? 0} transactions</span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => setEdit({ category: c, kind: c.kind })}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.name}`} onClick={() => setDel(c)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
          </ul>
          <Button className="mt-3" variant="outline" size="sm" onClick={() => setEdit({ category: null, kind: g.kind })}>
            <Plus /> Add {g.kind} category
          </Button>
        </Section>
      ))}
      <Section title="Tags" description="Tags are created as you type them on a transaction.">
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm">
                <Tag className="h-3 w-3 text-muted-foreground" /> {t.name} <span className="text-xs text-muted-foreground">{t.n}</span>
                <button
                  className="rounded p-0.5 text-muted-foreground hover:text-negative"
                  aria-label={`Delete tag ${t.name}`}
                  onClick={async () => {
                    if (!(await confirm({ title: `Delete tag “${t.name}”?`, description: `It will be removed from ${t.n} transaction${t.n === 1 ? "" : "s"}. The transactions stay.`, confirmLabel: "Delete tag", destructive: true }))) return;
                    const r = await deleteTagAction(t.id);
                    if (r.ok) toast.success("Tag deleted");
                    else toast.error(r.error);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Section>
      <CategoryDialog state={edit} onClose={() => setEdit(null)} />
      <DeleteCategoryDialog category={del} categories={categories} usage={del ? (usage[del.id] ?? 0) : 0} onClose={() => setDel(null)} />
    </div>
  );
}

function CategoryDialog({ state, onClose }: { state: { category: Category | null; kind: "expense" | "income" } | null; onClose: () => void }) {
  const [v, setV] = React.useState({ name: "", icon: "circle-dashed", color: PALETTE[0] as string, isDiscretionary: false });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (state) setV(state.category ? { name: state.category.name, icon: state.category.icon, color: state.category.color, isDiscretionary: state.category.is_discretionary } : { name: "", icon: "circle-dashed", color: PALETTE[0], isDiscretionary: false });
  }, [state]);
  if (!state) return null;
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={state.category ? "Edit category" : `New ${state.kind} category`} size="sm">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <CategoryIcon icon={v.icon} color={v.color} size="lg" />
            <Field label="Name" className="flex-1">
              <Input autoFocus value={v.name} maxLength={60} onChange={(e) => setV({ ...v, name: e.target.value })} />
            </Field>
          </div>
          <Field label="Colour">
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setV({ ...v, color: c })} className={cn("h-7 w-7 rounded-full ring-offset-2 ring-offset-card", v.color === c && "ring-2 ring-foreground")} style={{ background: c }} />
              ))}
            </div>
          </Field>
          <Field label="Icon">
            <div className="grid grid-cols-9 gap-1">
              {ICON_NAMES.map((n) => (
                <button key={n} type="button" aria-label={n} onClick={() => setV({ ...v, icon: n })} className={cn("flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent", v.icon === n && "bg-accent text-foreground ring-1 ring-border")}>
                  <IconByName name={n} className="h-4 w-4" />
                </button>
              ))}
            </div>
          </Field>
          {state.kind === "expense" && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={v.isDiscretionary} onCheckedChange={(c) => setV({ ...v, isDiscretionary: c })} /> Discretionary (nice-to-have) spending
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const r = state.category ? await updateCategoryAction(state.category.id, { ...v, kind: state.kind }) : await createCategoryAction({ ...v, kind: state.kind });
                setBusy(false);
                if (!r.ok) return toast.error(r.error);
                toast.success(state.category ? "Category updated" : "Category created");
                onClose();
              }}
            >
              {state.category ? "Save changes" : "Create category"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCategoryDialog({ category, categories, usage, onClose }: { category: Category | null; categories: Category[]; usage: number; onClose: () => void }) {
  const [target, setTarget] = React.useState<string>(NONE);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setTarget(NONE), [category]);
  if (!category) return null;
  const others = categories.filter((c) => c.kind === category.kind && c.id !== category.id && !c.is_archived);
  return (
    <Dialog open={!!category} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Delete “${category.name}”?`} description={usage ? `${usage} transactions use this category. Move them to another category, or leave them uncategorized.` : "No transactions use this category."} size="sm">
        {usage > 0 && (
          <Field label="Move its transactions to">
            <Select aria-label="Reassign to" value={target} onValueChange={setTarget} options={[{ value: NONE, label: "Leave uncategorized" }, ...others.map((c) => ({ value: c.id, label: c.name }))]} />
          </Field>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Budgets for this category are removed. This can't be undone.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const r = await deleteCategoryAction(category.id, target === NONE ? null : target);
              setBusy(false);
              if (!r.ok) return toast.error(r.error);
              toast.success("Category deleted");
              onClose();
            }}
          >
            Delete category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
