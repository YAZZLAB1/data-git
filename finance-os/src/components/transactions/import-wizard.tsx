"use client";
import * as React from "react";
import Link from "next/link";
import Papa from "papaparse";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Copy, FileSpreadsheet, History, Undo2, UploadCloud, XCircle } from "lucide-react";
import { commitImportAction, previewImportAction, undoImportAction } from "@/server/actions/data";
import type { PreviewRow, RawImportRow } from "@/server/services/imports";
import { IMPORT_DATE_FORMATS, detectDateFormat, detectDecimal, type ImportDateFormat } from "@/lib/import-parse";
import { useQuickAdd } from "@/components/layout/quick-add";
import { useConfirm } from "@/components/ui/confirm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { Select, NONE } from "@/components/ui/select";
import { Badge, Checkbox, EmptyState } from "@/components/ui/misc";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/misc";
import { useFmt } from "@/components/common/prefs";
import { cn } from "@/lib/utils";

type Mapping = { date: string; amount: string; debit: string; credit: string; merchant: string; description: string; category: string; notes: string };
type HistoryRow = { id: string; filename: string; account_name: string | null; total_rows: number; imported_rows: number; duplicate_rows: number; error_rows: number; skipped_rows: number; errors: { row: number; errors: string[] }[]; created_at: string };

const STEPS = ["Upload", "Map columns", "Review", "Done"];
const MAX_BYTES = 5 * 1024 * 1024;

function guess(headers: string[], patterns: RegExp[]) {
  return headers.find((h) => patterns.some((p) => p.test(h.toLowerCase().trim()))) ?? NONE;
}

