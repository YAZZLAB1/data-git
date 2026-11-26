import { Banknote, Building2, CreditCard, HandCoins, Home, LineChart, PiggyBank, Wallet, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

const MAP = { cash: Banknote, checking: Building2, savings: PiggyBank, investment: LineChart, other_asset: Wallet, credit_card: CreditCard, personal_loan: HandCoins, mortgage: Home, other_liability: Landmark } as const;

export function AccountIcon({ type, className }: { type: string; className?: string }) {
  const Icon = MAP[type as keyof typeof MAP] ?? Wallet;
  const liability = ["credit_card", "personal_loan", "mortgage", "other_liability"].includes(type);
  return (
    <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", liability ? "bg-negative-soft text-negative" : "bg-positive-soft text-positive", className)}>
      <Icon className="h-4 w-4" />
    </span>
  );
}
