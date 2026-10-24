import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import type { SyncService } from '../sync/service.js';

const querySchema = z.object({
  kind: z.enum(['audit', 'jobs']).default('audit'), page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30), action: z.string().max(100).optional(),
  outcome: z.enum(['success', 'failure', 'accepted', 'info']).optional(),
  resourceType: z.string().max(50).optional(), resourceId: z.string().max(100).optional(),
  search: z.string().trim().max(200).optional(),
  status: z.string().max(30).optional(), type: z.string().max(30).optional(),
});

export function activityRoutes(db: Database, sync: SyncService): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const input = querySchema.parse(req.query);
    if (input.kind === 'jobs') {
      res.json({ data: await sync.listJobs({ page: input.page, limit: input.limit, status: input.status, type: input.type, search: input.search }) });
      return;
    }
    const result = await db.read((data) => {
      const search = input.search?.toLowerCase();
      const users = new Map(data.users.map((user) => [user.id, user.username]));
      const rows = data.audit_logs.filter((row) => {
        if (input.action && row.action !== input.action) return false;
        if (input.outcome && row.outcome !== input.outcome) return false;
        if (input.resourceType && row.resource_type !== input.resourceType) return false;
        if (input.resourceId && row.resource_id !== input.resourceId) return false;
        if (search) {
          const haystack = `${row.action} ${row.resource_id ?? ''} ${row.user_id ? users.get(row.user_id) ?? '' : ''}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      }).sort((left, right) => right.created_at.localeCompare(left.created_at) || Number(right.id) - Number(left.id));
      const total = rows.length;
      const offset = (input.page - 1) * input.limit;
      return {
        items: rows.slice(offset, offset + input.limit).map((row) => ({
          id: String(row.id), userId: row.user_id, username: row.user_id ? users.get(row.user_id) ?? null : null,
          action: row.action, resourceType: row.resource_type, resourceId: row.resource_id, outcome: row.outcome,
          requestId: row.request_id, ipAddress: row.ip_address, userAgent: row.user_agent,
          details: row.details, createdAt: row.created_at,
        })),
        pagination: { page: input.page, limit: input.limit, total, pages: Math.max(1, Math.ceil(total / input.limit)) },
      };
    });
    res.json({ data: result });
  });
  return router;
}
