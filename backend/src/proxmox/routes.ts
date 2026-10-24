import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import type { ProxmoxService } from './service.js';
import { requestAudit } from '../http/helpers.js';

export function proxmoxRoutes(db: Database, proxmox: ProxmoxService): Router {
  const router = Router();
  router.get('/connections', async (_req, res) => res.json({ data: await proxmox.listConnections() }));
  router.post('/connections', async (req, res, next) => {
    try {
      const result = await proxmox.create(req.body);
      await requestAudit(db, req, { action: 'proxmox.connection_create', resourceType: 'proxmox', resourceId: result!.id, outcome: 'success', details: { name: result!.name } });
      res.status(201).json({ data: result });
    } catch (error) { next(error); }
  });
  router.post('/connections/:id/sync', async (req, res, next) => {
    try { res.json({ data: await proxmox.sync(z.string().uuid().parse(req.params.id)) }); } catch (error) { next(error); }
  });
  router.delete('/connections/:id', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const { confirmationName } = z.object({ confirmationName: z.string().min(1).max(80) }).parse(req.body);
      const result = await proxmox.remove(id, confirmationName);
      await requestAudit(db, req, { action: 'proxmox.connection_remove', resourceType: 'proxmox', resourceId: id, outcome: 'success' });
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  router.get('/resources', async (_req, res) => res.json({ data: await proxmox.resources() }));
  router.post('/resources/:id/actions', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const input = z.object({ action: z.enum(['start', 'shutdown', 'stop', 'reboot']), confirmationName: z.string().max(255).optional() }).parse(req.body);
      const result = await proxmox.power(id, input.action, input.confirmationName);
      await requestAudit(db, req, { action: `proxmox.${input.action}`, resourceType: 'proxmox_resource', resourceId: id, outcome: 'success', details: result });
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  return router;
}
