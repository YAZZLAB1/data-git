"use client";
import * as React from "react";
import { useForm, useFieldArray, Controller, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ChevronDown, Plus, Sparkles, Trash2, X, ArrowRight, Info } from "lucide-react";
import { transactionSchema, normalizeAmountInput } from "@/lib/validation";
import { CURRENCIES, toCents, centsToDecimal } from "@/lib/finance/money";
import type { AccountOption, CategoryOption, TagOption } from "@/lib/types";
import type { TransactionRow } from "@/server/services/transactions";
import { createTransactionAction, deleteTransactionsAction, suggestCategoryAction, updateTransactionAction } from "@/server/actions/transactions";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, NONE } from "@/components/ui/select";
import { Switch, Checkbox } from "@/components/ui/misc";
import { useConfirm } from "@/components/ui/confirm";
import { CategoryIcon } from "@/components/common/category-icon";
import { usePrefs } from "@/components/common/prefs";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

type TxType = "expense" | "income" | "transfer" | "refund";
export interface TxFormValues {
  type: TxType;
  amount: string;
  currency: string;
  date: string;
  accountId: string;
  toAccountId: string | null;
  toAmount: string | null;
  fxRate: string | null;
  merchant: string;
  description: string | null;
  categoryId: string | null;
  categorySource: "manual" | "suggestion" | "rule" | "none";
  notes: string | null;
  tags: string[];
  status: "posted" | "pending";
  isReviewed: boolean;
  splits: { categoryId: string | null; amount: string; notes: string | null }[];
}

const TYPES: { value: TxType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
  { value: "refund", label: "Refund" },
];

export function rowToValues(t: TransactionRow): TxFormValues {
  return {
    type: (t.type === "adjustment" ? "expense" : t.type) as TxType,
    amount: t.amount,
    currency: t.currency,
    date: t.date,
    accountId: t.account_id,
    toAccountId: t.to_account_id,
    toAmount: t.type === "transfer" && t.to_account_currency !== t.account_currency ? t.to_amount : null,
    fxRate: t.fx_rate,
    merchant: t.merchant,
    description: t.description,
    categoryId: t.category_id,
    categorySource: "manual",
    notes: t.notes,
    tags: t.tags.map((x) => x.name),
    status: t.status,
    isReviewed: t.is_reviewed,
    splits: t.splits.map((s) => ({ categoryId: s.category_id, amount: s.amount, notes: s.notes })),
  };
}

