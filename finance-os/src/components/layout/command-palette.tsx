"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Plus, Search, Upload, Landmark, Moon } from "lucide-react";
import { NAV } from "./nav";
import { useQuickAdd } from "./quick-add";
import { searchTransactionsAction, getTransactionAction } from "@/server/actions/transactions";
import type { TransactionView } from "@/server/services/transactions";
import { Money } from "@/components/common/money";
import { useFmt } from "@/components/common/prefs";

export function CommandPalette({ open, onOpenChange, onToggleTheme }: { open: boolean; onOpenChange: (o: boolean) => void; onToggleTheme: () => void }) {
  const router = useRouter();
  const quick = useQuickAdd();
  const f = useFmt();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<TransactionView[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
    }
  }, [open]);

  React.useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const h = setTimeout(async () => {
      const r = await searchTransactionsAction(q.trim());
      setLoading(false);
      if (r.ok) setResults(r.data);
    }, 200);
    return () => clearTimeout(h);
  }, [q]);

  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]">
          <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search transactions, jump to a page or run a command.</DialogPrimitive.Description>
          <Command shouldFilter={false} className="flex flex-col" loop>
            <div className="flex items-center gap-2 border-b px-4">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Command.Input value={q} onValueChange={setQ} placeholder="Search transactions, pages and commands…" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              <kbd className="rounded border px-1.5 text-[10px] text-muted-foreground">ESC</kbd>
            </div>
            <Command.List className="max-h-[380px] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">{loading ? "Searching…" : "No matches. Try a merchant, category or note."}</Command.Empty>
              {results.length > 0 && (
                <Command.Group heading="Transactions">
                  {results.map((t) => (
                    <Item
                      key={t.id}
                      value={`tx-${t.id}`}
                      onSelect={() =>
                        go(async () => {
                          const r = await getTransactionAction(t.id);
                          if (r.ok) quick.open({ editing: r.data });
                        })
                      }
                    >
                      <span className="flex-1 truncate">
                        {t.merchant || t.type} <span className="text-muted-foreground">· {f.shortDate(t.date)} · {t.category_name ?? t.account_name}</span>
                      </span>
                      <Money cents={Math.round(Number(t.amount) * 100) * (t.type === "expense" ? -1 : 1)} currency={t.currency} tone="flow" className="text-xs" />
                    </Item>
                  ))}
                </Command.Group>
              )}
              {(() => {
                const ql = q.trim().toLowerCase();
                const actions = [
                  { k: "new transaction add expense income", label: "New transaction", hint: "N", icon: Plus, run: () => quick.open() },
                  { k: "import csv bank statement", label: "Import CSV", icon: Upload, run: () => router.push("/transactions/import") },
                  { k: "add account create account", label: "Add account", icon: Landmark, run: () => router.push("/accounts?new=1") },
                  { k: "toggle theme dark light mode", label: "Toggle dark mode", icon: Moon, run: onToggleTheme },
                ].filter((a) => !ql || a.k.includes(ql) || a.label.toLowerCase().includes(ql));
                const pages = NAV.filter((n) => !ql || n.label.toLowerCase().includes(ql));
                return (
                  <>
                    {actions.length > 0 && (
                      <Command.Group heading="Actions">
                        {actions.map((a) => (
                          <Item key={a.label} value={a.label} onSelect={() => go(a.run)}>
                            <a.icon className="h-4 w-4 text-muted-foreground" />
                            <span className="flex-1">{a.label}</span>
                            {a.hint && <kbd className="rounded border px-1.5 text-[10px] text-muted-foreground">{a.hint}</kbd>}
                          </Item>
                        ))}
                      </Command.Group>
                    )}
                    {pages.length > 0 && (
                      <Command.Group heading="Go to">
                        {pages.map((n) => (
                          <Item key={n.href} value={`page-${n.href}`} onSelect={() => go(() => router.push(n.href))}>
                            <n.icon className="h-4 w-4 text-muted-foreground" />
                            {n.label}
                          </Item>
                        ))}
                      </Command.Group>
                    )}
                  </>
                );
              })()}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Item({ children, onSelect, value }: { children: React.ReactNode; onSelect: () => void; value: string }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-accent">
      {children}
    </Command.Item>
  );
}
