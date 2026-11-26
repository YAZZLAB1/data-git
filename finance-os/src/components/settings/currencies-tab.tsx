"use client";
import * as React from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { RateRow } from "@/server/services/currency";
import { deleteRateAction, upsertRateAction } from "@/server/actions/finance";
import { CURRENCIES } from "@/lib/finance/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge, EmptyState } from "@/components/ui/misc";
import { useConfirm } from "@/components/ui/confirm";
import { useFmt, usePrefs } from "@/components/common/prefs";
import { Section } from "./settings-view";

export function CurrenciesTab({ rates, base }: { rates: RateRow[]; base: string }) {
  const f = useFmt();
  const prefs = usePrefs();
  const confirm = useConfirm();
  const [v, setV] = React.useState<{ baseCurrency: string; quoteCurrency: string; rate: string; rateDate: string }>({ baseCurrency: CURRENCIES.find((c) => c !== base) ?? "EUR", quoteCurrency: base, rate: "", rateDate: prefs.today });
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="space-y-6">
      <Section title="Exchange rates" description={`Each account and transaction keeps its own currency. To combine them in ${base} reports, Finance OS uses the latest rate you've stored on or before each date — never an invented one.`}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await upsertRateAction(v);
            setBusy(false);
            if (!r.ok) return toast.error(r.error);
            toast.success("Exchange rate saved");
            setV({ ...v, rate: "" });
          }}
        >
          <Field label="1 unit of">
            <Select className="w-24" aria-label="From currency" value={v.baseCurrency} onValueChange={(c) => setV({ ...v, baseCurrency: c })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </Field>
          <span className="pb-2 text-sm text-muted-foreground">=</span>
          <Field label="Rate">
            <Input className="w-32 num" inputMode="decimal" placeholder="e.g. 10.85" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} />
          </Field>
          <Field label="Currency">
            <Select className="w-24" aria-label="To currency" value={v.quoteCurrency} onValueChange={(c) => setV({ ...v, quoteCurrency: c })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Rate date">
            <Input type="date" value={v.rateDate} onChange={(e) => setV({ ...v, rateDate: e.target.value })} />
          </Field>
          <Button type="submit" loading={busy}>
            <Plus /> Save rate
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">Automatic rate retrieval isn't connected. Enter rates from your bank or a source you trust; the inverse rate is derived automatically.</p>
      </Section>
      <Section title="Stored rates">
        {rates.length === 0 ? (
          <EmptyState title="No exchange rates yet" body={`Add a rate to include foreign-currency accounts and transactions in ${base} totals.`} />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2">Pair</th>
                <th className="py-2 text-right">Rate</th>
                <th className="py-2">Date</th>
                <th className="py-2">Source</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rates.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 font-medium">
                    1 {r.base_currency} → {r.quote_currency}
                  </td>
                  <td className="py-2 text-right num">{Number(r.rate).toFixed(4)}</td>
                  <td className="py-2 pl-4 num">{f.date(r.rate_date)}</td>
                  <td className="py-2">{r.source === "sample" ? <Badge tone="warning">Sample data</Badge> : <Badge>Manual</Badge>}</td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete rate"
                      onClick={async () => {
                        if (!(await confirm({ title: "Delete this exchange rate?", description: "Reports that relied on it will use the nearest other rate, or exclude those amounts.", confirmLabel: "Delete rate", destructive: true }))) return;
                        const res = await deleteRateAction(r.id);
                        if (res.ok) toast.success("Exchange rate deleted");
                        else toast.error(res.error);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
