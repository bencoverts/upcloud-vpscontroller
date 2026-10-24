import type { Queryable } from '../db/index.js';

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

export async function writeAudit(query: Queryable, input: AuditInput): Promise<void> {
  await query.query(
    `INSERT INTO audit_logs(user_id, action, resource_type, resource_id, outcome, request_id, ip_address, user_agent, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [input.userId ?? null, input.action, input.resourceType, input.resourceId ?? null,
      input.outcome ?? 'info', input.requestId ?? null, input.ipAddress?.slice(0, 100) ?? null,
      input.userAgent?.slice(0, 300) ?? null, JSON.stringify(input.details ?? {})],
  );
}
