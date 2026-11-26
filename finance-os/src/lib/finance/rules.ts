/**
 * Transaction rule engine (pure). A rule matches when all / any of its
 * conditions hold, and yields actions. Rules never override a category the
 * user picked manually — that decision is made by the caller.
 */
import { toCents } from "./money";
import { MERCHANT_KEYWORDS } from "../constants";

export interface RuleCondition {
  field: "merchant" | "description" | "account" | "amount" | "type";
  operator: "contains" | "equals" | "starts_with" | "gt" | "lt" | "between";
  value: string;
  value2?: string | null;
}
export interface RuleAction {
  type: "set_category" | "add_tag" | "rename_merchant" | "mark_reviewed";
  value: string;
}
export interface Rule {
  id: string;
  name: string;
  match_mode: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];
  priority: number;
  is_active: boolean;
}
export interface RuleSubject {
  merchant: string;
  description?: string | null;
  accountId: string;
  amountCents: number; // positive
  type: string;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();

function textMatch(op: RuleCondition["operator"], subject: string, value: string): boolean {
  const s = norm(subject);
  const v = norm(value);
  switch (op) {
    case "contains":
      return v.length > 0 && s.includes(v);
    case "equals":
      return s === v;
    case "starts_with":
      return v.length > 0 && s.startsWith(v);
    default:
      return false;
  }
}

function amountMatch(c: RuleCondition, cents: number): boolean {
  let a: number;
  try {
    a = toCents(c.value);
  } catch {
    return false;
  }
  switch (c.operator) {
    case "equals":
      return cents === a;
    case "gt":
      return cents > a;
    case "lt":
      return cents < a;
    case "between": {
      let b: number;
      try {
        b = toCents(c.value2 ?? "");
      } catch {
        return false;
      }
      return cents >= Math.min(a, b) && cents <= Math.max(a, b);
    }
    default:
      return false;
  }
}

export function conditionMatches(c: RuleCondition, s: RuleSubject): boolean {
  switch (c.field) {
    case "merchant":
      return textMatch(c.operator, s.merchant, c.value);
    case "description":
      return textMatch(c.operator, s.description ?? "", c.value);
    case "account":
      return c.value === s.accountId;
    case "type":
      return c.value === s.type;
    case "amount":
      return amountMatch(c, s.amountCents);
  }
}

export function ruleMatches(rule: Rule, s: RuleSubject): boolean {
  if (!rule.is_active || rule.conditions.length === 0) return false;
  return rule.match_mode === "any" ? rule.conditions.some((c) => conditionMatches(c, s)) : rule.conditions.every((c) => conditionMatches(c, s));
}

export interface RuleOutcome {
  categoryId: string | null;
  categoryRule: Rule | null;
  tags: string[];
  merchant: string | null;
  markReviewed: boolean;
  matched: Rule[];
}

/** Apply all matching rules in priority order; first category wins. */
export function evaluateRules(rules: Rule[], s: RuleSubject): RuleOutcome {
  const out: RuleOutcome = { categoryId: null, categoryRule: null, tags: [], merchant: null, markReviewed: false, matched: [] };
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  for (const r of sorted) {
    if (!ruleMatches(r, s)) continue;
    out.matched.push(r);
    for (const a of r.actions) {
      if (a.type === "set_category" && a.value && !out.categoryId) {
        out.categoryId = a.value;
        out.categoryRule = r;
      } else if (a.type === "add_tag" && a.value && !out.tags.includes(a.value)) out.tags.push(a.value);
      else if (a.type === "rename_merchant" && a.value && !out.merchant) out.merchant = a.value;
      else if (a.type === "mark_reviewed") out.markReviewed = true;
    }
  }
  return out;
}

/** Normalize a merchant string for history matching ("NETFLIX.COM 1234" -> "netflix.com"). */
export function normalizeMerchant(m: string): string {
  return norm(m)
    .replace(/\b\d{3,}\b/g, "")
    .replace(/[*#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Default-category name suggested by keyword, if any. */
export function keywordCategory(text: string, kind: "income" | "expense"): string | null {
  const t = ` ${norm(text)} `;
  const incomeNames = new Set(["Salary", "Freelance", "Investment income"]);
  for (const [name, words] of Object.entries(MERCHANT_KEYWORDS)) {
    if (incomeNames.has(name) !== (kind === "income")) continue;
    if (words.some((w) => (w.length <= 3 ? new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t) : t.includes(w)))) return name;
  }
  return null;
}
