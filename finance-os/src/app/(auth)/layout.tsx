import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { Logo } from "@/components/layout/logo";

export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">{children}</div>
        <p className="text-xs text-muted-foreground">Your data stays in your database. No bank credentials are ever stored.</p>
      </div>
      <div className="relative hidden overflow-hidden border-l bg-sidebar lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--brand)/0.10),transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-center px-16">
          <p className="text-sm font-medium text-brand">Personal finance command center</p>
          <h2 className="mt-3 max-w-md text-3xl font-semibold leading-tight tracking-tight">See where every dirham goes — and where it should go next.</h2>
          <ul className="mt-8 space-y-3 text-sm text-muted-foreground">
            {[
              "Net worth, cash flow and savings rate at a glance",
              "Budgets that update the moment you record a transaction",
              "Recurring payments, goals and multi-currency accounts",
              "Insights calculated from your own data — never invented",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
