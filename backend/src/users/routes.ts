import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { requestAudit } from '../http/helpers.js';
import type { UserService } from './service.js';

const username = z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'Username hanya boleh berisi huruf, angka, titik, underscore, atau dash.');
const password = z.string().min(12).max(256)
  .regex(/[a-z]/, 'Password harus mengandung huruf kecil.')
  .regex(/[A-Z]/, 'Password harus mengandung huruf besar.')
  .regex(/[0-9]/, 'Password harus mengandung angka.');
const id = z.string().uuid();
const email = z.string().trim().email().max(320).nullable().optional();
const accessSchema = z.object({
  access: z.array(z.object({
    serverUuid: z.string().uuid(),
    expiresAt: z.string().datetime({ offset: true }).nullable().transform((value) => value ? new Date(value).toISOString() : null),
  })).max(10_000),
});

export function userRoutes(db: Database, users: UserService): Router {
  const router = Router();
  router.get('/', async (_req, res) => { res.json({ data: await users.listClients() }); });
  router.get('/options/servers', async (_req, res) => {
    const servers = await db.read((data) => {
      const active = new Set(data.token_server_memberships.filter((row) => row.active).map((row) => row.server_uuid));
      return data.servers.filter((server) => active.has(server.uuid))
        .map((server) => ({ uuid: server.uuid, title: server.title, hostname: server.hostname, state: server.state, zone: server.zone }))
        .sort((left, right) => left.title.localeCompare(right.title));
    });
    res.json({ data: servers });
  });
  router.post('/', async (req, res, next) => {
    try {
      const input = z.object({ username, password, email }).parse(req.body);
      const user = await users.createClient(input);
      await requestAudit(db, req, { action: 'client.create', resourceType: 'user', resourceId: user.id, outcome: 'success', details: { username: user.username } });
      res.status(201).json({ data: user });
    } catch (error) { next(error); }
  });
  router.patch('/:id', async (req, res, next) => {
    try {
      const userId = id.parse(req.params.id);
      const input = z.object({ password: password.optional(), disabled: z.boolean().optional(), email })
        .refine((value) => value.password !== undefined || value.disabled !== undefined || value.email !== undefined, 'Tidak ada perubahan.').parse(req.body);
      const user = await users.updateClient(userId, input);
      await requestAudit(db, req, {
        action: 'client.update', resourceType: 'user', resourceId: userId, outcome: 'success',
        details: { passwordChanged: Boolean(input.password), disabled: input.disabled },
      });
      res.json({ data: user });
    } catch (error) { next(error); }
  });
  router.put('/:id/access', async (req, res, next) => {
    try {
      const userId = id.parse(req.params.id);
      const input = accessSchema.parse(req.body);
      const user = await users.replaceAccess(userId, input.access);
      await requestAudit(db, req, {
        action: 'client.access_update', resourceType: 'user', resourceId: userId, outcome: 'success',
        details: { assignments: input.access.map((item) => ({ serverUuid: item.serverUuid, expiresAt: item.expiresAt })) },
      });
      res.json({ data: user });
    } catch (error) { next(error); }
  });
  return router;
}
