import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { requestAudit } from '../http/helpers.js';
import type { SettingsService } from './service.js';

const settingsSchema = z.object({
  syncIntervalSeconds: z.number().int().min(60).max(86_400),
  serverPollSeconds: z.number().int().min(5).max(3600),
  metricsRefreshSeconds: z.number().int().min(60).max(3600),
  metricsRetentionDays: z.number().int().min(1).max(365),
});

export function settingsRoutes(db: Database, settings: SettingsService): Router {
  const router = Router();
  router.get('/', async (_req, res) => { res.json({ data: await settings.get() }); });
  router.patch('/', async (req, res, next) => {
    try {
      const result = await settings.update(settingsSchema.parse(req.body));
      await requestAudit(db, req, { action: 'settings.update', resourceType: 'system', outcome: 'success', details: result });
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  return router;
}
