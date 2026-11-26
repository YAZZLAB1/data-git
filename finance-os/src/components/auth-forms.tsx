"use client";
import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { loginAction, registerAction } from "@/server/actions/auth";
import { loginSchema, registerSchema } from "@/lib/validation";
import { CURRENCIES, CURRENCY_LABELS } from "@/lib/finance/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function LoginForm({ notice }: { notice?: string }) {
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.input<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const r = await loginAction(v);
    if (r && !r.ok) setError(r.error);
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to your Finance OS workspace.</p>
      </div>
      {notice && <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-negative-soft px-3 py-2 text-sm text-negative">{error}</p>}
      <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" autoFocus {...form.register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
      </Field>
      <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
        Sign in
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/register" className="font-medium text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.input<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", email: "", password: "", baseCurrency: "MAD" },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const r = await registerAction({ ...v, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (r && !r.ok) {
      setError(r.error);
      if (r.field) form.setError(r.field as "email", { message: r.error });
    }
  });
  const e = form.formState.errors;
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">Takes a minute. You can start empty or explore with sample data.</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-negative-soft px-3 py-2 text-sm text-negative">{error}</p>}
      <Field label="Name" htmlFor="fullName" error={e.fullName?.message}>
        <Input id="fullName" autoComplete="name" autoFocus {...form.register("fullName")} />
      </Field>
      <Field label="Email" htmlFor="email" error={e.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={e.password?.message} hint="At least 10 characters, with letters and numbers.">
        <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      <Field label="Base currency" hint="Used for net worth and reports. Each account keeps its own currency.">
        <Select
          aria-label="Base currency"
          value={form.watch("baseCurrency") ?? "MAD"}
          onValueChange={(v) => form.setValue("baseCurrency", v as "MAD")}
          options={CURRENCIES.map((c) => ({ value: c, label: `${c} — ${CURRENCY_LABELS[c]}` }))}
        />
      </Field>
      <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
        Create account
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