export function TransactionForm({
  accounts,
  categories,
  tags,
  editing,
  defaults,
  onDone,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  tags: TagOption[];
  editing?: TransactionRow | null;
  defaults?: Partial<TxFormValues>;
  onDone: () => void;
}) {
  const prefs = usePrefs();
  const confirm = useConfirm();
  const active = accounts.filter((a) => !a.isArchived || a.id === editing?.account_id || a.id === editing?.to_account_id);
  const firstAccount = active.find((a) => a.cls === "asset") ?? active[0];
  const initial: TxFormValues = editing
    ? rowToValues(editing)
    : {
        type: "expense",
        amount: "",
        currency: firstAccount?.currency ?? prefs.baseCurrency,
        date: prefs.today,
        accountId: firstAccount?.id ?? "",
        toAccountId: null,
        toAmount: null,
        fxRate: null,
        merchant: "",
        description: null,
        categoryId: null,
        categorySource: "none",
        notes: null,
        tags: [],
        status: "posted",
        isReviewed: false,
        splits: [],
        ...defaults,
      };
  const form = useForm<TxFormValues>({
    defaultValues: initial,
    resolver: zodResolver(transactionSchema as never) as unknown as Resolver<TxFormValues>,
    mode: "onSubmit",
  });
  const { register, control, handleSubmit, watch, setValue, formState } = form;
  const errors = formState.errors;
  const splits = useFieldArray({ control, name: "splits" });
  const [suggestion, setSuggestion] = React.useState<{ categoryId: string; reason: string } | null>(null);
  const [more, setMore] = React.useState(!!(editing && (editing.notes || editing.tags.length || editing.splits.length || editing.description)));
  const [tagDraft, setTagDraft] = React.useState("");
  const [busy, setBusy] = React.useState<null | "save" | "again" | "delete">(null);
  const amountRef = React.useRef<HTMLInputElement | null>(null);

  const type = watch("type");
  const accountId = watch("accountId");
  const toAccountId = watch("toAccountId");
  const currency = watch("currency");
  const merchant = watch("merchant");
  const amount = watch("amount");
  const categoryId = watch("categoryId");
  const tagList = watch("tags");
  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const kind = type === "income" ? "income" : "expense";
  const catOptions = categories.filter((c) => c.kind === kind && (!c.isArchived || c.id === categoryId));
  const splitting = splits.fields.length > 0;

  React.useEffect(() => {
    if (!editing) setTimeout(() => amountRef.current?.focus(), 30);
  }, [editing]);

  // Keep currency aligned with the account unless the user picked another one.
  const currencyTouched = React.useRef(!!editing && editing.currency !== editing.account_currency);
  React.useEffect(() => {
    if (account && !currencyTouched.current) setValue("currency", account.currency);
  }, [account, setValue]);

  // Clear category if it no longer matches the type.
  React.useEffect(() => {
    if (categoryId && !categories.some((c) => c.id === categoryId && c.kind === kind)) setValue("categoryId", null);
    if (type === "transfer") {
      setValue("categoryId", null);
      if (splits.fields.length) splits.replace([]);
    }
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Category suggestion from rules / history / keywords.
  React.useEffect(() => {
    if (type === "transfer" || !merchant || merchant.trim().length < 2 || !accountId) {
      setSuggestion(null);
      return;
    }
    const handle = setTimeout(async () => {
      const r = await suggestCategoryAction({ merchant, accountId, amount, type });
      if (!r.ok || !r.data) return setSuggestion(null);
      setSuggestion({ categoryId: r.data.categoryId, reason: r.data.reason });
      const src = form.getValues("categorySource");
      if (!form.getValues("categoryId") || src === "suggestion") {
        setValue("categoryId", r.data.categoryId);
        setValue("categorySource", "suggestion");
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [merchant, accountId, type]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalCents = (() => {
    try {
      return toCents(normalizeAmountInput(amount || "0"));
    } catch {
      return 0;
    }
  })();
  const splitSum = watch("splits").reduce((s, x) => {
    try {
      return s + toCents(normalizeAmountInput(x.amount || "0"));
    } catch {
      return s;
    }
  }, 0);

  const submit = (mode: "save" | "again") =>
    handleSubmit(async (values) => {
      setBusy(mode);
      const payload = { ...values, toAccountId: values.type === "transfer" ? values.toAccountId : null };
      const r = editing ? await updateTransactionAction(editing.id, payload) : await createTransactionAction(payload);
      setBusy(null);
      if (!r.ok) {
        toast.error(r.error);
        if (r.field && r.field in values) form.setError(r.field as keyof TxFormValues, { message: r.error });
        return;
      }
      toast.success(editing ? "Transaction updated" : "Transaction added");
      if (mode === "again") {
        form.reset({ ...initial, type: values.type, accountId: values.accountId, currency: values.currency, date: values.date });
        setSuggestion(null);
        setTimeout(() => amountRef.current?.focus(), 30);
      } else onDone();
    });

  const remove = async () => {
    if (!editing) return;
    const ok = await confirm({
      title: `Delete “${editing.merchant || "transaction"}”?`,
      description: "Balances, budgets and reports will be recalculated. This can't be undone.",
      confirmLabel: "Delete transaction",
      destructive: true,
    });
    if (!ok) return;
    setBusy("delete");
    const r = await deleteTransactionsAction([editing.id]);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success("Transaction deleted");
    onDone();
  };

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,$/, "");
    if (!t) return;
    if (!tagList.some((x) => x.toLowerCase() === t.toLowerCase())) setValue("tags", [...tagList, t].slice(0, 12));
    setTagDraft("");
  };

  if (!accounts.length) {
    return <p className="text-sm text-muted-foreground">Add an account first, so the transaction has somewhere to go.</p>;
  }

  const accountOptions = active.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}`, group: a.cls === "asset" ? "Assets" : "Liabilities" }));
  const suggestedCat = suggestion && categories.find((c) => c.id === suggestion.categoryId);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit("save")();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit("save")();
        }
      }}
      className="space-y-4"
    >
      {editing?.type === "adjustment" ? null : (
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Transaction type">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={type === t.value}
              onClick={() => setValue("type", t.value)}
              className={cn(
                "rounded-md py-1.5 text-[13px] font-medium transition-all focus-ring",
                type === t.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="Amount" error={errors.amount?.message} htmlFor="tx-amount">
          <Input
            id="tx-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className="h-11 text-lg font-semibold num"
            invalid={!!errors.amount}
            {...register("amount")}
            ref={(el) => {
              register("amount").ref(el);
              amountRef.current = el;
            }}
          />
        </Field>
        <Field label="Currency">
          <Controller
            control={control}
            name="currency"
            render={({ field }) => (
              <Select
                aria-label="Currency"
                className="h-11"
                value={field.value}
                onValueChange={(v) => {
                  currencyTouched.current = true;
                  field.onChange(v);
                }}
                options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              />
            )}
          />
        </Field>
      </div>

      {type === "transfer" ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <Field label="From" error={errors.accountId?.message}>
            <Controller control={control} name="accountId" render={({ field }) => <Select aria-label="From account" value={field.value} onValueChange={field.onChange} options={accountOptions} />} />
          </Field>
          <ArrowRight className="mb-2.5 h-4 w-4 text-muted-foreground" />
          <Field label="To" error={errors.toAccountId?.message}>
            <Controller
              control={control}
              name="toAccountId"
              render={({ field }) => (
                <Select aria-label="To account" placeholder="Choose account" value={field.value ?? undefined} onValueChange={field.onChange} options={accountOptions.filter((o) => o.value !== accountId)} invalid={!!errors.toAccountId} />
              )}
            />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label={type === "income" ? "Payer / description" : "Merchant / description"} error={errors.merchant?.message} htmlFor="tx-merchant">
            <Input id="tx-merchant" autoComplete="off" placeholder={type === "income" ? "e.g. Employer" : "e.g. Marjane"} invalid={!!errors.merchant} {...register("merchant")} />
          </Field>
          <Field label="Account" error={errors.accountId?.message}>
            <Controller control={control} name="accountId" render={({ field }) => <Select aria-label="Account" value={field.value} onValueChange={field.onChange} options={accountOptions} />} />
          </Field>
        </div>
      )}

      {type === "transfer" && account && toAccount && toAccount.currency !== account.currency && (
        <Field label={`Amount received in ${toAccount.currency}`} hint="Leave blank to use your stored exchange rate." error={errors.toAmount?.message}>
          <Input inputMode="decimal" placeholder="0.00" {...register("toAmount")} />
        </Field>
      )}
      {account && currency !== account.currency && (
        <Field label={`Exchange rate (1 ${currency} = ? ${account.currency})`} hint="Leave blank to use the stored rate for this date." error={errors.fxRate?.message}>
          <Input inputMode="decimal" placeholder="e.g. 10.85" {...register("fxRate")} />
        </Field>
      )}

      <div className={cn("grid gap-3", type === "transfer" ? "grid-cols-2" : "grid-cols-[1fr_160px]")}>
        {type === "transfer" ? (
          <Field label="Note (optional)">
            <Input placeholder="e.g. Card payment" {...register("merchant")} />
          </Field>
        ) : (
          <Field label="Category" error={errors.categoryId?.message}>
            {splitting ? (
              <div className="flex h-9 items-center rounded-lg border border-dashed px-3 text-sm text-muted-foreground">Split across {splits.fields.length} categories</div>
            ) : (
              <Controller
                control={control}
                name="categoryId"
                render={({ field }) => (
                  <Select
                    aria-label="Category"
                    placeholder="Uncategorized"
                    value={field.value ?? NONE}
                    onValueChange={(v) => {
                      field.onChange(v === NONE ? null : v);
                      setValue("categorySource", v === NONE ? "none" : "manual");
                    }}
                    options={[
                      { value: NONE, label: <span className="text-muted-foreground">Uncategorized</span> },
                      ...catOptions.map((c) => ({
                        value: c.id,
                        label: (
                          <span className="flex items-center gap-2">
                            <CategoryIcon icon={c.icon} color={c.color} size="sm" className="h-5 w-5" />
                            {c.name}
                          </span>
                        ),
                      })),
                    ]}
                  />
                )}
              />
            )}
          </Field>
        )}
        <Field label="Date" error={errors.date?.message} htmlFor="tx-date">
          <Input id="tx-date" type="date" {...register("date")} />
        </Field>
      </div>

      {suggestedCat && type !== "transfer" && !splitting && (
        <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-brand" />
          {categoryId === suggestedCat.id ? "Suggested" : "Suggestion"}: <span className="font-medium text-foreground">{suggestedCat.name}</span> · {suggestion!.reason}
          {categoryId !== suggestedCat.id && (
            <button
              type="button"
              className="ml-1 text-brand hover:underline"
              onClick={() => {
                setValue("categoryId", suggestedCat.id);
                setValue("categorySource", "suggestion");
              }}
            >
              Use it
            </button>
          )}
        </p>
      )}

      {type === "transfer" && (
        <p className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {COPY.transferNote} Paying a credit card is a transfer to the card account.
        </p>
      )}

      <button type="button" onClick={() => setMore((m) => !m)} className="flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className={cn("h-4 w-4 transition-transform", more && "rotate-180")} /> {more ? "Fewer options" : "Notes, tags, split & status"}
      </button>

      {more && (
        <div className="space-y-4 rounded-xl border bg-muted/30 p-4 animate-fade-up">
          <Field label="Notes">
            <Textarea rows={2} placeholder="Anything worth remembering" {...register("notes")} />
          </Field>
          <Field label="Tags" hint="Press Enter or comma to add.">
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2 py-1.5 shadow-sm">
              {tagList.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
                  #{t}
                  <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setValue("tags", tagList.filter((x) => x !== t))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                list="tag-options"
                value={tagDraft}
                onChange={(e) => (e.target.value.endsWith(",") ? addTag(e.target.value) : setTagDraft(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(tagDraft);
                  } else if (e.key === "Backspace" && !tagDraft && tagList.length) setValue("tags", tagList.slice(0, -1));
                }}
                onBlur={() => addTag(tagDraft)}
                className="min-w-[100px] flex-1 bg-transparent text-sm outline-none"
                placeholder={tagList.length ? "" : "e.g. vacation"}
                aria-label="Add tag"
              />
              <datalist id="tag-options">
                {tags.map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
            </div>
          </Field>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-sm">
              <Controller control={control} name="status" render={({ field }) => <Switch checked={field.value === "pending"} onCheckedChange={(c) => field.onChange(c ? "pending" : "posted")} />} />
              Pending
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Controller control={control} name="isReviewed" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} />} />
              Mark as reviewed
            </label>
          </div>
          {type !== "transfer" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Split across categories</Label>
                {!splitting ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const half = Math.floor(totalCents / 2);
                      splits.replace([
                        { categoryId: categoryId, amount: totalCents ? centsToDecimal(totalCents - half) : "", notes: null },
                        { categoryId: null, amount: totalCents ? centsToDecimal(half) : "", notes: null },
                      ]);
                      setValue("categoryId", null);
                    }}
                  >
                    Split transaction
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => splits.replace([])}>
                    Remove split
                  </Button>
                )}
              </div>
              {splitting && (
                <div className="space-y-2">
                  {splits.fields.map((f, i) => (
                    <div key={f.id} className="grid grid-cols-[1fr_120px_32px] gap-2">
                      <Controller
                        control={control}
                        name={`splits.${i}.categoryId`}
                        render={({ field }) => (
                          <Select size="sm" aria-label={`Split ${i + 1} category`} placeholder="Category" value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)} options={[{ value: NONE, label: "Uncategorized" }, ...catOptions.map((c) => ({ value: c.id, label: c.name }))]} />
                        )}
                      />
                      <Input className="h-8 num" inputMode="decimal" placeholder="0.00" aria-label={`Split ${i + 1} amount`} {...register(`splits.${i}.amount`)} />
                      <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove split part" onClick={() => splits.remove(i)} disabled={splits.fields.length <= 2}>
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-xs">
                    <Button type="button" size="sm" variant="ghost" onClick={() => splits.append({ categoryId: null, amount: "", notes: null })}>
                      <Plus /> Add part
                    </Button>
                    <span className={cn("num", splitSum === totalCents ? "text-positive" : "text-warning")}>
                      {splitSum === totalCents ? "Splits add up" : `${centsToDecimal(Math.abs(totalCents - splitSum))} ${totalCents - splitSum > 0 ? "left to assign" : "over"}`}
                    </span>
                  </div>
                  {errors.splits?.message && <p className="text-xs text-negative">{errors.splits.message}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="-mx-6 -mb-5 mt-2 flex items-center justify-between gap-2 border-t bg-muted/40 px-6 py-3">
        <div>
          {editing ? (
            <Button type="button" variant="ghost" className="text-negative hover:text-negative" onClick={remove} loading={busy === "delete"}>
              <Trash2 /> Delete
            </Button>
          ) : (
            <span className="hidden text-xs text-muted-foreground sm:inline">⌘/Ctrl + Enter to save</span>
          )}
        </div>
        <div className="flex gap-2">
          {!editing && (
            <Button type="button" variant="outline" onClick={submit("again")} loading={busy === "again"}>
              Save & add another
            </Button>
          )}
          <Button type="submit" loading={busy === "save"}>
            {editing ? "Save changes" : "Add transaction"}
          </Button>
        </div>
      </div>
    </form>
  );
}
