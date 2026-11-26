"use client";
import * as React from "react";
import { Activity, Coins, Database, Palette, Shapes, Shield, User, Wand2 } from "lucide-react";
import type { Category } from "@/server/services/categories";
import type { Rule } from "@/lib/finance/rules";
import type { RateRow } from "@/server/services/currency";
import type { AuditRow } from "@/server/services/audit";
import { useUpdateParams } from "@/components/layout/period-filter";
import { cn } from "@/lib/utils";
import { ProfileTab, PreferencesTab } from "./profile-tabs";
import { CategoriesTab } from "./categories-tab";
import { RulesTab } from "./rules-tab";
import { CurrenciesTab } from "./currencies-tab";
import { DataTab, SecurityTab, ActivityTab } from "./data-tabs";

export interface SettingsUser {
  fullName: string;
  email: string;
  avatarData: string | null;
  baseCurrency: string;
  dateFormat: string;
  numberLocale: string;
  theme: "light" | "dark" | "system";
  timezone: string;
  budgetRolloverDefault: boolean;
  emergencyFundMonths: number;
  sessionId: string;
}

const TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "preferences", label: "Preferences", icon: Palette },
  { id: "categories", label: "Categories & tags", icon: Shapes },
  { id: "rules", label: "Transaction rules", icon: Wand2 },
  { id: "currencies", label: "Currencies", icon: Coins },
  { id: "data", label: "Data", icon: Database },
  { id: "security", label: "Security", icon: Shield },
  { id: "activity", label: "Activity log", icon: Activity },
];

export function SettingsView(props: {
  tab: string;
  user: SettingsUser;
  categories: Category[];
  usage: Record<string, number>;
  rules: (Rule & { times_applied: number })[];
  rates: RateRow[];
  sessions: { id: string; user_agent: string | null; ip: string | null; created_at: string; last_seen_at: string }[];
  audit: AuditRow[];
  tags: { id: string; name: string; n: number }[];
  accountCount: number;
}) {
  const update = useUpdateParams();
  const [tab, setTab] = React.useState(TABS.some((t) => t.id === props.tab) ? props.tab : "profile");
  const go = (t: string) => {
    setTab(t);
    update({ tab: t === "profile" ? null : t });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium transition-colors focus-ring", tab === t.id ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </nav>
      <div key={tab} className="min-w-0 animate-fade-up">
        {tab === "profile" && <ProfileTab user={props.user} />}
        {tab === "preferences" && <PreferencesTab user={props.user} />}
        {tab === "categories" && <CategoriesTab categories={props.categories} usage={props.usage} tags={props.tags} />}
        {tab === "rules" && <RulesTab rules={props.rules} categories={props.categories} />}
        {tab === "currencies" && <CurrenciesTab rates={props.rates} base={props.user.baseCurrency} />}
        {tab === "data" && <DataTab accountCount={props.accountCount} />}
        {tab === "security" && <SecurityTab sessions={props.sessions} currentSessionId={props.user.sessionId} />}
        {tab === "activity" && <ActivityTab audit={props.audit} />}
      </div>
    </div>
  );
}

export function Section({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card shadow-card", className)}>
      <div className="border-b px-6 py-4">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}
