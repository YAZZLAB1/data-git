import type { Queryable } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { seedDefaultCategories } from "./categories";
import { audit } from "./audit";
import { UserError } from "./errors";

/** Runs with system privileges (no user context yet). */
export async function registerUser(
  tx: Queryable,
  d: { fullName: string; email: string; password: string; baseCurrency: string; timezone?: string },
): Promise<string> {
  const email = d.email.trim().toLowerCase();
  const existing = await tx.query("SELECT 1 FROM users WHERE email=$1", [email]);
  if (existing.length) throw new UserError("An account with this email already exists. Sign in instead.", "email");
  const hash = await hashPassword(d.password);
  const [u] = await tx.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id", [email, hash]);
  let tz = "UTC";
  try {
    if (d.timezone) {
      new Intl.DateTimeFormat("en", { timeZone: d.timezone });
      tz = d.timezone;
    }
  } catch {
    tz = "UTC";
  }
  await tx.query("INSERT INTO profiles (user_id, full_name, base_currency, timezone) VALUES ($1,$2,$3,$4)", [u.id, d.fullName, d.baseCurrency, tz]);
  await seedDefaultCategories(tx, u.id);
  await audit(tx, u.id, "register", "user", u.id, {});
  return u.id;
}

export async function authenticate(tx: Queryable, email: string, password: string): Promise<string | null> {
  const [u] = await tx.query<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email=$1", [email.trim().toLowerCase()]);
  if (!u) {
    // Spend comparable time to avoid revealing which emails exist.
    await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==");
    return null;
  }
  return (await verifyPassword(password, u.password_hash)) ? u.id : null;
}

export async function changePassword(tx: Queryable, userId: string, current: string, next: string, keepSessionId: string) {
  const [u] = await tx.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=$1", [userId]);
  if (!u || !(await verifyPassword(current, u.password_hash))) throw new UserError("Your current password is incorrect.", "currentPassword");
  await tx.query("UPDATE users SET password_hash=$1 WHERE id=$2", [await hashPassword(next), userId]);
  // Sign out every other session after a password change.
  await tx.query("DELETE FROM sessions WHERE user_id=$1 AND id<>$2", [userId, keepSessionId]);
  await audit(tx, userId, "password_change", "user", userId);
}

export async function deleteUser(tx: Queryable, userId: string, password: string) {
  const [u] = await tx.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=$1", [userId]);
  if (!u || !(await verifyPassword(password, u.password_hash))) throw new UserError("Your password is incorrect.", "password");
  // ON DELETE CASCADE removes every row owned by the user. Transactions reference
  // accounts with RESTRICT, so remove transactions first.
  await tx.query("DELETE FROM goal_contributions WHERE user_id=$1", [userId]);
  await tx.query("DELETE FROM transactions WHERE user_id=$1", [userId]);
  await tx.query("DELETE FROM users WHERE id=$1", [userId]);
}

export async function listSessions(tx: Queryable, userId: string) {
  return tx.query<{ id: string; user_agent: string | null; ip: string | null; created_at: string; last_seen_at: string }>(
    "SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id=$1 AND expires_at > now() ORDER BY last_seen_at DESC",
    [userId],
  );
}

export async function revokeSession(tx: Queryable, userId: string, sessionId: string) {
  await tx.query("DELETE FROM sessions WHERE id=$1 AND user_id=$2", [sessionId, userId]);
}
