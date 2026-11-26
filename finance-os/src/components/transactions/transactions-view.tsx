"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDownUp, Check, ChevronLeft, ChevronRight, Download, FileUp, Filter, ListChecks, Plus, Search, StickyNote, Tag, Trash2, Wand2, X, Info } from "lucide-react";
import type { TransactionView as Tx } from "@/server/services/transactions";
import type { TransactionFilters } from "@/lib/validation";
import { bulkCategorizeAction, deleteTransactionsAction, getTransactionAction, setReviewedAction } from "@/server/actions/transactions";
import { useQuickAdd } from "@/components/layout/quick-add";
import { useUpdateParams } from "@/components/layout/period-filter";
import { useConfirm } from "@/components/ui/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, NONE } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge, Checkbox, EmptyState } from "@/components/ui/misc";
import { Tip } from "@/components/ui/menu";
import { Money } from "@/components/common/money";
import { useFmt } from "@/components/common/prefs";
import { TxIcon, categoryLabel, signedCents } from "./tx-row";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

const TYPE_TONE = { income: "positive", expense: "neutral", transfer: "info", refund: "brand", adjustment: "outline" } as const;

export function TransactionsView({ data, filters, invalidFilters }: { data: { rows: Tx[]; total: number; page: number; pageSize: number }; filters: TransactionFilters; invalidFilters: boolean }) {
  const f = useFmt();
  const quick = useQuickAdd();
  const confirm = useConfirm();
  const update = useUpdateParams();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [q, setQ] = React.useState(filters.q ?? "");
  const [busy, setBusy] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setSelected(new Set()), [data]);
  React.useEffect(() => {
    if ((filters.q ?? "") === q) return;
    const h = setTimeout(() => update({ q: q || null, page: null }), 300);
    return () => clearTimeout(h);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, v: string | null) => update({ [k]: v, page: null });
  const activeFilters = ["account", "category", "type", "tag", "from", "to", "reviewed", "q"].filter((k) => (filters as Record<string, unknown>)[k]);
  const all = data.rows.length > 0 && data.rows.every((r) => selected.has(r.id));
  const ids = [...selected];

  const open = async (id: string) => {
    const r = await getTransactionAction(id);
    if (r.ok) quick.open({ editing: r.data });
    else toast.error(r.error);
  };
  const bulk = async (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) toast.success(msg);
    else toast.error((r as { error: string }).error);
  };

  const exportHref = `/api/export/transactions${filters.from || filters.to ? `?${new URLSearchParams({ ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) })}` : ""}`;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const start = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const end = Math.min(data.total, data.page * data.pageSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search merchant, notes, category…" className="pl-9" aria-label="Search transactions" />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/settings?tab=rules">
              <Wand2 /> Rules
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/transactions/import">
              <FileUp /> Import CSV
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={exportHref} download>
              <Download /> Export CSV
            </a>
          </Button>
          <Button size="sm" onClick={() => quick.open()}>
            <Plus /> Add transaction
          </Button>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="ml-1 h-4 w-4 text-muted-foreground" />
          <Select size="sm" className="w-[170px]" aria-label="Account" value={filters.account ?? NONE} onValueChange={(v) => set("account", v === NONE ? null : v)} options={[{ value: NONE, label: "All accounts" }, ...quick.accounts.map((a) => ({ value: a.id, label: a.isArchived ? `${a.name} (archived)` : a.name }))]} />
          <Select
            size="sm"
            className="w-[170px]"
            aria-label="Category"
            value={filters.category ?? NONE}
            onValueChange={(v) => set("category", v === NONE ? null : v)}
            options={[
              { value: NONE, label: "All categories" },
              { value: "uncategorized", label: "Uncategorized" },
              ...quick.categories.map((c) => ({ value: c.id, label: c.name, group: c.kind === "income" ? "Income" : "Expenses" })),
            ]}
          />
          <Select
            size="sm"
            className="w-[130px]"
            aria-label="Type"
            value={filters.type ?? NONE}
            onValueChange={(v) => set("type", v === NONE ? null : v)}
            options={[{ value: NONE, label: "All types" }, ...["expense", "income", "transfer", "refund", "adjustment"].map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))]}
          />
          {quick.tags.length > 0 && (
            <Select size="sm" className="w-[130px]" aria-label="Tag" value={filters.tag ?? NONE} onValueChange={(v) => set("tag", v === NONE ? null : v)} options={[{ value: NONE, label: "All tags" }, ...quick.tags.map((t) => ({ value: t.id, label: `#${t.name}` }))]} />
          )}
          <Select size="sm" className="w-[140px]" aria-label="Review status" value={filters.reviewed ?? NONE} onValueChange={(v) => set("reviewed", v === NONE ? null : v)} options={[{ value: NONE, label: "Any status" }, { value: "no", label: "Needs review" }, { value: "yes", label: "Reviewed" }]} />
          <div className="flex items-center gap-1">
            <Input type="date" aria-label="From date" className="h-8 w-[140px] text-[13px]" value={filters.from ?? ""} onChange={(e) => set("from", e.target.value || null)} />
            <span className="text-muted-foreground">–</span>
            <Input type="date" aria-label="To date" className="h-8 w-[140px] text-[13px]" value={filters.to ?? ""} onChange={(e) => set("to", e.target.value || null)} />
          </div>
          <Select
            size="sm"
            className="w-[150px]"
            aria-label="Sort"
            value={filters.sort}
            onValueChange={(v) => set("sort", v === "date_desc" ? null : v)}
            options={[
              { value: "date_desc", label: "Newest first" },
              { value: "date_asc", label: "Oldest first" },
              { value: "amount_desc", label: "Largest amount" },
              { value: "amount_asc", label: "Smallest amount" },
            ]}
          />
          {activeFilters.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                update({ account: null, category: null, type: null, tag: null, from: null, to: null, reviewed: null, q: null, page: null, sort: null });
              }}
            >
              <X /> Clear filters
            </Button>
          )}
        </div>
        {invalidFilters && <p className="mt-2 text-xs text-warning">Some filters in the link weren't valid and were ignored.</p>}
      </Card>

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-primary px-4 py-2 text-primary-foreground shadow-card-hover animate-fade-up">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => bulk(() => setReviewedAction(ids, true), `${ids.length} marked reviewed`)}>
              <ListChecks /> Mark reviewed
            </Button>
            <Select
              size="sm"
              className="w-[180px] text-foreground"
              aria-label="Categorize selected"
              value={undefined}
              placeholder="Categorize as…"
              onValueChange={(v) =>
                bulk(async () => {
                  const r = await bulkCategorizeAction(ids, v);
                  if (r.ok && r.data.skipped) toast.message(`${r.data.skipped} skipped: transfers, splits or a different kind.`);
                  return r;
                }, "Category updated")
              }
              options={quick.categories.filter((c) => !c.isArchived).map((c) => ({ value: c.id, label: c.name, group: c.kind === "income" ? "Income" : "Expenses" }))}
            />
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({ title: `Delete ${ids.length} transaction${ids.length === 1 ? "" : "s"}?`, description: "Balances, budgets and reports will be recalculated. This can't be undone.", confirmLabel: "Delete transactions", destructive: true });
                if (ok) bulk(() => deleteTransactionsAction(ids), `${ids.length} deleted`);
              }}
            >
              <Trash2 /> Delete
            </Button>
            <Button size="icon-sm" variant="ghost" className="text-primary-foreground hover:bg-white/10" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
              <X />
            </Button>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        {data.rows.length === 0 ? (
          activeFilters.length ? (
            <EmptyState icon={<Search />} title={COPY.empty.transactionsFiltered.title} body={COPY.empty.transactionsFiltered.body} />
          ) : (
            <EmptyState icon={<ArrowDownUp />} title={COPY.empty.transactions.title} body={COPY.empty.transactions.body} action={<div className="flex gap-2"><Button size="sm" onClick={() => quick.open()}><Plus /> Add transaction</Button><Button asChild size="sm" variant="outline"><Link href="/transactions/import">Import CSV</Link></Button></div>} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <Checkbox aria-label="Select all on this page" checked={all ? true : selected.size ? "indeterminate" : false} onCheckedChange={(c) => setSelected(c === true ? new Set(data.rows.map((r) => r.id)) : new Set())} />
                  </th>
                  <SortTh label="Date" active={filters.sort.startsWith("date")} dir={filters.sort === "date_asc" ? "asc" : "desc"} onClick={() => set("sort", filters.sort === "date_desc" ? "date_asc" : null)} />
                  <th className="px-3 py-2.5">Merchant / description</th>
                  <th className="px-3 py-2.5">Category</th>
                  <th className="px-3 py-2.5">Account</th>
                  <th className="px-3 py-2.5">Type</th>
                  <SortTh label="Amount" right active={filters.sort.startsWith("amount")} dir={filters.sort === "amount_asc" ? "asc" : "desc"} onClick={() => set("sort", filters.sort === "amount_desc" ? "amount_asc" : "amount_desc")} />
                  <th className="px-3 py-2.5">Tags</th>
                  <th className="px-3 py-2.5">Notes</th>
                  <th className="w-12 px-3 py-2.5 text-center">
                    <Tip content="Reviewed">
                      <Check className="mx-auto h-3.5 w-3.5" />
                    </Tip>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.rows.map((t) => (
                  <tr key={t.id} className={cn("group cursor-pointer transition-colors hover:bg-accent/60", selected.has(t.id) && "bg-brand-soft/60")} onClick={() => open(t.id)}>
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={`Select ${t.merchant}`}
                        checked={selected.has(t.id)}
                        onCheckedChange={(c) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (c === true) n.add(t.id);
                            else n.delete(t.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground num">{f.date(t.date)}</td>
                    <td className="max-w-[240px] px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <TxIcon t={t} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium">
                            {t.merchant || "—"}
                            {t.status === "pending" && <Badge tone="warning">Pending</Badge>}
                          </p>
                          {t.description && <p className="truncate text-xs text-muted-foreground">{t.description}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[180px] px-3 py-2.5">
                      {t.splits.length ? (
                        <Tip content={t.splits.map((s) => `${s.category_name ?? "Uncategorized"}: ${s.amount}`).join(" · ")}>
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">Split · {t.splits.length}</span>
                        </Tip>
                      ) : t.type === "transfer" || t.type === "adjustment" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : t.category_name ? (
                        <span className="inline-flex max-w-full items-center gap-1.5 truncate text-[13px]">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.category_color ?? undefined }} />
                          <span className="truncate">{t.category_name}</span>
                          {t.category_source === "rule" && (
                            <Tip content="Categorized by a rule">
                              <Wand2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                            </Tip>
                          )}
                        </span>
                      ) : (
                        <Badge tone="warning">Uncategorized</Badge>
                      )}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-[13px] text-muted-foreground">{t.type === "transfer" ? categoryLabel(t) : t.account_name}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={TYPE_TONE[t.type]}>{t.type[0].toUpperCase() + t.type.slice(1)}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <Money cents={signedCents(t)} currency={t.currency} tone={t.type === "transfer" || t.type === "adjustment" ? "none" : "flow"} sign={t.type !== "transfer"} className="font-medium" />
                      {t.currency !== f.baseCurrency && (
                        <Tip
                          content={
                            t.base
                              ? `Converted at 1 ${t.currency} = ${t.base.rate.toFixed(4)} ${f.baseCurrency} (${t.base.path}, rate of ${f.date(t.base.rateDate)})${t.base.estimated ? " — nearest later rate, no earlier rate stored" : ""}`
                              : `No ${t.currency}→${f.baseCurrency} exchange rate stored, so this isn't included in ${f.baseCurrency} reports.`
                          }
                        >
                          <p className={cn("flex items-center justify-end gap-1 text-xs", t.base ? "text-muted-foreground" : "text-warning")}>
                            {t.base ? `≈ ${f.money(t.base.cents)}` : "No rate"}
                            <Info className="h-3 w-3" />
                          </p>
                        </Tip>
                      )}
                    </td>
                    <td className="max-w-[140px] px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {t.tags.map((tg) => (
                          <span key={tg.id} className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            <Tag className="h-2.5 w-2.5" />
                            {tg.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="max-w-[160px] px-3 py-2.5">
                      {t.notes && (
                        <Tip content={t.notes}>
                          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <StickyNote className="h-3 w-3 shrink-0" />
                            <span className="truncate">{t.notes}</span>
                          </span>
                        </Tip>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={t.is_reviewed ? "Mark as not reviewed" : "Mark as reviewed"}
                        checked={t.is_reviewed}
                        onCheckedChange={async (c) => {
                          const r = await setReviewedAction([t.id], c === true);
                          if (!r.ok) toast.error(r.error);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-[13px] text-muted-foreground">
            <span className="num">
              Showing {start}–{end} of {data.total.toLocaleString(f.locale)}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" disabled={data.page <= 1} onClick={() => update({ page: String(data.page - 1) })} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <span className="num px-2">
                Page {data.page} of {pages}
              </span>
              <Button variant="ghost" size="icon-sm" disabled={data.page >= pages} onClick={() => update({ page: String(data.page + 1) })} aria-label="Next page">
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function SortTh({ label, active, dir, onClick, right }: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; right?: boolean }) {
  return (
    <th className={cn("px-3 py-2.5", right && "text-right")}>
      <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
        {label}
        <ArrowDownUp className={cn("h-3 w-3", !active && "opacity-40")} />
        {active && <span className="sr-only">sorted {dir === "asc" ? "ascending" : "descending"}</span>}
      </button>
    </th>
  );
}
