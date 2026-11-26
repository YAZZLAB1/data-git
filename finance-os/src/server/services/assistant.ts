/**
 * Financial assistant. The assistant never queries the database directly: it can
 * only call the controlled, read-only functions in `AssistantTools`, each scoped
 * to the signed-in user by RLS. The default provider is deterministic (pattern
 * matching + calculations). An LLM provider can implement `AssistantProvider`
 * and expose the same tools via function calling — no raw database access.
 */
import type { Queryable } from "@/server/db";
import { format, parseISO, subMonths } from "date-fns";
import { formatMoney, toCents, type Cents } from "@/lib/finance/money";
import { percentChange, spendingByCategory, spendingByMerchant, summarize } from "@/lib/finance/calculations";
import { resolvePeriod } from "@/lib/period";
import { loadRateTable } from "./currency";
import { averageMonthlyExpenses, currentNetWorth, loadLines, monthKeys } from "./reporting";
import { listCategories } from "./categories";
import { listRecurring, recurringTotals } from "./recurring";
import { listGoals } from "./goals";

export interface AssistantAnswer {
  answer: string;
  calculation: string[];
  links?: { label: string; href: string }[];
  basis: "actual" | "projection" | "mixed";
}

export interface AssistantProvider {
  answer(question: string): Promise<AssistantAnswer>;
}

/** Controlled read-only data functions available to any assistant provider. */
export function assistantTools(tx: Queryable, userId: string, base: string, today: string) {
  const ratesP = loadRateTable(tx, userId);
  return {
    async periodSummary(from: string, to: string) {
      const { lines, missing } = await loadLines(tx, userId, from, to, base, { rates: await ratesP });
      return { ...summarize(lines), missing, lines };
    },
    async spendingByCategory(from: string, to: string) {
      const { lines } = await loadLines(tx, userId, from, to, base, { rates: await ratesP });
      const cats = await listCategories(tx, userId, { includeArchived: true });
      return [...spendingByCategory(lines)]
        .map(([id, cents]) => ({ id, name: cats.find((c) => c.id === id)?.name ?? "Uncategorized", cents, discretionary: !!cats.find((c) => c.id === id)?.is_discretionary }))
        .filter((x) => x.cents > 0)
        .sort((a, b) => b.cents - a.cents);
    },
    async merchants(from: string, to: string, categoryIds?: Set<string>) {
      const { lines } = await loadLines(tx, userId, from, to, base, { rates: await ratesP });
      const filtered = categoryIds ? lines.filter((l) => l.categoryId && categoryIds.has(l.categoryId)) : lines;
      return [...spendingByMerchant(filtered)].sort((a, b) => b[1] - a[1]);
    },
    async categories() {
      return listCategories(tx, userId);
    },
    async liquidity() {
      const nw = await currentNetWorth(tx, userId, base, today, await ratesP);
      const avg = await averageMonthlyExpenses(tx, userId, base, today, 3, await ratesP);
      return { liquid: nw.liquid, netWorth: nw.netWorth, avgMonthlyExpenses: avg.average, monthsOfHistory: avg.months };
    },
    async recurring() {
      const items = await listRecurring(tx, userId, base, today, await ratesP);
      return { items: items.filter((i) => i.is_active), totals: recurringTotals(items) };
    },
    async goals() {
      return (await listGoals(tx, userId, today)).filter((g) => g.status === "active");
    },
  };
}

function parsePeriod(q: string, today: string) {
  if (/last month/.test(q)) return resolvePeriod({ period: "last_month" }, today);
  if (/this year|year to date|ytd/.test(q)) return resolvePeriod({ period: "ytd" }, today);
  if (/last (12|twelve) months|past year/.test(q)) return resolvePeriod({ period: "last_12m" }, today);
  if (/last (3|three) months/.test(q)) return resolvePeriod({ period: "last_90" }, today);
  return resolvePeriod({ period: "this_month" }, today);
}

export class RuleBasedAssistant implements AssistantProvider {
  constructor(
    private tools: ReturnType<typeof assistantTools>,
    private base: string,
    private locale: string,
    private today: string,
    private emergencyMonths: number,
  ) {}

  private m = (c: Cents) => formatMoney(c, this.base, { locale: this.locale });

