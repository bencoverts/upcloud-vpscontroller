import { Router } from 'express';
import type { Database } from '../db/index.js';
import { requestAudit } from '../http/helpers.js';

export function backupRoutes(db: Database): Router {
  const router = Router();
  router.get('/', async (req, res, next) => {
    try {
      const snapshot = await db.read((data) => ({ ...data, sessions: [] }));
      const contents = `${JSON.stringify(snapshot, null, 2)}\n`;
      const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      await requestAudit(db, req, { action: 'backup.download', resourceType: 'system', outcome: 'success' });
      res.status(200).set({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="cerdasnet-${stamp}.json"`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      }).send(contents);
    } catch (error) { next(error); }
  });
  return router;
}
