import { Router } from 'express';
import type { Database } from '../db/index.js';
import { dashboardSummary } from '../servers/catalog.js';

export function dashboardRoutes(db: Database): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const [summary, tokens] = await Promise.all([
      dashboardSummary(db),
      db.read((data) => ({
        total: data.api_tokens.length,
        enabled: data.api_tokens.filter((row) => row.enabled).length,
        degraded: data.api_tokens.filter((row) => row.connection_status === 'degraded').length,
        invalid: data.api_tokens.filter((row) => ['invalid', 'expired'].includes(row.validation_status)).length,
      })),
    ]);
    res.json({ data: { ...summary, tokens } });
  });
  return router;
}
