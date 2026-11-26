"use client";
import * as React from "react";
import { ArrowLeftRight, SlidersHorizontal, Undo2 } from "lucide-react";
import type { TransactionView } from "@/server/services/transactions";
import { CategoryIcon } from "@/components/common/category-icon";
import { Money } from "@/components/common/money";
import { useFmt } from "@/components/common/prefs";
import { Badge } from "@/components/ui/misc";
import { toCents } from "@/lib/finance/money";

/** Signed display amount: money in positive, money out negative, transfers neutral. */
export function signedCents(t: Pick<TransactionView, "type" | "amount">) {
  const c = toCents(t.amount);
  if (t.type === "expense") return -c;
  if (t.type === "transfer") return c;
  return c;
}

export function TxIcon({ t }: { t: TransactionView }) {
  if (t.type === "transfer")
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-info-soft text-info">
        <ArrowLeftRight className="h-4 w-4" />
      </span>
    );
  if (t.type === "adjustment")
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <SlidersHorizontal className="h-4 w-4" />
      </span>
    );
  if (t.splits.length) return <CategoryIcon icon="receipt" color={t.splits[0].category_color ?? "#8a8a8a"} />;
  return <CategoryIcon icon={t.category_icon} color={t.category_color} />;
}

export function categoryLabel(t: TransactionView) {
  if (t.type === "transfer") return `${t.account_name} → ${t.to_account_name}`;
  if (t.type === "adjustment") return "Balance adjustment";
  if (t.splits.length) return `Split · ${t.splits.length} categories`;
  return t.category_name ?? "Uncategorized";
}

export function CompactTxRow({ t, onClick }: { t: TransactionView; onClick?: () => void }) {
  const f = useFmt();
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent focus-ring">
      <TxIcon t={t} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate text-[13.5px] font-medium">
          {t.merchant || "—"}
          {t.type === "refund" && <Undo2 className="h-3 w-3 text-muted-foreground" aria-label="Refund" />}
          {t.status === "pending" && <Badge tone="warning">Pending</Badge>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {categoryLabel(t)} · {f.shortDate(t.date)} · {t.type === "transfer" ? "Transfer" : t.account_name}
        </span>
      </span>
      <Money cents={signedCents(t)} currency={t.currency} tone={t.type === "transfer" ? "none" : "flow"} sign={t.type !== "transfer"} className="text-[13.5px] font-medium" />
    </button>
  );
}
