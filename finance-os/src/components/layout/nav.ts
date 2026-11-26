import { ArrowLeftRight, ChartColumn, Landmark, LayoutDashboard, Lightbulb, PiggyBank, Repeat, Settings, Target } from "lucide-react";

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/budgets", label: "Budgets", icon: PiggyBank },
  { href: "/recurring", label: "Recurring Payments", icon: Repeat },
  { href: "/goals", label: "Savings Goals", icon: Target },
  { href: "/analytics", label: "Analytics & Reports", icon: ChartColumn },
  { href: "/insights", label: "Financial Insights", icon: Lightbulb },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function titleFor(pathname: string): string {
  if (pathname === "/") return "Overview";
  if (pathname.startsWith("/transactions/import")) return "Import transactions";
  if (pathname.startsWith("/accounts/")) return "Account";
  const n = NAV.find((x) => x.href !== "/" && pathname.startsWith(x.href));
  return n?.label ?? "Finance OS";
}

/** Pages where the global period filter applies. */
export function hasPeriodFilter(pathname: string) {
  return pathname === "/" || pathname.startsWith("/analytics");
}
