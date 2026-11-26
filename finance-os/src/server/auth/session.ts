import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { withSystem } from "@/server/db";
import { hashToken, newSessionToken } from "./password";

export const SESSION_COOKIE = "fos_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  sessionId: string;
  fullName: string;
  avatarData: string | null;
  baseCurrency: string;
  dateFormat: string;
  numberLocale: string;
  theme: "light" | "dark" | "system";
  timezone: string;
  budgetRolloverDefault: boolean;
  emergencyFundMonths: number;
}

function cookieSecure() {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === "true";
  return process.env.NODE_ENV === "production";
}

export async function createSession(userId: string) {
  const token = newSessionToken();
  const h = await headers();
  const ua = h.get("user-agent")?.slice(0, 300) ?? null;
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim().slice(0, 64) || null;
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await withSystem((tx) =>
    tx.query("INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at) VALUES ($1,$2,$3,$4,$5)", [
      userId,
      hashToken(token),
      ua,
      ip,
      expires.toISOString(),
    ]),
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: cookieSecure(), path: "/", expires });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await withSystem((tx) => tx.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]));
  jar.delete(SESSION_COOKIE);
}

type Row = {
  id: string;
  email: string;
  session_id: string;
  last_seen_at: string;
  full_name: string | null;
  avatar_data: string | null;
  base_currency: string | null;
  date_format: string | null;
  number_locale: string | null;
  theme: "light" | "dark" | "system" | null;
  timezone: string | null;
  budget_rollover_default: boolean | null;
  emergency_fund_months: number | null;
};

/** Current signed-in user, or null. Memoized per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await withSystem((tx) =>
    tx.query<Row>(
      `SELECT u.id, u.email, s.id AS session_id, s.last_seen_at, p.full_name, p.avatar_data, p.base_currency,
              p.date_format, p.number_locale, p.theme, p.timezone, p.budget_rollover_default, p.emergency_fund_months
         FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN profiles p ON p.user_id = u.id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    ),
  );
  const r = rows[0];
  if (!r) return null;
  if (Date.now() - new Date(r.last_seen_at).getTime() > 3600_000) {
    await withSystem((tx) => tx.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [r.session_id]));
  }
  return {
    id: r.id,
    email: r.email,
    sessionId: r.session_id,
    fullName: r.full_name ?? "",
    avatarData: r.avatar_data,
    baseCurrency: r.base_currency ?? "MAD",
    dateFormat: r.date_format ?? "dd MMM yyyy",
    numberLocale: r.number_locale ?? "en-US",
    theme: r.theme ?? "system",
    timezone: r.timezone ?? "UTC",
    budgetRolloverDefault: r.budget_rollover_default ?? false,
    emergencyFundMonths: r.emergency_fund_months ?? 6,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}
