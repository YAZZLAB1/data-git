"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { withSystem } from "@/server/db";
import { createSession, destroySession } from "@/server/auth/session";
import { rateLimit, resetRateLimit } from "@/server/auth/rate-limit";
import { authenticate, registerUser } from "@/server/services/users";
import { loginSchema, registerSchema } from "@/lib/validation";
import type { ActionResult } from "@/server/services/errors";
import { errorResult } from "./helpers";

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

export async function registerAction(input: unknown): Promise<ActionResult> {
  try {
    const d = registerSchema.parse(input);
    const ip = await clientIp();
    const rl = rateLimit(`register:${ip}`, 10, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: `Too many sign-up attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.` };
    const id = await withSystem((tx) => registerUser(tx, d));
    await createSession(id);
  } catch (e) {
    return errorResult(e);
  }
  redirect("/");
}

export async function loginAction(input: unknown): Promise<ActionResult> {
  try {
    const d = loginSchema.parse(input);
    const ip = await clientIp();
    const key = `login:${ip}:${d.email}`;
    const rl = rateLimit(key, 8, 15 * 60_000);
    if (!rl.ok) return { ok: false, error: `Too many sign-in attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.` };
    const id = await withSystem((tx) => authenticate(tx, d.email, d.password));
    if (!id) return { ok: false, error: "That email and password don't match. Check them and try again." };
    resetRateLimit(key);
    await createSession(id);
  } catch (e) {
    return errorResult(e);
  }
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
