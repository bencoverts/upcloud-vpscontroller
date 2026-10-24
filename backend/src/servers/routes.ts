import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { requestAudit } from '../http/helpers.js';
import type { MetricsService, MetricRange } from '../metrics/service.js';
import type { SyncService } from '../sync/service.js';
import { getServer, listServers } from './catalog.js';

const serverQuerySchema = z.object({
  search: z.string().trim().max(200).optional(), state: z.enum(['started', 'stopped', 'maintenance', 'error']).optional(),
  zone: z.string().max(30).optional(), tokenId: z.string().uuid().optional(), syncStatus: z.string().max(30).optional(),
  sort: z.enum(['title', 'state', 'zone', 'cores', 'memory', 'storage', 'lastSynced']).default('title'),
  order: z.enum(['asc', 'desc']).default('asc'), page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function serverRoutes(db: Database, sync: SyncService, metrics: MetricsService): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const input = serverQuerySchema.parse(req.query);
    res.json({ data: await listServers(db, input) });
  });

  router.get('/:uuid', async (req, res, next) => {
    try {
      const uuid = z.string().uuid().parse(req.params.uuid);
      const server = await getServer(db, uuid);
      if (!server) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan atau tidak lagi terkait token aktif.');
      res.json({ data: { ...server, latestMetrics: await metrics.latest(uuid) } });
    } catch (error) { next(error); }
  });

  router.post('/:uuid/sync', async (req, res, next) => {
    try {
      const uuid = z.string().uuid().parse(req.params.uuid);
      const job = await sync.enqueueServerSync(uuid, req.auth!.user.id);
      await requestAudit(db, req, { action: 'server.sync', resourceType: 'server', resourceId: uuid, outcome: 'accepted', details: { jobId: job.id } });
      res.status(202).json({ data: job });
    } catch (error) { next(error); }
  });

  router.post('/:uuid/actions', async (req, res, next) => {
    try {
      const uuid = z.string().uuid().parse(req.params.uuid);
      const action = z.object({ action: z.enum(['start', 'stop', 'restart']) }).parse(req.body).action;
      const job = await sync.enqueueControl(uuid, action, req.auth!.user.id);
      await requestAudit(db, req, {
        action: `server.${action}`, resourceType: 'server', resourceId: uuid, outcome: 'accepted',
        details: { jobId: job.id, verificationRequired: true },
      });
      res.status(202).json({ data: job });
    } catch (error) { next(error); }
  });

  router.get('/:uuid/metrics', async (req, res, next) => {
    try {
      const uuid = z.string().uuid().parse(req.params.uuid);
      const range = z.enum(['15m', '1h', '6h', '24h', '7d']).default('1h').parse(req.query.range) as MetricRange;
      if (!await getServer(db, uuid)) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan.');
      res.json({ data: await metrics.history(uuid, range) });
    } catch (error) { next(error); }
  });

  router.post('/:uuid/metrics/refresh', async (req, res, next) => {
    try {
      const uuid = z.string().uuid().parse(req.params.uuid);
      if (!await getServer(db, uuid)) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan.');
      const force = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {}).force;
      const result = await metrics.refresh(uuid, force);
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  return router;
}
