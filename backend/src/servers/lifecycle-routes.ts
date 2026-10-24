import { Router } from 'express';
import { z } from 'zod';
import type { LifecycleService } from './lifecycle.js';
import type { Database } from '../db/index.js';
import { requireAdmin } from '../auth/middleware.js';
import { requestAudit } from '../http/helpers.js';

export function lifecycleRoutes(db: Database, lifecycle: LifecycleService): Router {
  const router = Router();
  router.get('/targets', async (_req, res) => res.json({ data: { items: await lifecycle.deploymentTargets() } }));
  router.get('/catalog/:tokenId', async (req, res, next) => {
    try {
      const tokenId = z.string().uuid().parse(req.params.tokenId);
      const refresh = req.query.refresh === 'true';
      res.json({ data: await lifecycle.catalog(tokenId, refresh) });
    } catch (error) { next(error); }
  });
  router.post('/deployments', async (req, res, next) => {
    try {
      const job = await lifecycle.deploy(req.body, req.auth!.user);
      await requestAudit(db, req, {
        action: 'server.deploy', resourceType: 'server', outcome: 'accepted',
        details: { jobId: job.id, tokenId: req.body.tokenId },
      });
      res.status(202).json({ data: job });
    } catch (error) { next(error); }
  });
  router.get('/servers/:uuid/catalog', async (req, res, next) => {
    try { res.json({ data: await lifecycle.rebuildCatalog(z.string().uuid().parse(req.params.uuid), req.auth!.user) }); }
    catch (error) { next(error); }
  });
  router.post('/servers/:uuid/rebuild', async (req, res, next) => {
    try {
      const uuid = z.string().uuid().parse(req.params.uuid);
      const job = await lifecycle.rebuild(uuid, req.body, req.auth!.user);
      await requestAudit(db, req, {
        action: req.body.mode === 'reset_os' ? 'server.reset_os' : 'server.change_os',
        resourceType: 'server', resourceId: uuid, outcome: 'accepted',
        details: { jobId: job.id, templateUuid: req.body.templateUuid, detachDisk: req.body.detachDisk },
      });
      res.status(202).json({ data: job });
    } catch (error) { next(error); }
  });
  router.patch('/servers/:uuid/configuration', async (req, res, next) => {
    try {
      const uuid = z.string().uuid().parse(req.params.uuid);
      const result = await lifecycle.updateConfiguration(uuid, req.body, req.auth!.user);
      await requestAudit(db, req, { action: 'server.configuration_update', resourceType: 'server', resourceId: uuid, outcome: 'success', details: { fields: Object.keys(req.body).filter((key) => key !== 'confirmationTitle') } });
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  router.delete('/servers/:uuid', requireAdmin, async (req, res, next) => {
    try {
      const uuid = z.string().uuid().parse(req.params.uuid);
      const result = await lifecycle.delete(uuid, req.body, req.auth!.user);
      await requestAudit(db, req, { action: 'server.delete', resourceType: 'server', resourceId: uuid, outcome: 'success', details: { storagesDeleted: result.storagesDeleted } });
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  return router;
}
