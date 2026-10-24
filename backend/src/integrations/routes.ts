import { Router } from 'express';
import type { Database } from '../db/index.js';
import type { SmtpService } from './smtp.js';
import type { BrandingService } from '../branding/service.js';
import { requestAudit } from '../http/helpers.js';

export function integrationRoutes(db: Database, smtp: SmtpService, branding: BrandingService): Router {
  const router = Router();
  router.get('/smtp', (_req, res) => res.json({ data: smtp.status() }));
  router.post('/smtp/test', async (req, res, next) => {
    try {
      const brand = await branding.get();
      const result = await smtp.sendTest(req.body?.recipient, brand.siteName);
      await requestAudit(db, req, { action: 'smtp.test', resourceType: 'system', outcome: 'success', details: { recipient: result.recipient } });
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  return router;
}
