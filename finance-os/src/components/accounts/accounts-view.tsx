"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Download, History, MoreHorizontal, Pencil, Plus, Scale, Trash2, Landmark, AlertTriangle } from "lucide-react";
import type { Account } from "@/server/services/accounts";
import { archiveAccountAction, deleteAccountAction } from "@/server/actions/finance";
import { ACCOUNT_TYPE_LABELS } from "@/lib/finance/ledger";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/confirm";
import { AnimatedMoney, Money } from "@/components/common/money";
import { useFmt } from "@/components/common/prefs";
import { AccountDialog, BalanceDialog } from "./account-dialogs";
import { AccountIcon } from "./account-icon";
import { COPY, missingRateMessage } from "@/lib/copy";

type Row = Account & { baseBalance: number | null };

export function AccountsView({ accounts, totals, openNew }: { accounts: Row[]; totals: { netWorth: number; assets: number; liabilities: number; missing: { currency: string; count: number }[] }; openNew: boolean }) {
  const f = useFmt();
  const router = useRouter();
  const confirm = useConfirm();
  const [dialog, setDialog] = React.useState<{ kind: "edit" | "balance"; account: Row | null } | null>(openNew ? { kind: "edit", account: null } : null);
  const [showArchived, setShowArchived] = React.useState(false);
  const active = accounts.filter((a) => !a.is_archived);
  const archived = accounts.filter((a) => a.is_archived);
  const groups = [
    { title: "Assets", total: totals.assets, rows: active.filter((a) => a.cls === "asset") },
    { title: "Liabilities", total: totals.liabilities, rows: active.filter((a) => a.cls === "liability") },
  ];

  const act = async (p: Promise<{ ok: boolean; error?: string }>, msg: string) => {
    const r = await p;
    if (r.ok) toast.success(msg);
    else toast.error((r as { error: string }).error);
  };

  const menu = (a: Row) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${a.name}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => setDialog({ kind: "balance", account: a })}>
          <Scale /> Update balance
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog({ kind: "edit", account: a })}>
          <Pencil /> Edit details
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/accounts/${a.id}`}>
            <History /> History
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => act(archiveAccountAction(a.id, !a.is_archived), a.is_archived ? "Account restored" : "Account archived")}>
          {a.is_archived ? <ArchiveRestore /> : <Archive />} {a.is_archived ? "Restore" : "Archive"}
        </DropdownMenuItem>
        <DropdownMenuItem
          destructive
          onSelect={async () => {
            const ok = await confirm({
              title: `Delete “${a.name}”?`,
              description: a.transactionCount ? `This account has ${a.transactionCount} transactions, so it can't be deleted. Archive it to hide it while keeping your history.` : "The account will be removed permanently. This can't be undone.",
              confirmLabel: a.transactionCount ? "Archive instead" : "Delete account",
              destructive: !a.transactionCount,
            });
            if (!ok) return;
            if (a.transactionCount) act(archiveAccountAction(a.id, true), "Account archived");
            else act(deleteAccountAction(a.id), "Account deleted");
          }}
        >
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const row = (a: Row) => (
    <li key={a.id}>
      <div role="link" tabIndex={0} onClick={() => router.push(`/accounts/${a.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/accounts/${a.id}`)} className="flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/60 focus-ring">
        <AccountIcon type={a.type} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            {a.name}
            {a.is_archived && <Badge tone="outline">Archived</Badge>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {ACCOUNT_TYPE_LABELS[a.type]}
            {a.institution ? ` · ${a.institution}` : ""} · {a.transactionCount} transactions{a.lastActivity ? ` · last ${f.shortDate(a.lastActivity)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <Money cents={a.balance} currency={a.currency} className={a.cls === "liability" && a.balance > 0 ? "font-semibold text-negative" : "font-semibold"} />
          {a.currency !== f.baseCurrency && <p className="text-xs text-muted-foreground num">{a.baseBalance === null ? "No exchange rate" : `≈ ${f.money(a.baseBalance)}`}</p>}
          {a.cls === "liability" && <p className="text-xs text-muted-foreground">owed</p>}
        </div>
        {menu(a)}
      </div>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Net worth", value: totals.netWorth, sub: "Assets minus liabilities" },
          { label: "Assets", value: totals.assets, sub: `${active.filter((a) => a.cls === "asset").length} accounts` },
          { label: "Liabilities", value: totals.liabilities, sub: `${active.filter((a) => a.cls === "liability").length} accounts` },
        ].map((c) => (
          <Card key={c.label} className="card-hover p-5">
            <p className="text-[13px] font-medium text-muted-foreground">{c.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              <AnimatedMoney cents={c.value} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>
          </Card>
        ))}
      </div>
      {totals.missing.length > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" /> {totals.missing.map((m) => missingRateMessage(m.count, m.currency, f.baseCurrency)).join(" ")}
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Balances are calculated from each account's opening balance and its transactions.</p>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/api/export/accounts" download>
              <Download /> Export CSV
            </a>
          </Button>
          <Button size="sm" onClick={() => setDialog({ kind: "edit", account: null })}>
            <Plus /> Add account
          </Button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <EmptyState icon={<Landmark />} title={COPY.empty.accounts.title} body={COPY.empty.accounts.body} action={<Button size="sm" onClick={() => setDialog({ kind: "edit", account: null })}><Plus /> Add account</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.title}>
              <CardHeader className="border-b pb-4">
                <div>
                  <CardTitle>{g.title}</CardTitle>
                  <CardDescription>{g.rows.length} active</CardDescription>
                </div>
                <Money cents={g.total} className="text-lg font-semibold" />
              </CardHeader>
              {g.rows.length === 0 ? (
                <CardContent className="py-8 text-center text-sm text-muted-foreground">No {g.title.toLowerCase()} yet.</CardContent>
              ) : (
                <ul className="divide-y">{g.rows.map(row)}</ul>
              )}
            </Card>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowArchived((s) => !s)}>
            <Archive /> {showArchived ? "Hide" : "Show"} {archived.length} archived account{archived.length === 1 ? "" : "s"}
          </Button>
          {showArchived && (
            <Card className="mt-2">
              <ul className="divide-y">{archived.map(row)}</ul>
              <p className="border-t px-5 py-2 text-xs text-muted-foreground">Archived accounts stay in historical reports and net worth.</p>
            </Card>
          )}
        </div>
      )}

      <AccountDialog open={dialog?.kind === "edit"} onOpenChange={(o) => !o && setDialog(null)} account={dialog?.kind === "edit" ? dialog.account : null} />
      <BalanceDialog open={dialog?.kind === "balance"} onOpenChange={(o) => !o && setDialog(null)} account={dialog?.kind === "balance" ? dialog.account : null} />
    </div>
  );
}
