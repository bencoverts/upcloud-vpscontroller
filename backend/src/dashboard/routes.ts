import { Router } from 'express';
import type { Database } from '../db/index.js';
import { dashboardSummary } from '../servers/catalog.js';

export function dashboardRoutes(db: Database): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const [summary, tokenCounts] = await Promise.all([
      dashboardSummary(db),
      db.query<any>(`SELECT COUNT(*)::text AS total,COUNT(*) FILTER (WHERE enabled)::text AS enabled,
        COUNT(*) FILTER (WHERE connection_status='degraded')::text AS degraded,
        COUNT(*) FILTER (WHERE validation_status IN ('invalid','expired'))::text AS invalid FROM api_tokens`),
    ]);
    const tokens = tokenCounts.rows[0] ?? {};
    res.json({ data: {
      ...summary,
      tokens: { total: Number(tokens.total ?? 0), enabled: Number(tokens.enabled ?? 0), degraded: Number(tokens.degraded ?? 0), invalid: Number(tokens.invalid ?? 0) },
    } });
  });
  return router;
}
