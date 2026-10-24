import type { Database, DatabaseTransaction } from '../db/index.js';

export type AuditInput = {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: 'success' | 'failure' | 'accepted' | 'info';
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
};

export function appendAudit(transaction: DatabaseTransaction, input: AuditInput): void {
  const { data } = transaction;
  data.audit_logs.push({
    id: String(data.nextAuditId++), user_id: input.userId ?? null,
    action: input.action, resource_type: input.resourceType, resource_id: input.resourceId ?? null,
    outcome: input.outcome ?? 'info', request_id: input.requestId ?? null,
    ip_address: input.ipAddress?.slice(0, 100) ?? null, user_agent: input.userAgent?.slice(0, 300) ?? null,
    details: input.details ?? {}, created_at: new Date().toISOString(),
  });
}

export async function writeAudit(db: Database, input: AuditInput): Promise<void> {
  await db.withTransaction((transaction) => { appendAudit(transaction, input); });
}
