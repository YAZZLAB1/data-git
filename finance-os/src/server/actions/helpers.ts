import "server-only";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { withUser, type Tx } from "@/server/db";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
import { UserError, type ActionResult } from "@/server/services/errors";
import { todayInZone } from "@/lib/period";

export function errorResult(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof UserError) return { ok: false, error: e.message, field: e.field };
  if (e instanceof ZodError) {
    const issue = e.issues[0];
    return { ok: false, error: issue?.message ?? "Check the highlighted fields.", field: issue?.path?.join(".") };
  }
  console.error("[action]", e);
  return { ok: false, error: "Something went wrong and nothing was saved. Please try again." };
}

/**
 * Wraps a mutation: requires a session, runs inside a user-scoped (RLS)
 * transaction, maps errors to user-safe messages and refreshes every page so a
 * change flows into all views.
 */
export async function run<T>(
  fn: (ctx: { user: SessionUser; tx: Tx; today: string }) => Promise<T>,
  opts: { revalidate?: boolean; message?: string } = {},
): Promise<ActionResult<T>> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "Your session has ended. Sign in again to continue." };
    const today = todayInZone(user.timezone);
    const data = await withUser(user.id, (tx) => fn({ user, tx, today }));
    if (opts.revalidate !== false) revalidatePath("/", "layout");
    return { ok: true, data, message: opts.message };
  } catch (e) {
    return errorResult(e);
  }
}
