import { Router } from 'express';
import { z } from 'zod';
import type { BrandingService } from './service.js';
import { requestAudit } from '../http/helpers.js';
import type { Database } from '../db/index.js';
import { AppError } from '../lib/errors.js';

export function publicBrandingRoutes(branding: BrandingService): Router {
  const router = Router();
  router.get('/', async (_req, res, next) => { try { res.json({ data: await branding.get() }); } catch (error) { next(error); } });
  router.get('/assets/:kind', async (req, res, next) => {
    try {
      const kind = z.enum(['logo', 'favicon']).parse(req.params.kind);
      const asset = await branding.asset(kind);
      if (!asset) throw new AppError(404, 'NOT_FOUND', 'Asset branding belum dikonfigurasi.');
      res.status(200).set({ 'Content-Type': asset.mime, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(asset.data, 'base64'));
    } catch (error) { next(error); }
  });
  return router;
}
export function brandingRoutes(db: Database, branding: BrandingService): Router {
  const router = Router();
  router.patch('/', async (req, res, next) => {
    try {
      const input = z.object({
        siteName: z.string().trim().min(1).max(80), siteTagline: z.string().trim().min(1).max(120),
        accent: z.enum(['teal', 'blue', 'violet', 'rose', 'amber']), defaultTheme: z.enum(['system', 'light', 'dark']),
      }).parse(req.body);
      const result = await branding.update(input);
      await requestAudit(db, req, { action: 'branding.update', resourceType: 'system', outcome: 'success', details: input });
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  router.put('/assets/:kind', async (req, res, next) => {
    try {
      const kind = z.enum(['logo', 'favicon']).parse(req.params.kind);
      const { dataUrl } = z.object({ dataUrl: z.string().max(750_000) }).parse(req.body);
      const result = await branding.setAsset(kind, dataUrl);
      await requestAudit(db, req, { action: 'branding.asset_upload', resourceType: 'system', outcome: 'success', details: { kind } });
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  router.delete('/assets/:kind', async (req, res, next) => {
    try {
      const kind = z.enum(['logo', 'favicon']).parse(req.params.kind);
      res.json({ data: await branding.removeAsset(kind) });
    } catch (error) { next(error); }
  });
  return router;
}
