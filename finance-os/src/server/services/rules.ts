import type { Queryable } from "@/server/db";
import { evaluateRules, keywordCategory, normalizeMerchant, ruleMatches, type Rule, type RuleSubject } from "@/lib/finance/rules";
import { toCents } from "@/lib/finance/money";
import type { RuleAction, RuleCondition } from "@/lib/validation";
import { audit } from "./audit";
import { UserError } from "./errors";
import { listCategories } from "./categories";

export async function listRules(tx: Queryable, userId: string): Promise<(Rule & { times_applied: number })[]> {
  return tx.query(
    "SELECT id, name, match_mode, conditions, actions, priority, is_active, times_applied FROM transaction_rules WHERE user_id=$1 ORDER BY priority, name",
    [userId],
  );
}

async function validateActions(tx: Queryable, userId: string, actions: RuleAction[]) {
  for (const a of actions) {
    if (a.type === "set_category") {
      const r = await tx.query("SELECT 1 FROM categories WHERE id=$1 AND user_id=$2", [a.value, userId]);
      if (!r.length) throw new UserError("Choose a category for the 'Set category' action.");
    }
    if ((a.type === "add_tag" || a.type === "rename_merchant") && !a.value) throw new UserError("Fill in every action value.");
  }
}

export async function saveRule(
  tx: Queryable,
  userId: string,
  id: string | null,
  d: { name: string; matchMode: "all" | "any"; conditions: RuleCondition[]; actions: RuleAction[]; priority: number; isActive: boolean },
) {
  await validateActions(tx, userId, d.actions);
  for (const c of d.conditions) {
    if (c.field === "amount") {
      try {
        toCents(c.value.replace(",", "."));
        if (c.operator === "between") toCents((c.value2 ?? "").replace(",", "."));
      } catch {
        throw new UserError("Amount conditions need a number, e.g. 100 or 49.99.");
      }
      if (!["equals", "gt", "lt", "between"].includes(c.operator)) throw new UserError("Amount conditions support equals, greater than, less than and between.");
    } else if (["gt", "lt", "between"].includes(c.operator) && c.field !== "account") {
      throw new UserError("Text conditions support contains, equals and starts with.");
    }
  }
  const params = [d.name, d.matchMode, JSON.stringify(d.conditions), JSON.stringify(d.actions), d.priority, d.isActive];
  if (id) {
    const r = await tx.query<{ id: string }>(
      "UPDATE transaction_rules SET name=$1, match_mode=$2, conditions=$3, actions=$4, priority=$5, is_active=$6 WHERE id=$7 AND user_id=$8 RETURNING id",
      [...params, id, userId],
    );
    if (!r.length) throw new UserError("Rule not found.");
    await audit(tx, userId, "update", "rule", id, { name: d.name });
    return id;
  }
  const [row] = await tx.query<{ id: string }>(
    "INSERT INTO transaction_rules (name, match_mode, conditions, actions, priority, is_active, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [...params, userId],
  );
  await audit(tx, userId, "create", "rule", row.id, { name: d.name });
  return row.id;
}

export async function deleteRule(tx: Queryable, userId: string, id: string) {
  await tx.query("DELETE FROM transaction_rules WHERE id=$1 AND user_id=$2", [id, userId]);
  await audit(tx, userId, "delete", "rule", id);
}

interface Candidate {
  id: string;
  merchant: string;
  description: string | null;
  account_id: string;
  account_amount: string;
  amount: string;
  type: string;
  category_id: string | null;
}

async function matchingTransactions(tx: Queryable, userId: string, rule: Rule) {
  const rows = await tx.query<Candidate>(
    `SELECT id, merchant, description, account_id, amount, account_amount, type, category_id FROM transactions
      WHERE user_id=$1 AND type IN ('income','expense','refund') AND category_source <> 'manual'`,
    [userId],
  );
  return rows.filter((t) =>
    ruleMatches(rule, { merchant: t.merchant, description: t.description, accountId: t.account_id, amountCents: toCents(t.amount), type: t.type }),
  );
}

/** How many existing, not-manually-categorized transactions a rule would change. */
export async function previewRule(tx: Queryable, userId: string, id: string) {
  const [rule] = (await listRules(tx, userId)).filter((r) => r.id === id);
  if (!rule) throw new UserError("Rule not found.");
  return (await matchingTransactions(tx, userId, rule)).length;
}

/**
 * Apply a rule to existing transactions. Manually categorized transactions are
 * never changed; only rule-, suggestion- and import-categorized ones are.
 */
