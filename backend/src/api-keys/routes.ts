import { Router } from 'express';
import { z } from 'zod';
import type { PanelApiKeyService } from './service.js';
import { apiScopes } from './service.js';
import { requestAudit } from '../http/helpers.js';
import type { Database } from '../db/index.js';
import { AppError } from '../lib/errors.js';

export function apiKeyRoutes(db: Database, keys: PanelApiKeyService): Router {
  const router = Router();
  router.use((req, _res, next) => req.auth?.apiKey ? next(new AppError(403, 'SESSION_REQUIRED', 'Kelola API key melalui sesi dashboard, bukan API key lain.')) : next());
  router.get('/', async (req, res) => res.json({ data: { items: await keys.list(req.auth!.user), availableScopes: apiScopes } }));
  router.post('/', async (req, res, next) => {
    try {
      const input = z.object({
        name: z.string().trim().min(3).max(80), scopes: z.array(z.enum(apiScopes)).min(1).max(4)
          .refine((items) => new Set(items).size === items.length),
        expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
      }).parse(req.body);
      const result = await keys.create(req.auth!.user, input);
      await requestAudit(db, req, { action: 'panel_api_key.create', resourceType: 'api_key', resourceId: result.record!.id, outcome: 'success', details: { name: input.name, scopes: input.scopes } });
      res.status(201).json({ data: result });
    } catch (error) { next(error); }
  });
  router.delete('/:id', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const result = await keys.revoke(req.auth!.user, id);
      await requestAudit(db, req, { action: 'panel_api_key.revoke', resourceType: 'api_key', resourceId: id, outcome: 'success' });
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  return router;
}