export function ImportWizard({ history }: { history: HistoryRow[] }) {
  const f = useFmt();
  const quick = useQuickAdd();
  const confirm = useConfirm();
  const [step, setStep] = React.useState(0);
  const [file, setFile] = React.useState<{ name: string; headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [accountId, setAccountId] = React.useState(quick.accounts.find((a) => !a.isArchived)?.id ?? "");
  const [map, setMap] = React.useState<Mapping>({ date: NONE, amount: NONE, debit: NONE, credit: NONE, merchant: NONE, description: NONE, category: NONE, notes: NONE });
  const [amountMode, setAmountMode] = React.useState<"signed" | "debit_credit">("signed");
  const [negativeIs, setNegativeIs] = React.useState<"expense" | "income">("expense");
  const [dateFormat, setDateFormat] = React.useState<ImportDateFormat>("yyyy-MM-dd");
  const [decimal, setDecimal] = React.useState<"." | ",">(".");
  const [preview, setPreview] = React.useState<PreviewRow[] | null>(null);
  const [include, setInclude] = React.useState<Set<number>>(new Set());
  const [tab, setTab] = React.useState("all");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ importId: string; imported: number; duplicates: number; skippedDuplicates: number; invalid: number; errors: { row: number; errors: string[] }[] } | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const onFile = (fileObj: File) => {
    if (fileObj.size > MAX_BYTES) return toast.error("This file is larger than 5 MB. Split it into smaller files and import them one at a time.");
    Papa.parse<Record<string, string>>(fileObj, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const headers = (res.meta.fields ?? []).filter(Boolean);
        if (!headers.length || !res.data.length) return toast.error("Couldn't find a header row and data in this file. Check it's a CSV with column names in the first row.");
        const m: Mapping = {
          date: guess(headers, [/^date/, /date$/, /^booking/, /^posted/, /^transaction date/, /^valeur/]),
          amount: guess(headers, [/^amount/, /montant/, /^value$/, /^sum/]),
          debit: guess(headers, [/debit/, /withdraw/, /out/]),
          credit: guess(headers, [/credit/, /deposit/, /^in$/]),
          merchant: guess(headers, [/merchant/, /payee/, /^name/, /libell/, /counterparty/, /^description/]),
          description: guess(headers, [/memo/, /details/, /reference/, /^description/]),
          category: guess(headers, [/categor/]),
          notes: guess(headers, [/^note/, /comment/]),
        };
        if (m.description === m.merchant) m.description = NONE;
        setMap(m);
        setAmountMode(m.amount === NONE && m.debit !== NONE ? "debit_credit" : "signed");
        const dateSamples = res.data.map((r) => r[m.date] ?? "");
        setDateFormat(detectDateFormat(dateSamples) ?? "yyyy-MM-dd");
        setDecimal(detectDecimal(res.data.map((r) => r[m.amount !== NONE ? m.amount : m.debit] ?? "")));
        setFile({ name: fileObj.name, headers, rows: res.data });
        setPreview(null);
        setResult(null);
        setStep(1);
      },
      error: () => toast.error("Couldn't read this file. Make sure it's a CSV export."),
    });
  };

  const rawRows = (): RawImportRow[] =>
    (file?.rows ?? []).map((r) => {
      const v = (k: string) => (k !== NONE ? String(r[k] ?? "") : undefined);
      return {
        date: v(map.date) ?? "",
        amount: amountMode === "signed" ? v(map.amount) : undefined,
        debit: amountMode === "debit_credit" ? v(map.debit) : undefined,
        credit: amountMode === "debit_credit" ? v(map.credit) : undefined,
        merchant: v(map.merchant) ?? "",
        description: v(map.description),
        category: v(map.category),
        notes: v(map.notes),
      };
    });
  const options = () => ({ accountId, dateFormat, decimal, amountMode, negativeIs });

  const mappingError =
    !accountId ? "Choose the account these transactions belong to." : map.date === NONE ? "Map the date column." : amountMode === "signed" && map.amount === NONE ? "Map the amount column." : amountMode === "debit_credit" && map.debit === NONE && map.credit === NONE ? "Map the debit and/or credit columns." : map.merchant === NONE && map.description === NONE ? "Map a merchant or description column." : null;

  const validate = async () => {
    setBusy(true);
    const r = await previewImportAction(rawRows(), options());
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setPreview(r.data);
    setInclude(new Set());
    setTab("all");
    setStep(2);
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true);
    const r = await commitImportAction(file.name, rawRows(), options(), [...include]);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setResult(r.data);
    setStep(3);
    toast.success(`${r.data.imported} transactions imported`);
  };

  const counts = preview ? { valid: preview.filter((p) => p.status === "valid").length, duplicate: preview.filter((p) => p.status === "duplicate").length, invalid: preview.filter((p) => p.status === "invalid").length } : null;
  const shown = preview?.filter((p) => tab === "all" || p.status === tab) ?? [];
  const toImport = counts ? counts.valid + include.size : 0;
  const columnOptions = [{ value: NONE, label: <span className="text-muted-foreground">Not in file</span> }, ...(file?.headers ?? []).map((h) => ({ value: h, label: h }))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/transactions">
            <ArrowLeft /> Transactions
          </Link>
        </Button>
        <ol className="flex items-center gap-2 text-[13px]" aria-label="Import steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", i < step ? "bg-brand text-brand-foreground" : i === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")} aria-current={i === step ? "step" : undefined}>
                {i < step ? "✓" : i + 1}
              </span>
              <span className={cn("hidden sm:inline", i === step ? "font-medium" : "text-muted-foreground")}>{s}</span>
              {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" />}
            </li>
          ))}
        </ol>
      </div>

      {step === 0 && (
        <Card>
          <CardContent className="p-6">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const fl = e.dataTransfer.files[0];
                if (fl) onFile(fl);
              }}
              className={cn("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors", dragging ? "border-brand bg-brand-soft" : "hover:bg-accent/50")}
            >
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Drop a bank statement CSV here, or click to choose a file</p>
              <p className="mt-1 text-xs text-muted-foreground">Up to 5 MB and 5,000 rows. The first row must contain column names.</p>
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <div className="mt-5 grid gap-3 text-[13px] text-muted-foreground sm:grid-cols-3">
              <p><span className="font-medium text-foreground">Any date format.</span> We detect it, and you can change it.</p>
              <p><span className="font-medium text-foreground">Comma or dot decimals.</span> “1.234,50” and “1,234.50” both work.</p>
              <p><span className="font-medium text-foreground">Nothing imports silently.</span> You review invalid rows and likely duplicates first.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && file && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" /> {file.name}
              </CardTitle>
              <CardDescription>{file.rows.length.toLocaleString()} rows found. Tell us what each column means.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Import into account">
                <Select aria-label="Account" value={accountId || undefined} placeholder="Choose account" onValueChange={setAccountId} options={quick.accounts.filter((a) => !a.isArchived).map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))} />
              </Field>
              <Field label="Date column">
                <Select aria-label="Date column" value={map.date} onValueChange={(v) => setMap({ ...map, date: v })} options={columnOptions} />
              </Field>
              <Field label="Date format">
                <Select aria-label="Date format" value={dateFormat} onValueChange={(v) => setDateFormat(v as ImportDateFormat)} options={Object.entries(IMPORT_DATE_FORMATS).map(([k, ex]) => ({ value: k, label: `${k}  (${ex})` }))} />
              </Field>
              <Field label="Decimal separator">
                <Select aria-label="Decimal separator" value={decimal} onValueChange={(v) => setDecimal(v as "." | ",")} options={[{ value: ".", label: "Dot  (1,234.50)" }, { value: ",", label: "Comma  (1.234,50)" }]} />
              </Field>
              <Field label="Amounts are in">
                <Select aria-label="Amount layout" value={amountMode} onValueChange={(v) => setAmountMode(v as "signed")} options={[{ value: "signed", label: "One signed column" }, { value: "debit_credit", label: "Separate debit & credit" }]} />
              </Field>
              {amountMode === "signed" ? (
                <>
                  <Field label="Amount column">
                    <Select aria-label="Amount column" value={map.amount} onValueChange={(v) => setMap({ ...map, amount: v })} options={columnOptions} />
                  </Field>
                  <Field label="Negative amounts are">
                    <Select aria-label="Sign convention" value={negativeIs} onValueChange={(v) => setNegativeIs(v as "expense")} options={[{ value: "expense", label: "Expenses (most banks)" }, { value: "income", label: "Income (credit card exports)" }]} />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Debit (money out)">
                    <Select aria-label="Debit column" value={map.debit} onValueChange={(v) => setMap({ ...map, debit: v })} options={columnOptions} />
                  </Field>
                  <Field label="Credit (money in)">
                    <Select aria-label="Credit column" value={map.credit} onValueChange={(v) => setMap({ ...map, credit: v })} options={columnOptions} />
                  </Field>
                </>
              )}
              <Field label="Merchant / payee">
                <Select aria-label="Merchant column" value={map.merchant} onValueChange={(v) => setMap({ ...map, merchant: v })} options={columnOptions} />
              </Field>
              <Field label="Description (optional)">
                <Select aria-label="Description column" value={map.description} onValueChange={(v) => setMap({ ...map, description: v })} options={columnOptions} />
              </Field>
              <Field label="Category (optional)" hint="Matched by name; otherwise rules and history suggest one.">
                <Select aria-label="Category column" value={map.category} onValueChange={(v) => setMap({ ...map, category: v })} options={columnOptions} />
              </Field>
              <Field label="Notes (optional)">
                <Select aria-label="Notes column" value={map.notes} onValueChange={(v) => setMap({ ...map, notes: v })} options={columnOptions} />
              </Field>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">File preview</p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted text-left">
                    <tr>{file.headers.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {file.rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>{file.headers.map((h) => <td key={h} className="max-w-[220px] truncate whitespace-nowrap px-3 py-1.5">{r[h]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="ghost" onClick={() => setStep(0)}>
                <ArrowLeft /> Choose another file
              </Button>
              <div className="flex items-center gap-3">
                {mappingError && <span className="text-xs text-warning">{mappingError}</span>}
                <Button onClick={validate} loading={busy} disabled={!!mappingError}>
                  Check {file.rows.length.toLocaleString()} rows <ArrowRight />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && preview && counts && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Review before importing</CardTitle>
              <CardDescription>Invalid rows are never imported. Likely duplicates are skipped unless you tick them.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat icon={<CheckCircle2 className="text-positive" />} label="Ready to import" value={counts.valid} />
              <Stat icon={<Copy className="text-warning" />} label="Likely duplicates" value={counts.duplicate} />
              <Stat icon={<XCircle className="text-negative" />} label="Invalid rows" value={counts.invalid} />
            </div>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="all">All ({preview.length})</TabsTrigger>
                <TabsTrigger value="valid">Valid ({counts.valid})</TabsTrigger>
                <TabsTrigger value="duplicate">Duplicates ({counts.duplicate})</TabsTrigger>
                <TabsTrigger value="invalid">Invalid ({counts.invalid})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="max-h-[420px] overflow-auto rounded-lg border">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Merchant</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.slice(0, 500).map((p) => (
                    <tr key={p.index} className={cn(p.status === "invalid" && "bg-negative-soft/40")}>
                      <td className="px-3 py-1.5 text-muted-foreground num">{p.index + 2}</td>
                      <td className="px-3 py-1.5">
                        {p.status === "valid" && <Badge tone="positive">Valid</Badge>}
                        {p.status === "duplicate" && (
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={include.has(p.index)}
                              onCheckedChange={(c) =>
                                setInclude((s) => {
                                  const n = new Set(s);
                                  if (c === true) n.add(p.index);
                                  else n.delete(p.index);
                                  return n;
                                })
                              }
                              aria-label="Import this duplicate anyway"
                            />
                            <Badge tone="warning">Duplicate?</Badge>
                            <span className="text-xs text-muted-foreground">{p.duplicateOf}</span>
                          </label>
                        )}
                        {p.status === "invalid" && <span className="text-xs text-negative">{p.errors.join(" · ")}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 num">{p.date ? f.date(p.date) : "—"}</td>
                      <td className="max-w-[220px] truncate px-3 py-1.5">{p.merchant || "—"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{p.categoryName ? `${p.categoryName}${p.categorySource && p.categorySource !== "import" ? " (suggested)" : ""}` : "—"}</td>
                      <td className={cn("whitespace-nowrap px-3 py-1.5 text-right num", p.type === "income" && "text-positive")}>{p.amount ? `${p.type === "expense" ? "−" : "+"}${p.amount}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 500 && <p className="p-3 text-center text-xs text-muted-foreground">Showing the first 500 rows of {shown.length}.</p>}
            </div>
            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft /> Back to mapping
              </Button>
              <Button onClick={commit} loading={busy} disabled={toImport === 0}>
                Import {toImport.toLocaleString()} transaction{toImport === 1 ? "" : "s"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && result && (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-positive" />
            <h2 className="mt-3 text-lg font-semibold">{result.imported.toLocaleString()} transactions imported</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.skippedDuplicates} likely duplicate{result.skippedDuplicates === 1 ? "" : "s"} skipped · {result.invalid} invalid row{result.invalid === 1 ? "" : "s"} not imported. Balances, budgets and reports are already updated.
            </p>
            {result.errors.length > 0 && (
              <div className="mx-auto mt-4 max-w-lg rounded-lg border bg-muted/40 p-3 text-left text-xs">
                <p className="mb-1 font-medium">Rows not imported</p>
                <ul className="max-h-40 space-y-0.5 overflow-auto text-muted-foreground">
                  {result.errors.map((e) => (
                    <li key={e.row}>Row {e.row}: {e.errors.join(" · ")}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-5 flex justify-center gap-2">
              <Button asChild>
                <Link href="/transactions">View transactions</Link>
              </Button>
              <Button variant="outline" onClick={() => { setStep(0); setFile(null); setPreview(null); }}>
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" /> Import history
            </CardTitle>
            <CardDescription>Every import is recorded. Undo removes the transactions it created.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <EmptyState title="No imports yet" body="Files you import appear here with their results." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3">File</th>
                    <th className="py-2 pr-3">Account</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3 text-right">Rows</th>
                    <th className="py-2 pr-3 text-right">Imported</th>
                    <th className="py-2 pr-3 text-right">Duplicates</th>
                    <th className="py-2 pr-3 text-right">Invalid</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="max-w-[220px] truncate py-2 pr-3 font-medium">{h.filename}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{h.account_name ?? "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{f.date(h.created_at.slice(0, 10))}</td>
                      <td className="py-2 pr-3 text-right num">{h.total_rows}</td>
                      <td className="py-2 pr-3 text-right num">{h.imported_rows}</td>
                      <td className="py-2 pr-3 text-right num">{h.duplicate_rows}</td>
                      <td className="py-2 pr-3 text-right num">
                        {h.error_rows > 0 ? (
                          <span className="inline-flex items-center gap-1 text-warning" title={h.errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.errors.join(", ")}`).join("\n")}>
                            <AlertTriangle className="h-3 w-3" />
                            {h.error_rows}
                          </span>
                        ) : (
                          0
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {h.imported_rows > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              const ok = await confirm({ title: `Undo import of “${h.filename}”?`, description: `This deletes the ${h.imported_rows} transactions it created. Balances and reports will be recalculated.`, confirmLabel: "Undo import", destructive: true });
                              if (!ok) return;
                              const r = await undoImportAction(h.id);
                              if (r.ok) toast.success(`${r.data} transactions removed`);
                              else toast.error(r.error);
                            }}
                          >
                            <Undo2 /> Undo
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      <span className="[&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <div>
        <p className="text-lg font-semibold num">{value.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
