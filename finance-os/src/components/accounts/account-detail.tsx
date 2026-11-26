"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Pencil, Scale } from "lucide-react";
import type { Account } from "@/server/services/accounts";
import type { TransactionView } from "@/server/services/transactions";
import { getTransactionAction } from "@/server/actions/transactions";
import { ACCOUNT_TYPE_LABELS } from "@/lib/finance/ledger";
import { toCents } from "@/lib/finance/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/misc";
import { ChartCard } from "@/components/charts/chart-card";
import { BalanceChart } from "@/components/charts/charts";
import { AnimatedMoney } from "@/components/common/money";
import { useFmt } from "@/components/common/prefs";
import { CompactTxRow } from "@/components/transactions/tx-row";
import { useQuickAdd } from "@/components/layout/quick-add";
import { AccountDialog, BalanceDialog } from "./account-dialogs";
import { AccountIcon } from "./account-icon";

export function AccountDetail({ account, history, transactions }: { account: Account; history: { date: string; balance: string; source: string }[]; transactions: TransactionView[] }) {
  const f = useFmt();
  const quick = useQuickAdd();
  const [dialog, setDialog] = React.useState<"edit" | "balance" | null>(null);
  const points = history.map((h) => ({ label: f.shortDate(h.date), value: toCents(h.balance), date: h.date, source: h.source }));
  const color = account.cls === "liability" ? "var(--chart-liabilities)" : "var(--chart-net)";
  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/accounts">
          <ArrowLeft /> All accounts
        </Link>
      </Button>
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-4">
          <AccountIcon type={account.type} className="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              {account.name} {account.is_archived && <Badge tone="outline">Archived</Badge>}
            </h2>
            <p className="text-sm text-muted-foreground">
              {ACCOUNT_TYPE_LABELS[account.type]} {account.institution && `· ${account.institution}`} · {account.currency} · opened {f.date(account.opening_date)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{account.cls === "liability" ? "Amount owed" : "Current balance"}</p>
            <p className="text-3xl font-semibold tracking-tight">
              <AnimatedMoney cents={account.balance} currency={account.currency} />
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog("edit")}>
              <Pencil /> Edit
            </Button>
            <Button size="sm" onClick={() => setDialog("balance")}>
              <Scale /> Update balance
            </Button>
          </div>
        </div>
        {account.notes && <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">{account.notes}</p>}
      </Card>

      <ChartCard
        title="Balance history"
        description="End-of-day balances recorded from this account's transactions."
        height={280}
        empty={points.length < 2}
        table={{ headers: ["Date", "Balance", "Source"], rows: [...points].reverse().map((p) => [f.date(p.date), f.money(p.value, account.currency), p.source]) }}
      >
        <BalanceChart data={points} color={color} />
      </ChartCard>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Transactions</CardTitle>
            <CardDescription>Most recent 25 · {account.transactionCount} in total</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/transactions?account=${account.id}`}>
              View all <ArrowRight />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="px-3">
          {transactions.length === 0 ? (
            <EmptyState title="No transactions in this account" body="Add one, or import a statement for this account." />
          ) : (
            transactions.map((t) => (
              <CompactTxRow
                key={t.id}
                t={t}
                onClick={async () => {
                  const r = await getTransactionAction(t.id);
                  if (r.ok) quick.open({ editing: r.data });
                  else toast.error(r.error);
                }}
              />
            ))
          )}
        </CardContent>
      </Card>
      <AccountDialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} account={account} />
      <BalanceDialog open={dialog === "balance"} onOpenChange={(o) => !o && setDialog(null)} account={account} />
    </div>
  );
}
