import type { Queryable } from "@/server/db";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { audit } from "./audit";
import { UserError } from "./errors";

export interface Category {
  id: string;
  name: string;
  kind: "expense" | "income";
  icon: string;
  color: string;
  is_system: boolean;
  is_discretionary: boolean;
  is_archived: boolean;
  sort_order: number;
}

const COLS = "id, name, kind, icon, color, is_system, is_discretionary, is_archived, sort_order";

export async function seedDefaultCategories(tx: Queryable, userId: string) {
  let i = 0;
  for (const c of DEFAULT_CATEGORIES) {
    await tx.query(
      `INSERT INTO categories (user_id, name, kind, icon, color, is_system, is_discretionary, sort_order)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7) ON CONFLICT DO NOTHING`,
      [userId, c.name, c.kind, c.icon, c.color, !!c.discretionary, (i += 10)],
    );
  }
}

export async function listCategories(tx: Queryable, userId: string, opts: { includeArchived?: boolean } = {}) {
  return tx.query<Category>(
    `SELECT ${COLS} FROM categories WHERE user_id = $1 ${opts.includeArchived ? "" : "AND NOT is_archived"}
     ORDER BY kind DESC, sort_order, name`,
    [userId],
  );
}

export async function createCategory(
  tx: Queryable,
  userId: string,
  d: { name: string; kind: "expense" | "income"; icon: string; color: string; isDiscretionary: boolean },
) {
  const dup = await tx.query("SELECT 1 FROM categories WHERE user_id=$1 AND kind=$2 AND lower(name)=lower($3)", [userId, d.kind, d.name]);
  if (dup.length) throw new UserError(`A category named "${d.name}" already exists.`, "name");
  const [row] = await tx.query<Category>(
    `INSERT INTO categories (user_id, name, kind, icon, color, is_discretionary, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,(SELECT coalesce(max(sort_order),0)+10 FROM categories WHERE user_id=$1))
     RETURNING ${COLS}`,
    [userId, d.name, d.kind, d.icon, d.color, d.isDiscretionary],
  );
  await audit(tx, userId, "create", "category", row.id, { name: d.name });
  return row;
}

export async function updateCategory(
  tx: Queryable,
  userId: string,
  id: string,
  d: { name: string; icon: string; color: string; isDiscretionary: boolean },
) {
  const [existing] = await tx.query<Category>(`SELECT ${COLS} FROM categories WHERE id=$1 AND user_id=$2`, [id, userId]);
  if (!existing) throw new UserError("Category not found.");
  const dup = await tx.query("SELECT 1 FROM categories WHERE user_id=$1 AND kind=$2 AND lower(name)=lower($3) AND id<>$4", [
    userId,
    existing.kind,
    d.name,
    id,
  ]);
  if (dup.length) throw new UserError(`A category named "${d.name}" already exists.`, "name");
  await tx.query("UPDATE categories SET name=$1, icon=$2, color=$3, is_discretionary=$4 WHERE id=$5 AND user_id=$6", [
    d.name,
    d.icon,
    d.color,
    d.isDiscretionary,
    id,
    userId,
  ]);
  await audit(tx, userId, "update", "category", id, { name: d.name });
}

/**
 * Delete a category. Transactions and splits in it move to `reassignTo`
 * (or become uncategorized). Budget allocations for it are removed.
 */
export async function deleteCategory(tx: Queryable, userId: string, id: string, reassignTo: string | null) {
  const [existing] = await tx.query<Category>(`SELECT ${COLS} FROM categories WHERE id=$1 AND user_id=$2`, [id, userId]);
  if (!existing) throw new UserError("Category not found.");
  if (reassignTo) {
    const [target] = await tx.query<Category>(`SELECT ${COLS} FROM categories WHERE id=$1 AND user_id=$2`, [reassignTo, userId]);
    if (!target || target.kind !== existing.kind || target.id === id) throw new UserError("Choose another category of the same kind.");
    await tx.query("UPDATE transactions SET category_id=$1 WHERE category_id=$2 AND user_id=$3", [reassignTo, id, userId]);
    await tx.query("UPDATE transaction_splits SET category_id=$1 WHERE category_id=$2 AND user_id=$3", [reassignTo, id, userId]);
    await tx.query("UPDATE recurring_payments SET category_id=$1 WHERE category_id=$2 AND user_id=$3", [reassignTo, id, userId]);
  }
  await tx.query("DELETE FROM categories WHERE id=$1 AND user_id=$2", [id, userId]);
  await audit(tx, userId, "delete", "category", id, { name: existing.name, reassignTo });
}

export async function categoryUsage(tx: Queryable, userId: string, id: string): Promise<number> {
  const [r] = await tx.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM transactions WHERE user_id=$1 AND category_id=$2)
          + (SELECT count(*) FROM transaction_splits WHERE user_id=$1 AND category_id=$2) AS n`,
    [userId, id],
  );
  return Number(r?.n ?? 0);
}
