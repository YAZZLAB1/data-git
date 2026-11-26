"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { changePasswordSchema, preferencesSchema, profileSchema, uuid } from "@/lib/validation";
import { IMPORT_DATE_FORMATS } from "@/lib/import-parse";
import * as imports from "@/server/services/imports";
import * as data from "@/server/services/data";
import * as users from "@/server/services/users";
import * as settings from "@/server/services/settings";
import { loadDemoData } from "@/server/services/demo";
import { withSystem } from "@/server/db";
import { destroySession, getCurrentUser } from "@/server/auth/session";
import { UserError } from "@/server/services/errors";
import { errorResult, run } from "./helpers";

const rowSchema = z.object({
  date: z.string().max(60).default(""),
  amount: z.string().max(60).optional(),
  debit: z.string().max(60).optional(),
  credit: z.string().max(60).optional(),
  merchant: z.string().max(300).default(""),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});
const optsSchema = z.object({
  accountId: uuid,
  dateFormat: z.enum(Object.keys(IMPORT_DATE_FORMATS) as [keyof typeof IMPORT_DATE_FORMATS, ...(keyof typeof IMPORT_DATE_FORMATS)[]]),
  decimal: z.enum([".", ","]),
  amountMode: z.enum(["signed", "debit_credit"]),
  negativeIs: z.enum(["expense", "income"]),
});
const rowsSchema = z.array(rowSchema).max(imports.MAX_IMPORT_ROWS, { message: `Import up to ${imports.MAX_IMPORT_ROWS} rows at a time.` });

export async function previewImportAction(rows: unknown, opts: unknown) {
  return run(({ user, tx }) => imports.previewImport(tx, user.id, rowsSchema.parse(rows), optsSchema.parse(opts)), { revalidate: false });
}
export async function commitImportAction(filename: string, rows: unknown, opts: unknown, includeDuplicates: number[]) {
  return run(({ user, tx }) =>
    imports.commitImport(tx, user.id, z.string().max(200).parse(filename), rowsSchema.parse(rows), optsSchema.parse(opts), z.array(z.number().int().min(0)).parse(includeDuplicates)),
  );
}
export async function undoImportAction(id: string) {
  return run(({ user, tx }) => imports.undoImport(tx, user.id, uuid.parse(id)));
}

export async function updateProfileAction(input: unknown) {
  return run(({ user, tx }) => settings.updateProfile(tx, user.id, profileSchema.parse(input)), { message: "Profile saved" });
}
export async function updatePreferencesAction(input: unknown) {
  return run(({ user, tx }) => settings.updatePreferences(tx, user.id, preferencesSchema.parse(input)), { message: "Preferences saved" });
}
export async function changePasswordAction(input: unknown) {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Your session has ended. Sign in again to continue." };
    const d = changePasswordSchema.parse(input);
    await withSystem((tx) => users.changePassword(tx, user.id, d.currentPassword, d.newPassword, user.sessionId));
    return { ok: true as const, data: undefined, message: "Password changed. Other sessions were signed out." };
  } catch (e) {
    return errorResult(e);
  }
}
export async function revokeSessionAction(id: string) {
  return run(({ user, tx }) => users.revokeSession(tx, user.id, uuid.parse(id)), { message: "Session signed out" });
}
export async function revokeOtherSessionsAction() {
  return run(async ({ user, tx }) => {
    await tx.query("DELETE FROM sessions WHERE user_id=$1 AND id<>$2", [user.id, user.sessionId]);
  }, { message: "Other sessions signed out" });
}

export async function deleteFinancialDataAction(confirmation: string) {
  return run(async ({ user, tx }) => {
    if (confirmation !== "DELETE") throw new UserError("Type DELETE to confirm.");
    await data.deleteFinancialData(tx, user.id);
  }, { message: "All financial data deleted" });
}

export async function deleteUserAction(password: string) {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Your session has ended." };
    await withSystem((tx) => users.deleteUser(tx, user.id, z.string().min(1).max(200).parse(password)));
    await destroySession();
  } catch (e) {
    return errorResult(e);
  }
  redirect("/login?deleted=1");
}

export async function restoreBackupAction(json: string) {
  return run(async ({ user, tx }) => {
    if (json.length > 25_000_000) throw new UserError("Backup files can be up to 25 MB.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new UserError("This file isn't valid JSON.");
    }
    return data.restoreBackup(tx, user.id, parsed);
  }, { message: "Backup restored" });
}

export async function loadDemoDataAction() {
  return run(({ user, tx, today }) => loadDemoData(tx, user.id, today), { message: "Sample data loaded" });
}

export async function setThemeAction(theme: string) {
  return run(async ({ user, tx }) => {
    const t = z.enum(["light", "dark", "system"]).parse(theme);
    await tx.query("UPDATE profiles SET theme=$1 WHERE user_id=$2", [t, user.id]);
  }, { revalidate: false });
}
