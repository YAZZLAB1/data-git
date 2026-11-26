import "server-only";
import { formatMoney } from "@/lib/finance/money";
import type { SessionUser } from "@/server/auth/session";
import type { Queryable } from "@/server/db";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { listTags } from "@/server/services/transactions";
import { listRecurring } from "@/server/services/recurring";
import { getBudgetMonth } from "@/server/services/budgets";
import { loadRateTable } from "@/server/services/currency";
import type { AccountOption, CategoryOption } from "@/lib/types";
import type { Notification } from "@/components/layout/app-shell";

export async function loadShell(tx: Queryable, user: SessionUser, today: string) {
  const [accounts, categories, tags] = await Promise.all([
    listAccounts(tx, user.id, { includeArchived: true }),
    listCategories(tx, user.id, { includeArchived: true }),
    listTags(tx, user.id),
  ]);
  const rates = await loadRateTable(tx, user.id);
  const notifications: Notification[] = [];
  const recurring = await listRecurring(tx, user.id, user.baseCurrency, today, rates);
  for (const r of recurring.filter((x) => x.is_active && x.daysUntil <= 7)) {
    notifications.push({
      id: `rec:${r.id}:${r.next_date}`,
      title: r.daysUntil < 0 ? `${r.name} is overdue` : r.daysUntil === 0 ? `${r.name} is due today` : `${r.name} due in ${r.daysUntil} day${r.daysUntil === 1 ? "" : "s"}`,
      body: `${formatMoney(Math.round(Number(r.amount) * 100), r.currency, { locale: user.numberLocale })} · ${r.account_name ?? "No account"}`,
      href: "/recurring",
      tone: r.daysUntil < 0 ? "negative" : "info",
    });
  }
  const budget = await getBudgetMonth(tx, user.id, today, user.baseCurrency, rates);
  for (const b of budget.items.filter((i) => i.state !== "ok")) {
    notifications.push({
      id: `budget:${budget.month}:${b.category.id}:${b.state}`,
      title: b.state === "over" ? `${b.category.name} budget exceeded` : `${b.category.name} budget ${Math.round(b.percent)}% used`,
      body: `${formatMoney(b.spent, user.baseCurrency, { locale: user.numberLocale })} of ${formatMoney(b.available, user.baseCurrency, { locale: user.numberLocale })}`,
      href: "/budgets",
      tone: b.state === "over" ? "negative" : "warning",
    });
  }
  return {
    accounts: accounts.map<AccountOption>((a) => ({ id: a.id, name: a.name, currency: a.currency, type: a.type, cls: a.cls, isArchived: a.is_archived })),
    categories: categories.map<CategoryOption>((c) => ({ id: c.id, name: c.name, kind: c.kind, icon: c.icon, color: c.color, isArchived: c.is_archived })),
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    notifications,
  };
}
