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
    const conditions: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of [['action', 'a.action'], ['outcome', 'a.outcome'], ['resourceType', 'a.resource_type'], ['resourceId', 'a.resource_id']] as const) {
      const value = input[key];
      if (value) { values.push(value); conditions.push(`${column}=$${values.length}`); }
    }
    if (input.search) {
      values.push(`%${input.search}%`);
      const placeholder = `$${values.length}`;
      conditions.push(`(a.action ILIKE ${placeholder} OR a.resource_id ILIKE ${placeholder} OR u.username ILIKE ${placeholder})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where}`, values);
    values.push(input.limit, (input.page - 1) * input.limit);
    const result = await db.query<any>(
      `SELECT a.*,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where}
       ORDER BY a.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    const total = Number(count.rows[0]?.count ?? 0);
    res.json({ data: {
      items: result.rows.map((row) => ({
        id: String(row.id), userId: row.user_id, username: row.username, action: row.action,
        resourceType: row.resource_type, resourceId: row.resource_id, outcome: row.outcome,
        requestId: row.request_id, ipAddress: row.ip_address, userAgent: row.user_agent,
        details: row.details, createdAt: row.created_at,
      })),
      pagination: { page: input.page, limit: input.limit, total, pages: Math.max(1, Math.ceil(total / input.limit)) },
    } });
  });
  return router;
}
