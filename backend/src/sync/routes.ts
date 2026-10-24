import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { requestAudit } from '../http/helpers.js';
import type { SyncService } from './service.js';

export function syncRoutes(db: Database, sync: SyncService): Router {
  const router = Router();
  router.post('/all', async (req, res, next) => {
    try {
      const result = await sync.enqueueSyncAll(req.auth!.user.id);
      await requestAudit(db, req, {
        action: 'sync.all', resourceType: 'system', outcome: 'accepted',
        details: { jobs: result.jobs.length, skipped: result.skipped.length },
      });
      res.status(202).json({ data: result });
    } catch (error) { next(error); }
  });
  router.get('/jobs/:id', async (req, res, next) => {
    try { res.json({ data: await sync.getJob(z.string().uuid().parse(req.params.id)) }); } catch (error) { next(error); }
  });
  router.post('/jobs/:id/retry', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const job = await sync.retry(id, req.auth!.user.id);
      await requestAudit(db, req, { action: 'sync.retry', resourceType: 'sync_job', resourceId: id, outcome: 'accepted', details: { newJobId: job.id } });
      res.status(202).json({ data: job });
    } catch (error) { next(error); }
  });
  return router;
}
