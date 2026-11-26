"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, FileUp, HardDriveDownload, LogOut, Monitor, ShieldAlert, Upload, Sparkles } from "lucide-react";
import type { AuditRow } from "@/server/services/audit";
import {
  changePasswordAction,
  deleteFinancialDataAction,
  deleteUserAction,
  loadDemoDataAction,
  restoreBackupAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
} from "@/server/actions/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm";
import { useFmt } from "@/components/common/prefs";
import { Section } from "./settings-view";

export function DataTab({ accountCount }: { accountCount: number }) {
  const confirm = useConfirm();
  const [danger, setDanger] = React.useState<"data" | null>(null);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  return (
    <div className="space-y-6">
      <Section title="Export" description="Your data is yours. Exports include every account and currency.">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href="/api/export/transactions" download>
              <Download /> Transactions (CSV)
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/export/accounts" download>
              <Download /> Accounts (CSV)
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/backup" download>
              <HardDriveDownload /> Full backup (JSON)
            </a>
          </Button>
        </div>
      </Section>
      <Section title="Import" description="Bring transactions in from a bank statement, or restore a backup.">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/transactions/import">
              <FileUp /> Import CSV
            </Link>
          </Button>
          <Button asChild variant="outline">
            <label className="cursor-pointer">
              <Upload /> Restore backup…
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const ok = await confirm({
                    title: `Restore “${file.name}”?`,
                    description: "This replaces all your current accounts, transactions, budgets, goals and rules with the backup's contents. Download a backup of your current data first if you might need it.",
                    confirmLabel: "Replace and restore",
                    destructive: true,
                  });
                  if (!ok) return;
                  setBusy("restore");
                  const r = await restoreBackupAction(await file.text());
                  setBusy(null);
                  if (r.ok) toast.success(`Backup restored: ${r.data.transactions ?? 0} transactions, ${r.data.accounts ?? 0} accounts`);
                  else toast.error(r.error);
                }}
              />
            </label>
          </Button>
          {busy === "restore" && <span className="self-center text-sm text-muted-foreground">Restoring…</span>}
        </div>
        {accountCount === 0 && (
          <div className="mt-4 rounded-lg border border-dashed p-4">
            <p className="text-sm font-medium">Explore with sample data</p>
            <p className="mt-1 text-xs text-muted-foreground">A year of clearly labelled example data, including sample exchange rates. Remove it with “Delete all financial data”.</p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              loading={busy === "demo"}
              onClick={async () => {
                setBusy("demo");
                const r = await loadDemoDataAction();
                setBusy(null);
                if (r.ok) toast.success("Sample data loaded");
                else toast.error(r.error);
              }}
            >
              <Sparkles /> Load sample data
            </Button>
          </div>
        )}
      </Section>
      <Section title="Delete financial data" description="Removes every account, transaction, budget, goal, rule, rate and insight. Your login, profile and activity log stay." className="border-negative/30">
        <Button variant="destructive" onClick={() => setDanger("data")}>
          Delete all financial data…
        </Button>
      </Section>
      <Dialog open={danger === "data"} onOpenChange={(o) => { if (!o) { setDanger(null); setTyped(""); } }}>
        <DialogContent title="Delete all financial data?" description="This can't be undone. Download a backup first if you might want it back." size="sm">
          <Field label="Type DELETE to confirm">
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDanger(null)}>
              Keep my data
            </Button>
            <Button
              variant="destructive"
              disabled={typed !== "DELETE"}
              loading={busy === "delete"}
              onClick={async () => {
                setBusy("delete");
                const r = await deleteFinancialDataAction(typed);
                setBusy(null);
                if (!r.ok) return toast.error(r.error);
                toast.success("All financial data deleted");
                setDanger(null);
                setTyped("");
              }}
            >
              Delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SecurityTab({ sessions, currentSessionId }: { sessions: { id: string; user_agent: string | null; ip: string | null; created_at: string; last_seen_at: string }[]; currentSessionId: string }) {
  const f = useFmt();
  const confirm = useConfirm();
  const [pw, setPw] = React.useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [busy, setBusy] = React.useState(false);
  const [delOpen, setDelOpen] = React.useState(false);
  const [delPw, setDelPw] = React.useState("");
  const device = (ua: string | null) => {
    if (!ua) return "Unknown device";
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
    return `${browser}${os ? ` on ${os}` : ""}`;
  };
  return (
    <div className="space-y-6">
      <Section title="Password" description="Changing your password signs out every other session.">
        <form
          className="grid max-w-md gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await changePasswordAction(pw);
            setBusy(false);
            if (!r.ok) return toast.error(r.error);
            toast.success(r.message ?? "Password changed");
            setPw({ currentPassword: "", newPassword: "", confirmPassword: "" });
          }}
        >
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </Field>
          <Field label="New password" hint="At least 10 characters, with letters and numbers.">
            <Input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" autoComplete="new-password" value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} />
          </Field>
          <Button type="submit" className="justify-self-start" loading={busy}>
            Change password
          </Button>
        </form>
      </Section>
      <Section title="Sessions" description="Devices currently signed in to your account.">
        <ul className="divide-y rounded-lg border">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {device(s.user_agent)} {s.id === currentSessionId && <Badge tone="positive">This device</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  Signed in {f.date(s.created_at.slice(0, 10))} · last active {f.date(s.last_seen_at.slice(0, 10))}
                  {s.ip ? ` · ${s.ip}` : ""}
                </p>
              </div>
              {s.id !== currentSessionId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const r = await revokeSessionAction(s.id);
                    if (r.ok) toast.success("Session signed out");
                    else toast.error(r.error);
                  }}
                >
                  <LogOut /> Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
        {sessions.length > 1 && (
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!(await confirm({ title: "Sign out all other sessions?", description: "Every other device will need to sign in again.", confirmLabel: "Sign out others" }))) return;
              const r = await revokeOtherSessionsAction();
              if (r.ok) toast.success("Other sessions signed out");
              else toast.error(r.error);
            }}
          >
            Sign out all other sessions
          </Button>
        )}
      </Section>
      <Section title="Two-factor authentication">
        <p className="text-sm text-muted-foreground">Two-factor authentication isn't available yet. Use a long, unique password and sign out sessions you don't recognise.</p>
      </Section>
      <Section title="Delete account" description="Permanently deletes your login and every piece of financial data." className="border-negative/30">
        <Button variant="destructive" onClick={() => setDelOpen(true)}>
          <ShieldAlert /> Delete my account…
        </Button>
      </Section>
      <Dialog open={delOpen} onOpenChange={(o) => { setDelOpen(o); if (!o) setDelPw(""); }}>
        <DialogContent title="Delete your account?" description="All accounts, transactions, budgets, goals and settings are deleted permanently. This can't be undone." size="sm">
          <Field label="Enter your password to confirm">
            <Input type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} autoFocus />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOpen(false)}>
              Keep my account
            </Button>
            <Button
              variant="destructive"
              disabled={!delPw}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const r = await deleteUserAction(delPw);
                setBusy(false);
                if (r && !r.ok) toast.error(r.error);
              }}
            >
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  archive: "Archived",
  unarchive: "Restored",
  balance_update: "Updated balance of",
  import: "Imported",
  undo_import: "Undid import of",
  contribute: "Contributed to",
  remove_contribution: "Removed a contribution from",
  mark_paid: "Marked paid",
  upsert: "Saved",
  apply: "Applied",
  copy: "Copied",
  bulk_categorize: "Categorized",
  register: "Created account",
  password_change: "Changed password",
  backup: "Downloaded backup",
  restore: "Restored backup",
  delete_all_data: "Deleted all financial data",
  load_sample_data: "Loaded sample data",
  status: "Changed status of",
};

export function ActivityTab({ audit }: { audit: AuditRow[] }) {
  return (
    <Section title="Activity log" description="An audit trail of important changes to your financial data (most recent 80).">
      {audit.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <ul className="divide-y text-sm">
          {audit.map((a) => {
            const d = a.details as Record<string, unknown>;
            const subject = (d.name as string) ?? (d.merchant as string) ?? (d.filename as string) ?? "";
            return (
              <li key={a.id} className="flex items-baseline gap-3 py-2">
                <span className="w-36 shrink-0 text-xs text-muted-foreground num">{new Date(a.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                <span className="min-w-0 flex-1 truncate">
                  {ACTION_LABEL[a.action] ?? a.action} <span className="text-muted-foreground">{a.entity.replace(/_/g, " ")}</span>
                  {subject ? <span className="font-medium"> “{subject}”</span> : null}
                  {d.amount ? <span className="text-muted-foreground num"> · {String(d.amount)}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
