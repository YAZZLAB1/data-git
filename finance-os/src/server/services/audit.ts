import type { Queryable } from "@/server/db";

export async function audit(
  tx: Queryable,
  userId: string,
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  await tx.query("INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)", [
    userId,
    action,
    entity,
    entityId,
    JSON.stringify(details),
  ]);
}

export interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export async function listAudit(tx: Queryable, userId: string, limit = 50) {
  return tx.query<AuditRow>(
    "SELECT id, action, entity, entity_id, details, created_at FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    [userId, limit],
  );
}
