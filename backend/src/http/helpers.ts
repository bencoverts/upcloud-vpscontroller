import type { Request } from 'express';
import type { Queryable } from '../db/index.js';
import { writeAudit } from '../lib/audit.js';

export function requestAudit(query: Queryable, req: Request, input: {
  action: string; resourceType: string; resourceId?: string | null;
  outcome?: 'success' | 'failure' | 'accepted' | 'info'; details?: Record<string, unknown>; userId?: string | null;
}) {
  return writeAudit(query, {
    ...input, userId: input.userId === undefined ? req.auth?.user.id ?? null : input.userId, requestId: String(req.id),
    ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null,
  });
}