export async function applyRuleToExisting(tx: Queryable, userId: string, id: string) {
  const [rule] = (await listRules(tx, userId)).filter((r) => r.id === id);
  if (!rule) throw new UserError("Rule not found.");
  const matches = await matchingTransactions(tx, userId, rule);
  const categoryAction = rule.actions.find((a) => a.type === "set_category");
  const tagActions = rule.actions.filter((a) => a.type === "add_tag").map((a) => a.value);
  const rename = rule.actions.find((a) => a.type === "rename_merchant")?.value;
  const review = rule.actions.some((a) => a.type === "mark_reviewed");
  const cats = await listCategories(tx, userId, { includeArchived: true });
  for (const t of matches) {
    if (categoryAction) {
      const cat = cats.find((c) => c.id === categoryAction.value);
      const kindOk = cat && (cat.kind === "income") === (t.type === "income");
      if (kindOk) await tx.query("UPDATE transactions SET category_id=$1, category_source='rule' WHERE id=$2 AND user_id=$3", [cat!.id, t.id, userId]);
    }
    if (rename) await tx.query("UPDATE transactions SET merchant=$1 WHERE id=$2 AND user_id=$3", [rename, t.id, userId]);
    if (review) await tx.query("UPDATE transactions SET is_reviewed=true WHERE id=$1 AND user_id=$2", [t.id, userId]);
    for (const tag of tagActions) await attachTagByName(tx, userId, t.id, tag);
  }
  await tx.query("UPDATE transaction_rules SET times_applied = times_applied + $1 WHERE id=$2 AND user_id=$3", [matches.length, id, userId]);
  await audit(tx, userId, "apply", "rule", id, { transactions: matches.length });
  return matches.length;
}

export async function attachTagByName(tx: Queryable, userId: string, transactionId: string, name: string) {
  const clean = name.trim().slice(0, 40);
  if (!clean) return;
  const [tag] = await tx.query<{ id: string }>(
    `INSERT INTO tags (user_id, name) VALUES ($1,$2)
     ON CONFLICT (user_id, lower(name)) DO UPDATE SET updated_at = now() RETURNING id`,
    [userId, clean],
  );
  await tx.query("INSERT INTO transaction_tags (user_id, transaction_id, tag_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [userId, transactionId, tag.id]);
}

export interface Suggestion {
  categoryId: string;
  source: "rule" | "history" | "keywords";
  reason: string;
}

/**
 * Suggest a category: (1) matching rule, (2) the user's own past categorization
 * of the same merchant, (3) built-in keyword dictionary.
 */
export async function suggestCategory(tx: Queryable, userId: string, s: RuleSubject, cache: { rules?: Rule[]; categories?: Awaited<ReturnType<typeof listCategories>> } = {}): Promise<Suggestion | null> {
  const kind = s.type === "income" ? "income" : "expense";
  if (!["income", "expense", "refund"].includes(s.type)) return null;
  const cats = (cache.categories ?? (await listCategories(tx, userId))).filter((c) => !c.is_archived);
  const valid = (id: string | null) => cats.find((c) => c.id === id && c.kind === kind);

  const rules = cache.rules ?? (await listRules(tx, userId));
  const out = evaluateRules(rules, s);
  if (out.categoryId && valid(out.categoryId)) return { categoryId: out.categoryId, source: "rule", reason: `Rule “${out.categoryRule!.name}”` };

  const merchant = normalizeMerchant(s.merchant);
  if (merchant.length >= 2) {
    const hist = await tx.query<{ category_id: string; n: number }>(
      `SELECT category_id, count(*) AS n FROM transactions
        WHERE user_id=$1 AND category_id IS NOT NULL AND type = ANY($3::text[])
          AND (lower(merchant) = $2 OR lower(merchant) LIKE $2 || ' %')
        GROUP BY category_id ORDER BY n DESC LIMIT 1`,
      [userId, merchant, kind === "income" ? ["income"] : ["expense", "refund"]],
    );
    if (hist[0] && valid(hist[0].category_id))
      return { categoryId: hist[0].category_id, source: "history", reason: `Used for ${hist[0].n} past “${s.merchant.trim()}” transaction${Number(hist[0].n) === 1 ? "" : "s"}` };
  }

  const name = keywordCategory(`${s.merchant} ${s.description ?? ""}`, kind);
  if (name) {
    const c = cats.find((x) => x.kind === kind && x.name === name);
    if (c) return { categoryId: c.id, source: "keywords", reason: "Based on the merchant name" };
  }
  return null;
}
