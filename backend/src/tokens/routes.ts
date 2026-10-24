import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { requestAudit } from '../http/helpers.js';
import { AppError } from '../lib/errors.js';
import type { SyncService } from '../sync/service.js';
import type { TokenService } from './service.js';

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const secret = z.string().min(16).max(4096).regex(/^\S+$/, 'Token tidak boleh mengandung whitespace.');
const expiry = z.string().datetime({ offset: true }).nullable().optional();
const selection = z.array(uuid).max(2).refine((items) => new Set(items).size === items.length, 'Server pilihan tidak boleh duplikat.');
const createSchema = z.object({ name, token: secret, expiresAt: expiry, selectedServerUuids: selection.default([]) });
const replaceSchema = z.object({ token: secret, expiresAt: expiry, selectedServerUuids: selection.default([]) });

async function queueAfterSave(sync: SyncService, tokenId: string, userId: string) {
  try {
    return { syncJob: await sync.enqueueTokenSync(tokenId, userId), syncNotice: null };
  } catch (error) {
    const reason = error instanceof AppError ? ` ${error.message}` : '';
    return {
      syncJob: null,
      syncNotice: `Perubahan token sudah tersimpan, tetapi antrean sinkronisasi tidak dapat dikonfirmasi.${reason} Periksa Activity Logs sebelum mencoba lagi.`,
    };
  }
}

export function tokenRoutes(db: Database, tokens: TokenService, sync: SyncService): Router {
  const router = Router();
  router.get('/', async (_req, res) => { res.json({ data: await tokens.list() }); });

  router.post('/validate', async (req, res, next) => {
    try {
      const input = z.object({ token: secret }).parse(req.body);
      const result = await tokens.validate(input.token);
      res.json({ data: {
        valid: true, account: result.account, servers: result.servers,
        fingerprint: result.fingerprint, maskedToken: result.maskedToken,
        metadata: {
          expiry: 'not_exposed_by_bearer_token',
          allowedIpRanges: 'not_exposed_without_token_id',
          note: 'Autentikasi, masa berlaku, dan filter IP diverifikasi oleh UpCloud saat request. Masa berlaku opsional di form adalah metadata dari admin.',
        },
      } });
    } catch (error) { next(error); }
  });

  router.post('/', async (req, res, next) => {
    try {
      const input = createSchema.parse(req.body);
      const token = await tokens.create(input);
      const queued = await queueAfterSave(sync, token.id, req.auth!.user.id);
      await requestAudit(db, req, {
        action: 'token.create', resourceType: 'token', resourceId: token.id, outcome: 'success',
        details: { name: token.name, discoveredServers: token.serverCount, selectedServers: input.selectedServerUuids.length, syncQueued: Boolean(queued.syncJob) },
      });
      res.status(201).json({ data: { ...token, ...queued } });
    } catch (error) { next(error); }
  });

  router.get('/:id/servers', async (req, res, next) => {
    try { res.json({ data: await tokens.discoveredServers(uuid.parse(req.params.id)) }); } catch (error) { next(error); }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const id = uuid.parse(req.params.id);
      const input = z.object({ name, expiresAt: expiry }).parse(req.body);
      const token = await tokens.update(id, input);
      await requestAudit(db, req, { action: 'token.update', resourceType: 'token', resourceId: id, outcome: 'success', details: { name: token.name } });
      res.json({ data: token });
    } catch (error) { next(error); }
  });

  router.put('/:id/replace', async (req, res, next) => {
    try {
      const id = uuid.parse(req.params.id);
      const input = replaceSchema.parse(req.body);
      const token = await tokens.replace(id, input);
      const queued = await queueAfterSave(sync, id, req.auth!.user.id);
      await requestAudit(db, req, { action: 'token.replace', resourceType: 'token', resourceId: id, outcome: 'success', details: { selectedServers: input.selectedServerUuids.length, syncQueued: Boolean(queued.syncJob) } });
      res.json({ data: { ...token, ...queued } });
    } catch (error) { next(error); }
  });

  router.post('/:id/test', async (req, res, next) => {
    try {
      const id = uuid.parse(req.params.id);
      const token = await tokens.test(id);
      await requestAudit(db, req, { action: 'token.test', resourceType: 'token', resourceId: id, outcome: 'success' });
      res.json({ data: token });
    } catch (error) { next(error); }
  });

  router.post('/:id/sync', async (req, res, next) => {
    try {
      const id = uuid.parse(req.params.id);
      const job = await sync.enqueueTokenSync(id, req.auth!.user.id);
      await requestAudit(db, req, { action: 'token.sync', resourceType: 'token', resourceId: id, outcome: 'accepted', details: { jobId: job.id } });
      res.status(202).json({ data: job });
    } catch (error) { next(error); }
  });

  router.put('/:id/selection', async (req, res, next) => {
    try {
      const id = uuid.parse(req.params.id);
      const input = z.object({ selectedServerUuids: selection }).parse(req.body);
      const token = await tokens.setSelection(id, input.selectedServerUuids);
      await requestAudit(db, req, {
        action: 'token.selection_update', resourceType: 'token', resourceId: id, outcome: 'success',
        details: { selectedServerUuids: input.selectedServerUuids },
      });
      res.json({ data: token });
    } catch (error) { next(error); }
  });

  router.patch('/:id/enabled', async (req, res, next) => {
    try {
      const id = uuid.parse(req.params.id);
      const enabled = z.object({ enabled: z.boolean() }).parse(req.body).enabled;
      const token = await tokens.setEnabled(id, enabled);
      await requestAudit(db, req, { action: enabled ? 'token.enable' : 'token.disable', resourceType: 'token', resourceId: id, outcome: 'success' });
      res.json({ data: token });
    } catch (error) { next(error); }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const id = uuid.parse(req.params.id);
      const input = z.object({ confirmationName: name }).parse(req.body);
      await tokens.remove(id, input.confirmationName);
      await requestAudit(db, req, { action: 'token.delete', resourceType: 'token', resourceId: id, outcome: 'success' });
      res.json({ data: { deleted: true, upstreamRevoked: false, note: 'Kredensial lokal dihapus. Cabut token di UpCloud Hub bila tidak lagi digunakan.' } });
    } catch (error) { next(error); }
  });
  return router;
}