  async answer(raw: string): Promise<AssistantAnswer> {
    const q = raw.toLowerCase().trim();
    const t = this.tools;
    const today = this.today;
    const p = parsePeriod(q, today);
    const m = this.m;

    // Affordability: "can I afford a 5,000 purchase"
    const afford = /afford/.test(q) ? q.match(/(\d[\d\s,.]*)/) : null;
    if (afford) {
      const amount = toCents(afford[1].replace(/[\s,]/g, "").replace(/\.(?=\d{3}\b)/g, ""));
      const l = await t.liquidity();
      const rec = await t.recurring();
      const buffer = l.avgMonthlyExpenses * this.emergencyMonths;
      const upcoming = rec.items.filter((i) => i.daysUntil >= 0 && i.daysUntil <= 30).reduce((s, i) => s + (i.baseAmount ?? 0), 0);
      const available = l.liquid - buffer - upcoming;
      const yes = amount <= available;
      return {
        basis: "mixed",
        answer: l.monthsOfHistory === 0
          ? `I don't have enough expense history yet to judge. Your liquid balances are ${m(l.liquid)}.`
          : yes
            ? `Based on your recorded balances, yes — a ${m(amount)} purchase would leave ${m(available - amount)} above your ${this.emergencyMonths}-month safety buffer and upcoming bills.`
            : `It would be tight. After keeping a ${this.emergencyMonths}-month safety buffer and paying bills due in the next 30 days, you'd have ${m(Math.max(0, available))} available — ${m(amount - Math.max(0, available))} short of ${m(amount)}.`,
        calculation: [
          `Liquid balances (cash, checking, savings): ${m(l.liquid)}`,
          `Safety buffer: ${this.emergencyMonths} × average monthly expenses ${m(l.avgMonthlyExpenses)} = ${m(buffer)} (from ${l.monthsOfHistory} complete month${l.monthsOfHistory === 1 ? "" : "s"})`,
          `Recurring payments due in the next 30 days: ${m(upcoming)}`,
          `Available = ${m(l.liquid)} − ${m(buffer)} − ${m(upcoming)} = ${m(available)}`,
          "This is a calculation from your data, not financial advice. Change the buffer in Settings → Preferences.",
        ],
        links: [{ label: "Accounts", href: "/accounts" }],
      };
    }

    if (/subscription|recurring|bills/.test(q)) {
      const r = await t.recurring();
      if (!r.items.length) return { basis: "actual", answer: "You haven't added any recurring payments yet.", calculation: [], links: [{ label: "Add recurring payment", href: "/recurring" }] };
      return {
        basis: "actual",
        answer: `You have ${r.totals.count} active recurring payments totalling ${m(r.totals.monthly)} per month (${m(r.totals.annual)} per year).`,
        calculation: r.items.slice(0, 12).map((i) => `${i.name}: ${formatMoney(toCents(i.amount), i.currency, { locale: this.locale })} ${i.frequency}${i.monthly !== null ? ` ≈ ${m(i.monthly)}/month` : " (no exchange rate)"}`),
        links: [{ label: "Recurring payments", href: "/recurring" }],
      };
    }

    if (/increase|grew|went up|rose/.test(q) && /categor/.test(q)) {
      const prev = resolvePeriod({ period: "this_month" }, today);
      const now = await t.spendingByCategory(prev.from, prev.to);
      const before = await t.spendingByCategory(prev.prevFrom, prev.prevTo);
      const diffs = now
        .map((c) => ({ ...c, before: before.find((b) => b.id === c.id)?.cents ?? 0 }))
        .map((c) => ({ ...c, diff: c.cents - c.before }))
        .sort((a, b) => b.diff - a.diff);
      const top = diffs[0];
      if (!top || top.diff <= 0) return { basis: "actual", answer: "No category has increased compared with the same days last month.", calculation: [] };
      const ch = percentChange(top.cents, top.before);
      return {
        basis: "actual",
        answer: `${top.name} increased the most: ${m(top.cents)} so far this month vs ${m(top.before)} over the same days last month (${ch === null ? "new spending" : `+${Math.round(ch)}%`}).`,
        calculation: diffs.slice(0, 5).map((d) => `${d.name}: ${m(d.before)} → ${m(d.cents)} (${d.diff >= 0 ? "+" : "−"}${m(Math.abs(d.diff))})`),
        links: [{ label: "Spending analytics", href: "/analytics?tab=spending" }],
      };
    }

    if (/save|saved|saving/.test(q) && !/should|how much to/.test(q)) {
      const period = /month/.test(q) && !/year/.test(q) ? p : resolvePeriod({ period: "ytd" }, today);
      const s = await t.periodSummary(period.from, period.to);
      return {
        basis: "actual",
        answer: `${period.label}: you saved ${m(s.net)}${s.savingsRate !== null ? ` — ${Math.round(s.savingsRate)}% of your income` : ""}.`,
        calculation: [
          `Income: ${m(s.income)}`,
          `Expenses (net of refunds): ${m(s.expenses)}`,
          `Net savings = income − expenses = ${m(s.net)}`,
          ...(s.savingsRate !== null ? [`Savings rate = net savings ÷ income = ${s.savingsRate.toFixed(1)}%`] : []),
          "Transfers between your own accounts are excluded.",
        ],
      };
    }

    if (/should i save|how much should|save monthly|save each month/.test(q)) {
      const goals = await t.goals();
      const keys = monthKeys(format(subMonths(parseISO(today), 1), "yyyy-MM-dd"), 3);
      const s = await t.periodSummary(keys[0].from, keys[2].to);
      const avgIncome = Math.round(s.income / 3);
      const required = goals.filter((g) => g.requiredMonthly && g.currency === this.base).reduce((sum, g) => sum + (g.requiredMonthly ?? 0), 0);
      return {
        basis: "projection",
        answer: required > 0
          ? `To stay on schedule for your goals you'd need about ${m(required)} a month. Your average monthly net savings over the last 3 months were ${m(Math.round(s.net / 3))}.`
          : `You don't have dated goals in ${this.base} yet. A common rule of thumb is saving 20% of income — about ${m(Math.round(avgIncome * 0.2))} a month for you.`,
        calculation: [
          ...goals.map((g) => `${g.name}: ${g.requiredMonthly !== null ? formatMoney(g.requiredMonthly, g.currency, { locale: this.locale }) + "/month" : "no target date"} (remaining ${formatMoney(g.remaining, g.currency, { locale: this.locale })})`),
          `Average monthly income (last 3 months): ${m(avgIncome)}`,
          `Average monthly net savings: ${m(Math.round(s.net / 3))}`,
          "Required monthly = (target − saved) ÷ months remaining. Rules of thumb are not personal advice.",
        ],
        links: [{ label: "Goals", href: "/goals" }],
      };
    }

    if (/unnecessary|discretionary|cut|reduce|wasting/.test(q)) {
      const keys = monthKeys(format(subMonths(parseISO(today), 1), "yyyy-MM-dd"), 3);
      const cats = await t.categories();
      const disc = new Set(cats.filter((c) => c.is_discretionary).map((c) => c.id));
      const byCat = (await t.spendingByCategory(keys[0].from, keys[2].to)).filter((c) => c.discretionary);
      const merchants = await t.merchants(keys[0].from, keys[2].to, disc);
      if (!byCat.length) return { basis: "actual", answer: "No discretionary spending recorded in the last 3 months.", calculation: [] };
      return {
        basis: "actual",
        answer: `Your largest discretionary categories over the last 3 months were ${byCat
          .slice(0, 3)
          .map((c) => `${c.name} (${m(c.cents)})`)
          .join(", ")}. Whether they're unnecessary is your call — these are the easiest to adjust.`,
        calculation: [
          ...merchants.slice(0, 6).map(([name, c]) => `${name}: ${m(c)} (≈ ${m(Math.round(c / 3))}/month)`),
          "Discretionary categories can be changed in Settings → Categories.",
        ],
        links: [{ label: "Spending analytics", href: "/analytics?tab=spending" }],
      };
    }

    // "how much did I spend on restaurants"
    const cats = await t.categories();
    const named = cats.filter((c) => c.kind === "expense").find((c) => q.includes(c.name.toLowerCase()) || q.includes(c.name.toLowerCase().replace(/s$/, "")));
    if (named || /spend|spent|money go|where did/.test(q)) {
      const list = await t.spendingByCategory(p.from, p.to);
      const s = await t.periodSummary(p.from, p.to);
      if (named) {
        const hit = list.find((c) => c.id === named.id);
        return {
          basis: "actual",
          answer: `${p.label}: you spent ${m(hit?.cents ?? 0)} on ${named.name.toLowerCase()}${s.expenses > 0 && hit ? ` — ${Math.round((hit.cents / s.expenses) * 100)}% of your expenses` : ""}.`,
          calculation: [
            `Period: ${format(parseISO(p.from), "d MMM yyyy")} – ${format(parseISO(p.to), "d MMM yyyy")}`,
            `${named.name}: expenses minus refunds, including split portions = ${m(hit?.cents ?? 0)}`,
            `Total expenses in the period: ${m(s.expenses)}`,
          ],
          links: [{ label: "View transactions", href: `/transactions?category=${named.id}&from=${p.from}&to=${p.to}` }],
        };
      }
      if (!list.length) return { basis: "actual", answer: `No expenses recorded for ${p.label.toLowerCase()}.`, calculation: [] };
      return {
        basis: "actual",
        answer: `${p.label} you spent ${m(s.expenses)}. The biggest categories were ${list
          .slice(0, 3)
          .map((c) => `${c.name} (${m(c.cents)})`)
          .join(", ")}.`,
        calculation: list.slice(0, 8).map((c) => `${c.name}: ${m(c.cents)} (${Math.round((c.cents / Math.max(1, s.expenses)) * 100)}%)`),
        links: [{ label: "Open analytics", href: "/analytics?tab=spending" }],
      };
    }

    return {
      basis: "actual",
      answer: "I can answer questions about your recorded finances. Try one of the suggestions below.",
      calculation: [],
    };
  }
}

export const ASSISTANT_SUGGESTIONS = [
  "Where did my money go this month?",
  "How much did I spend on restaurants?",
  "Which category increased the most?",
  "How much did I save this year?",
  "Can I afford a 5,000 purchase?",
  "What subscriptions am I paying for?",
  "How much should I save monthly?",
  "What are my biggest unnecessary expenses?",
];

