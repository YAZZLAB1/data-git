"use client";
import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TransactionForm, type TxFormValues } from "@/components/transactions/transaction-form";
import type { AccountOption, CategoryOption, TagOption } from "@/lib/types";
import type { TransactionRow } from "@/server/services/transactions";

interface QuickAddApi {
  open: (opts?: { editing?: TransactionRow; defaults?: Partial<TxFormValues> }) => void;
  accounts: AccountOption[];
  categories: CategoryOption[];
  tags: TagOption[];
}
const Ctx = React.createContext<QuickAddApi | null>(null);

export function useQuickAdd() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useQuickAdd must be used inside QuickAddProvider");
  return c;
}

export function QuickAddProvider({ accounts, categories, tags, children }: { accounts: AccountOption[]; categories: CategoryOption[]; tags: TagOption[]; children: React.ReactNode }) {
  const [state, setState] = React.useState<{ open: boolean; editing?: TransactionRow; defaults?: Partial<TxFormValues>; key: number }>({ open: false, key: 0 });
  const open = React.useCallback((opts?: { editing?: TransactionRow; defaults?: Partial<TxFormValues> }) => setState((s) => ({ open: true, editing: opts?.editing, defaults: opts?.defaults, key: s.key + 1 })), []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        if (document.querySelector("[role=dialog]")) return;
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <Ctx.Provider value={{ open, accounts, categories, tags }}>
      {children}
      <Dialog open={state.open} onOpenChange={(o) => setState((s) => ({ ...s, open: o }))}>
        <DialogContent
          key={state.key}
          title={state.editing ? "Edit transaction" : "New transaction"}
          description={state.editing ? undefined : "Record income, an expense, a transfer or a refund."}
          size="md"
        >
          <TransactionForm accounts={accounts} categories={categories} tags={tags} editing={state.editing} defaults={state.defaults} onDone={() => setState((s) => ({ ...s, open: false }))} />
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}
