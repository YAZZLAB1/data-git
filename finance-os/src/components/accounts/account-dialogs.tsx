"use client";
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { accountSchema, balanceUpdateSchema, type AccountInput } from "@/lib/validation";
import { ACCOUNT_TYPE_LABELS, ASSET_TYPES, LIABILITY_TYPES, accountClass } from "@/lib/finance/ledger";
import { CURRENCIES, centsToDecimal } from "@/lib/finance/money";
import { createAccountAction, updateAccountAction, updateBalanceAction } from "@/server/actions/finance";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { usePrefs } from "@/components/common/prefs";

export interface EditableAccount {
  id: string;
  name: string;
  type: string;
  institution: string | null;
  currency: string;
  opening_balance: string;
  opening_date: string;
  notes: string | null;
  transactionCount: number;
  balance: number;
}

export function AccountDialog({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account?: EditableAccount | null }) {
  const prefs = usePrefs();
  const form = useForm<AccountInput>({
    resolver: zodResolver(accountSchema),
    values: account
      ? { name: account.name, type: account.type as AccountInput["type"], institution: account.institution, currency: account.currency as AccountInput["currency"], openingBalance: account.opening_balance, openingDate: account.opening_date, notes: account.notes }
      : { name: "", type: "checking", institution: "", currency: prefs.baseCurrency as AccountInput["currency"], openingBalance: "0", openingDate: prefs.today, notes: "" },
  });
  const e = form.formState.errors;
  const type = form.watch("type");
  const liability = accountClass(type) === "liability";
  const locked = !!account && account.transactionCount > 0;
  const submit = form.handleSubmit(async (v) => {
    const r = account ? await updateAccountAction(account.id, v) : await createAccountAction(v);
    if (!r.ok) {
      toast.error(r.error);
      if (r.field) form.setError(r.field as keyof AccountInput, { message: r.error });
      return;
    }
    toast.success(account ? "Account updated" : "Account created");
    onOpenChange(false);
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={account ? "Edit account" : "Add account"} description="Accounts are tracked manually. No bank credentials are ever stored.">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={e.name?.message} className="col-span-2">
              <Input autoFocus placeholder="e.g. Current account" {...form.register("name")} invalid={!!e.name} />
            </Field>
            <Field label="Type" error={e.type?.message} hint={locked && account ? "Can't switch between asset and liability once used." : undefined}>
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select
                    aria-label="Account type"
                    value={field.value}
                    onValueChange={field.onChange}
                    options={[
                      ...ASSET_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABELS[t], group: "Assets", disabled: locked && accountClass(account!.type) !== "asset" })),
                      ...LIABILITY_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABELS[t], group: "Liabilities", disabled: locked && accountClass(account!.type) !== "liability" })),
                    ]}
                  />
                )}
              />
            </Field>
            <Field label="Institution (optional)">
              <Input placeholder="e.g. CIH Bank" {...form.register("institution")} />
            </Field>
            <Field label="Currency" error={e.currency?.message} hint={locked ? "Fixed once the account has transactions." : undefined}>
              <Controller control={form.control} name="currency" render={({ field }) => <Select aria-label="Currency" disabled={locked} value={field.value} onValueChange={field.onChange} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />} />
            </Field>
            <Field label="Opening date" error={e.openingDate?.message} hint="Transactions can't be dated earlier.">
              <Input type="date" {...form.register("openingDate")} />
            </Field>
            <Field label={liability ? "Amount owed at opening" : "Opening balance"} error={e.openingBalance?.message} className="col-span-2" hint={liability ? "Enter what you owed on the opening date as a positive number." : "The balance at the start of the opening date."}>
              <Input inputMode="decimal" className="num" {...form.register("openingBalance")} invalid={!!e.openingBalance} />
            </Field>
            <Field label="Notes (optional)" className="col-span-2">
              <Textarea rows={2} {...form.register("notes")} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {account ? "Save changes" : "Add account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BalanceDialog({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account: { id: string; name: string; currency: string; balance: number; type: string } | null }) {
  const prefs = usePrefs();
  const liability = account ? accountClass(account.type) === "liability" : false;
  const form = useForm({
    resolver: zodResolver(balanceUpdateSchema),
    values: { accountId: account?.id ?? "", balance: account ? centsToDecimal(account.balance) : "0", date: prefs.today, note: "" },
  });
  const submit = form.handleSubmit(async (v) => {
    const r = await updateBalanceAction(v);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.data.delta === 0 ? "Balance already matches — nothing changed" : "Balance updated");
    onOpenChange(false);
  });
  if (!account) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Update balance · ${account.name}`} description="We record a balance adjustment for the difference, so your history stays consistent. Adjustments never count as income or expenses." size="sm">
        <form onSubmit={submit} className="space-y-4">
          <Field label={liability ? `Amount owed (${account.currency})` : `Balance (${account.currency})`} error={form.formState.errors.balance?.message as string | undefined}>
            <Input autoFocus inputMode="decimal" className="num" {...form.register("balance")} />
          </Field>
          <Field label="As of" error={form.formState.errors.date?.message as string | undefined}>
            <Input type="date" {...form.register("date")} />
          </Field>
          <Field label="Note (optional)">
            <Input placeholder="e.g. Matched bank statement" {...form.register("note")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Update balance
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
