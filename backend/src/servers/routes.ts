import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { requestAudit } from '../http/helpers.js';
import type { MetricsService, MetricRange } from '../metrics/service.js';
import type { AgentService } from '../metrics/agent.js';
import type { SyncService } from '../sync/service.js';
import { getServer, listServers, persistServer, upsertMembership } from './catalog.js';
import { requireAdmin, requireServerAccess } from '../auth/access.js';

const serverQuerySchema = z.object({
  search: z.string().trim().max(200).optional(), state: z.enum(['started', 'stopped', 'maintenance', 'error']).optional(),
  zone: z.string().max(30).optional(), tokenId: z.string().uuid().optional(), syncStatus: z.string().max(30).optional(),
  sort: z.enum(['title', 'state', 'zone', 'cores', 'memory', 'storage', 'lastSynced']).default('title'),
  order: z.enum(['asc', 'desc']).default('asc'), page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const uuidSchema = z.string().uuid();
const hostname = z.string().trim().min(1).max(253).regex(
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  'Hostname harus lowercase dan valid menurut format DNS.',
);

export function serverRoutes(db: Database, sync: SyncService, metrics: MetricsService, agents: AgentService): Router {
  const router = Router();
  const identityUpdates = new Set<string>();
  router.get('/', async (req, res) => {
    const input = serverQuerySchema.parse(req.query);
    res.json({ data: await listServers(db, input, req.auth!.user) });
  });

  router.get('/:uuid', async (req, res, next) => {
    try {
      const uuid = uuidSchema.parse(req.params.uuid);
      const server = await getServer(db, uuid, req.auth!.user);
      if (!server) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan atau akses client telah berakhir.');
      res.json({ data: { ...server, latestMetrics: await metrics.latest(uuid) } });
    } catch (error) { next(error); }
  });

  router.patch('/:uuid/identity', async (req, res, next) => {
    let lockedUuid: string | undefined;
    try {
      const uuid = uuidSchema.parse(req.params.uuid);
      await requireServerAccess(db, req.auth!.user, uuid);
      if (identityUpdates.has(uuid)) throw new AppError(409, 'CONFLICT', 'Perubahan identitas server ini masih diproses.');
      identityUpdates.add(uuid);
      lockedUuid = uuid;
      const identity = z.object({ title: z.string().trim().min(1).max(255), hostname }).parse(req.body);
      const { token, client } = await sync.upstreamForServer(uuid);
      const updated = await client.updateServer(uuid, identity);
      await db.withTransaction(({ data }) => {
        persistServer(data, updated);
        upsertMembership(data, token.id, uuid);
      });
      sync.publishServer(uuid);
      await requestAudit(db, req, {
        action: 'server.identity_update', resourceType: 'server', resourceId: uuid, outcome: 'success',
        details: { title: updated.title, hostname: updated.hostname },
      });
      res.json({ data: { ...await getServer(db, uuid, req.auth!.user), latestMetrics: await metrics.latest(uuid) } });
    } catch (error) { next(error); } finally { if (lockedUuid) identityUpdates.delete(lockedUuid); }
  });

  router.post('/:uuid/sync', async (req, res, next) => {
    try {
      const uuid = uuidSchema.parse(req.params.uuid);
      await requireServerAccess(db, req.auth!.user, uuid);
      const job = await sync.enqueueServerSync(uuid, req.auth!.user.id);
      await requestAudit(db, req, { action: 'server.sync', resourceType: 'server', resourceId: uuid, outcome: 'accepted', details: { jobId: job.id } });
      res.status(202).json({ data: job });
    } catch (error) { next(error); }
  });

  router.post('/:uuid/actions', async (req, res, next) => {
    try {
      const uuid = uuidSchema.parse(req.params.uuid);
      await requireServerAccess(db, req.auth!.user, uuid);
      const actionInput = z.object({ action: z.enum(['start', 'stop', 'hard_stop', 'restart']), confirmationTitle: z.string().max(255).optional() }).parse(req.body);
      const action = actionInput.action;
      if (action === 'hard_stop') {
        const server = await getServer(db, uuid, req.auth!.user);
        if (!server || server.title !== actionInput.confirmationTitle) throw new AppError(400, 'CONFIRMATION_INVALID', 'Hard stop memerlukan judul VPS yang persis.');
      }
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
      const uuid = uuidSchema.parse(req.params.uuid);
      await requireServerAccess(db, req.auth!.user, uuid);
      const range = z.enum(['15m', '1h', '6h', '24h', '7d']).default('1h').parse(req.query.range) as MetricRange;
      res.json({ data: await metrics.history(uuid, range) });
    } catch (error) { next(error); }
  });

  router.post('/:uuid/metrics/refresh', async (req, res, next) => {
    try {
      const uuid = uuidSchema.parse(req.params.uuid);
      await requireServerAccess(db, req.auth!.user, uuid);
      const force = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {}).force;
      const result = await metrics.refresh(uuid, force);
      res.json({ data: result });
    } catch (error) { next(error); }
  });

  router.get('/:uuid/agent', async (req, res, next) => {
    try {
      requireAdmin(req.auth!.user);
      const uuid = uuidSchema.parse(req.params.uuid);
      res.json({ data: await agents.status(uuid) });
    } catch (error) { next(error); }
  });

  router.post('/:uuid/agent/rotate', async (req, res, next) => {
    try {
      requireAdmin(req.auth!.user);
      const uuid = uuidSchema.parse(req.params.uuid);
      const result = await agents.rotate(uuid);
      await requestAudit(db, req, { action: 'server.agent_rotate', resourceType: 'server', resourceId: uuid, outcome: 'success' });
      res.status(201).json({ data: result });
    } catch (error) { next(error); }
  });
  return router;
}
