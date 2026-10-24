import { Router } from 'express';
import type { Database } from '../db/index.js';
import { dashboardSummary } from '../servers/catalog.js';

export function dashboardRoutes(db: Database): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const [summary, tokens] = await Promise.all([
      dashboardSummary(db, req.auth!.user),
      db.read((data) => req.auth!.user.role === 'admin' ? ({
        total: data.api_tokens.length,
        enabled: data.api_tokens.filter((row) => row.enabled).length,
        degraded: data.api_tokens.filter((row) => row.connection_status === 'degraded').length,
        invalid: data.api_tokens.filter((row) => ['invalid', 'expired'].includes(row.validation_status)).length,
      }) : ({ total: 0, enabled: 0, degraded: 0, invalid: 0 })),
    ]);
    res.json({ data: { ...summary, tokens } });
  });
  return router;
}
