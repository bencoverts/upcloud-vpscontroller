import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z, ZodError } from 'zod';
import type { Context } from 'hono';
import type { ApplicationServices } from '../../backend/src/services.js';
import type { AuthContext } from '../../backend/src/auth/service.js';
import { bootstrapAdmin } from '../../backend/src/auth/service.js';
import { requireAdmin, requireServerAccess } from '../../backend/src/auth/access.js';
import { AppError } from '../../backend/src/lib/errors.js';
import { hashOpaqueToken, randomId, safeHexEqual } from '../../backend/src/lib/crypto.js';
import { writeAudit } from '../../backend/src/lib/audit.js';
import { dashboardSummary, getServer, listServers, persistServer, upsertMembership } from '../../backend/src/servers/catalog.js';
import type { MetricRange } from '../../backend/src/metrics/service.js';
import type { WorkerEnv } from './runtime.js';

type Variables = { auth: AuthContext };
type C = Context<{ Variables: Variables }>;
const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const secret = z.string().min(16).max(4096).regex(/^\S+$/, 'Token tidak boleh mengandung whitespace.');
const expiry = z.string().datetime({ offset: true }).nullable().optional();
const selection = z.array(uuid).max(2).refine((items) => new Set(items).size === items.length, 'Server pilihan tidak boleh duplikat.');
const password = z.string().min(12).max(256).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/);
const hostname = z.string().trim().min(1).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const byteCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nullableBytes = byteCount.nullable();

function data(c: C, value: unknown, status: 200 | 201 | 202 = 200) { return c.json({ data: value }, status); }
function cookieName(services: ApplicationServices) { return services.config.cookieSecure ? '__Host-cerdasnet_session' : 'cerdasnet_session'; }
function clientIp(c: C) { return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null; }
async function audit(c: C, services: ApplicationServices, input: Parameters<typeof writeAudit>[1]) {
  await writeAudit(services.db, {
    ...input, userId: input.userId === undefined ? c.get('auth')?.user.id ?? null : input.userId,
    requestId: c.req.header('x-request-id') ?? randomId(), ipAddress: clientIp(c), userAgent: c.req.header('user-agent') ?? null,
  });
}
async function body<T>(c: C, schema: z.ZodType<T>): Promise<T> { return schema.parse(await c.req.json()); }
function admin(c: C) { requireAdmin(c.get('auth').user); }
function cookieOptions(expires?: Date) { return { httpOnly: true, secure: true, sameSite: 'Lax' as const, path: '/', ...(expires ? { expires } : {}) }; }

export function createWorkerApi(services: ApplicationServices, env: WorkerEnv, options: {
  allowLogin: (ip: string) => Promise<boolean>;
  websocket: (c: C) => Promise<Response>;
}) {
  const { db, auth, tokens, sync, settings, metrics, agents, users, config } = services;
  const identityUpdates = new Set<string>();
  const app = new Hono<{ Variables: Variables }>();

  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.path.startsWith('/api/')) {
      if (c.req.header('sec-fetch-site') === 'cross-site') throw new AppError(403, 'CSRF_INVALID', 'Request lintas situs ditolak.');
      const origin = c.req.header('origin');
      if (origin) {
        const actual = new URL(origin).origin;
        const requestOrigin = new URL(c.req.url).origin;
        if (actual !== config.appOrigin && actual !== requestOrigin) throw new AppError(403, 'CSRF_INVALID', 'Origin request tidak diizinkan.');
      }
      const length = Number(c.req.header('content-length') ?? 0);
      if (length > 32 * 1024) throw new AppError(413, 'BAD_REQUEST', 'Ukuran request melebihi batas.');
    }
    try { await next(); } catch (error) {
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') await c.req.raw.body?.cancel().catch(() => undefined);
      throw error;
    }
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  app.get('/health/live', (c) => c.json({ status: 'ok' }));
  app.get('/health/ready', async (c) => {
    await db.checkHealth();
    return c.json({ status: 'ready', database: 'ok', storage: 'r2_json' });
  });

  app.post('/api/auth/bootstrap', async (c) => {
    if (!env.BOOTSTRAP_SECRET || !safeHexEqual(hashOpaqueToken(c.req.header('x-bootstrap-key') ?? ''), hashOpaqueToken(env.BOOTSTRAP_SECRET))) {
      throw new AppError(403, 'FORBIDDEN', 'Bootstrap secret tidak valid.');
    }
    const input = await body(c, z.object({ username: z.string().trim().min(3).max(64), password }));
    const user = await bootstrapAdmin(db, input.username, input.password);
    return data(c, { created: true, username: user.username }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const ip = clientIp(c) ?? 'unknown';
    if (!await options.allowLogin(ip)) throw new AppError(429, 'RATE_LIMITED', 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.');
    try {
      const input = await body(c, z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(1).max(256) }));
      const result = await auth.login(input.username, input.password, { ipAddress: ip, userAgent: c.req.header('user-agent') });
      setCookie(c, cookieName(services), result.sessionToken, { ...cookieOptions(result.expiresAt), secure: config.cookieSecure });
      await audit(c, services, { action: 'auth.login', resourceType: 'user', resourceId: result.auth.user.id, outcome: 'success', userId: result.auth.user.id, details: { username: result.auth.user.username } });
      return data(c, { user: result.auth.user, csrfToken: result.auth.csrfToken, expiresAt: result.expiresAt });
    } catch (error) {
      await audit(c, services, { action: 'auth.login', resourceType: 'session', outcome: 'failure', userId: null }).catch(() => undefined);
      throw error;
    }
  });

  app.post('/api/agent/v1/metrics', async (c) => {
    const authorization = c.req.header('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new AppError(401, 'AGENT_UNAUTHORIZED', 'Bearer agent token diperlukan.');
    const input = await body(c, z.object({
      serverUuid: uuid, filesystemUsedBytes: byteCount, filesystemTotalBytes: byteCount,
      filesystemCount: z.number().int().min(1).max(1024), memoryUsedBytes: nullableBytes, memoryTotalBytes: nullableBytes,
      swapUsedBytes: nullableBytes, swapTotalBytes: nullableBytes, osUptimeSeconds: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    }).superRefine((value, context) => {
      if (value.filesystemUsedBytes > value.filesystemTotalBytes) context.addIssue({ code: 'custom', message: 'Filesystem used melebihi total.' });
    }));
    const sample = await agents.ingest(input.serverUuid, authorization.slice(7), input);
    return data(c, { accepted: true, sampledAt: sample.sampledAt }, 202);
  });

  app.use('/api/*', async (c, next) => {
    const token = getCookie(c, cookieName(services));
    if (!token || token.length > 200) throw new AppError(401, 'UNAUTHENTICATED', 'Sesi login diperlukan.');
    const context = await auth.authenticate(token);
    if (!context) throw new AppError(401, 'UNAUTHENTICATED', 'Sesi tidak valid atau telah kedaluwarsa.');
    c.set('auth', context);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const supplied = c.req.header('x-csrf-token');
      if (!supplied || !safeHexEqual(hashOpaqueToken(supplied), hashOpaqueToken(context.csrfToken))) throw new AppError(403, 'CSRF_INVALID', 'Token CSRF tidak valid.');
    }
    if (/^\/api\/(tokens|users|backup|activity)(?:\/|$)/.test(c.req.path)) admin(c);
    await next();
  });

  app.get('/api/events', (c) => options.websocket(c));
  app.get('/api/auth/me', (c) => data(c, { user: c.get('auth').user, csrfToken: c.get('auth').csrfToken, expiresAt: c.get('auth').expiresAt }));
  app.post('/api/auth/logout', async (c) => {
    await auth.logout(c.get('auth').sessionId);
    await audit(c, services, { action: 'auth.logout', resourceType: 'user', resourceId: c.get('auth').user.id, outcome: 'success' });
    deleteCookie(c, cookieName(services), { path: '/' });
    return data(c, { loggedOut: true });
  });
  app.patch('/api/auth/password', async (c) => {
    const input = await body(c, z.object({ currentPassword: z.string().min(1).max(256), newPassword: password }));
    await auth.changePassword(c.get('auth').user.id, input.currentPassword, input.newPassword);
    await audit(c, services, { action: 'auth.password_change', resourceType: 'user', resourceId: c.get('auth').user.id, outcome: 'success' });
    deleteCookie(c, cookieName(services), { path: '/' });
    return data(c, { passwordChanged: true, loginRequired: true });
  });

  app.get('/api/dashboard', async (c) => {
    const [summary, tokenSummary] = await Promise.all([
      dashboardSummary(db, c.get('auth').user),
      db.read((state) => c.get('auth').user.role === 'admin' ? {
        total: state.api_tokens.length, enabled: state.api_tokens.filter((row) => row.enabled).length,
        degraded: state.api_tokens.filter((row) => row.connection_status === 'degraded').length,
        invalid: state.api_tokens.filter((row) => ['invalid', 'expired'].includes(row.validation_status)).length,
      } : { total: 0, enabled: 0, degraded: 0, invalid: 0 }),
    ]);
    return data(c, { ...summary, tokens: tokenSummary });
  });

  const validateToken = async (c: C) => {
    const input = await body(c, z.object({ token: secret }));
    const result = await tokens.validate(input.token);
    return data(c, {
      valid: true, account: result.account, servers: result.servers, fingerprint: result.fingerprint, maskedToken: result.maskedToken,
      metadata: { expiry: 'not_exposed_by_bearer_token', allowedIpRanges: 'not_exposed_without_token_id', note: 'Autentikasi dan filter IP diverifikasi oleh UpCloud saat request.' },
    });
  };
  const queueAfterSave = async (tokenId: string, userId: string) => {
    try { return { syncJob: await sync.enqueueTokenSync(tokenId, userId), syncNotice: null }; }
    catch (error) { return { syncJob: null, syncNotice: `Token tersimpan, tetapi sinkronisasi tidak dapat dikonfirmasi. ${error instanceof Error ? error.message : ''}` }; }
  };
  app.post('/api/tokens/validate', validateToken);
  app.get('/api/tokens', async (c) => data(c, await tokens.list()));
  app.post('/api/tokens', async (c) => {
    const input = await body(c, z.object({ name, token: secret, expiresAt: expiry, selectedServerUuids: selection.default([]) }));
    const token = await tokens.create(input);
    const queued = await queueAfterSave(token.id, c.get('auth').user.id);
    await audit(c, services, { action: 'token.create', resourceType: 'token', resourceId: token.id, outcome: 'success', details: { name: token.name, discoveredServers: token.serverCount } });
    return data(c, { ...token, ...queued }, 201);
  });
  app.get('/api/tokens/:id/servers', async (c) => data(c, await tokens.discoveredServers(uuid.parse(c.req.param('id')))));
  app.patch('/api/tokens/:id', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const input = await body(c, z.object({ name, expiresAt: expiry }));
    const token = await tokens.update(id, input);
    await audit(c, services, { action: 'token.update', resourceType: 'token', resourceId: id, outcome: 'success', details: { name: token.name } });
    return data(c, token);
  });
  app.put('/api/tokens/:id/replace', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const input = await body(c, z.object({ token: secret, expiresAt: expiry, selectedServerUuids: selection.default([]) }));
    const token = await tokens.replace(id, input);
    const queued = await queueAfterSave(id, c.get('auth').user.id);
    await audit(c, services, { action: 'token.replace', resourceType: 'token', resourceId: id, outcome: 'success' });
    return data(c, { ...token, ...queued });
  });
  app.post('/api/tokens/:id/test', async (c) => data(c, await tokens.test(uuid.parse(c.req.param('id')))));
  app.post('/api/tokens/:id/sync', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const job = await sync.enqueueTokenSync(id, c.get('auth').user.id);
    await audit(c, services, { action: 'token.sync', resourceType: 'token', resourceId: id, outcome: 'accepted', details: { jobId: job.id } });
    return data(c, job, 202);
  });
  app.put('/api/tokens/:id/selection', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const input = await body(c, z.object({ selectedServerUuids: selection }));
    return data(c, await tokens.setSelection(id, input.selectedServerUuids));
  });
  app.patch('/api/tokens/:id/enabled', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const input = await body(c, z.object({ enabled: z.boolean() }));
    return data(c, await tokens.setEnabled(id, input.enabled));
  });
  app.delete('/api/tokens/:id', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const input = await body(c, z.object({ confirmationName: name }));
    await tokens.remove(id, input.confirmationName);
    await audit(c, services, { action: 'token.delete', resourceType: 'token', resourceId: id, outcome: 'success' });
    return data(c, { deleted: true, upstreamRevoked: false });
  });

  app.get('/api/servers', async (c) => {
    const input = z.object({
      search: z.string().trim().max(200).optional(), state: z.enum(['started', 'stopped', 'maintenance', 'error']).optional(),
      zone: z.string().max(30).optional(), tokenId: uuid.optional(), syncStatus: z.string().max(30).optional(),
      sort: z.enum(['title', 'state', 'zone', 'cores', 'memory', 'storage', 'lastSynced']).default('title'),
      order: z.enum(['asc', 'desc']).default('asc'), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(Object.fromEntries(new URL(c.req.url).searchParams));
    return data(c, await listServers(db, input, c.get('auth').user));
  });
  app.get('/api/servers/:id', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const server = await getServer(db, id, c.get('auth').user);
    if (!server) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan atau akses client telah berakhir.');
    return data(c, { ...server, latestMetrics: await metrics.latest(id) });
  });
  app.patch('/api/servers/:id/identity', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    await requireServerAccess(db, c.get('auth').user, id);
    if (identityUpdates.has(id)) throw new AppError(409, 'CONFLICT', 'Perubahan identitas server ini masih diproses.');
    identityUpdates.add(id);
    try {
      const identity = await body(c, z.object({ title: z.string().trim().min(1).max(255), hostname }));
      const { token, client } = await sync.upstreamForServer(id);
      const updated = await client.updateServer(id, identity);
      await db.withTransaction(({ data: state }) => { persistServer(state, updated); upsertMembership(state, token.id, id); });
      sync.publishServer(id);
      await audit(c, services, { action: 'server.identity_update', resourceType: 'server', resourceId: id, outcome: 'success', details: identity });
      return data(c, { ...await getServer(db, id, c.get('auth').user), latestMetrics: await metrics.latest(id) });
    } finally { identityUpdates.delete(id); }
  });
  app.post('/api/servers/:id/sync', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    await requireServerAccess(db, c.get('auth').user, id);
    const job = await sync.enqueueServerSync(id, c.get('auth').user.id);
    await audit(c, services, { action: 'server.sync', resourceType: 'server', resourceId: id, outcome: 'accepted', details: { jobId: job.id } });
    return data(c, job, 202);
  });
  app.post('/api/servers/:id/actions', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    await requireServerAccess(db, c.get('auth').user, id);
    const input = await body(c, z.object({ action: z.enum(['start', 'stop', 'restart']) }));
    const job = await sync.enqueueControl(id, input.action, c.get('auth').user.id);
    await audit(c, services, { action: `server.${input.action}`, resourceType: 'server', resourceId: id, outcome: 'accepted', details: { jobId: job.id } });
    return data(c, job, 202);
  });
  app.get('/api/servers/:id/metrics', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    await requireServerAccess(db, c.get('auth').user, id);
    const range = z.enum(['15m', '1h', '6h', '24h', '7d']).default('1h').parse(new URL(c.req.url).searchParams.get('range') ?? undefined) as MetricRange;
    return data(c, await metrics.history(id, range));
  });
  app.post('/api/servers/:id/metrics/refresh', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    await requireServerAccess(db, c.get('auth').user, id);
    const input = await body(c, z.object({ force: z.boolean().default(false) }).default({ force: false }));
    return data(c, await metrics.refresh(id, input.force));
  });
  app.get('/api/servers/:id/agent', async (c) => { admin(c); return data(c, await agents.status(uuid.parse(c.req.param('id')))); });
  app.post('/api/servers/:id/agent/rotate', async (c) => {
    admin(c);
    const id = uuid.parse(c.req.param('id'));
    const result = await agents.rotate(id);
    await audit(c, services, { action: 'server.agent_rotate', resourceType: 'server', resourceId: id, outcome: 'success' });
    return data(c, result, 201);
  });

  app.post('/api/sync/all', async (c) => {
    admin(c);
    const result = await sync.enqueueSyncAll(c.get('auth').user.id);
    return data(c, result, 202);
  });
  app.get('/api/sync/jobs/:id', async (c) => {
    const job = await sync.getJob(uuid.parse(c.req.param('id')));
    if (c.get('auth').user.role !== 'admin') {
      if (!job.serverUuid) admin(c); else await requireServerAccess(db, c.get('auth').user, job.serverUuid);
    }
    return data(c, job);
  });
  app.post('/api/sync/jobs/:id/retry', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const existing = await sync.getJob(id);
    if (c.get('auth').user.role !== 'admin') {
      if (existing.type !== 'server_sync' || !existing.serverUuid) admin(c); else await requireServerAccess(db, c.get('auth').user, existing.serverUuid);
    }
    return data(c, await sync.retry(id, c.get('auth').user.id), 202);
  });

  app.get('/api/settings', async (c) => data(c, await settings.get()));
  app.patch('/api/settings', async (c) => {
    admin(c);
    const input = await body(c, z.object({
      syncIntervalSeconds: z.number().int().min(60).max(86400), serverPollSeconds: z.number().int().min(5).max(3600),
      metricsRefreshSeconds: z.number().int().min(60).max(3600), metricsRetentionDays: z.number().int().min(1).max(365),
    }));
    return data(c, await settings.update(input));
  });
  app.get('/api/activity', async (c) => {
    const input = z.object({
      kind: z.enum(['audit', 'jobs']).default('audit'), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(30),
      action: z.string().max(100).optional(), outcome: z.enum(['success', 'failure', 'accepted', 'info']).optional(),
      resourceType: z.string().max(50).optional(), resourceId: z.string().max(100).optional(), search: z.string().trim().max(200).optional(),
      status: z.string().max(30).optional(), type: z.string().max(30).optional(),
    }).parse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (input.kind === 'jobs') return data(c, await sync.listJobs(input));
    return data(c, await db.read((state) => {
      const search = input.search?.toLowerCase();
      const usernames = new Map(state.users.map((user) => [user.id, user.username]));
      const rows = state.audit_logs.filter((row) => (!input.action || row.action === input.action) && (!input.outcome || row.outcome === input.outcome)
        && (!input.resourceType || row.resource_type === input.resourceType) && (!input.resourceId || row.resource_id === input.resourceId)
        && (!search || `${row.action} ${row.resource_id ?? ''}`.toLowerCase().includes(search)))
        .sort((left, right) => right.created_at.localeCompare(left.created_at));
      const offset = (input.page - 1) * input.limit;
      return {
        items: rows.slice(offset, offset + input.limit).map((row) => ({
          id: String(row.id), userId: row.user_id, username: row.user_id ? usernames.get(row.user_id) ?? null : null,
          action: row.action, resourceType: row.resource_type, resourceId: row.resource_id, outcome: row.outcome,
          requestId: row.request_id, ipAddress: row.ip_address, userAgent: row.user_agent, details: row.details, createdAt: row.created_at,
        })),
        pagination: { page: input.page, limit: input.limit, total: rows.length, pages: Math.max(1, Math.ceil(rows.length / input.limit)) },
      };
    }));
  });

  app.get('/api/users', async (c) => data(c, await users.listClients()));
  app.get('/api/users/options/servers', async (c) => data(c, await db.read((state) => {
    const active = new Set(state.token_server_memberships.filter((row) => row.active).map((row) => row.server_uuid));
    return state.servers.filter((server) => active.has(server.uuid)).map((server) => ({ uuid: server.uuid, title: server.title, hostname: server.hostname, state: server.state, zone: server.zone }));
  })));
  app.post('/api/users', async (c) => {
    const input = await body(c, z.object({ username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/), password }));
    const user = await users.createClient(input);
    await audit(c, services, { action: 'client.create', resourceType: 'user', resourceId: user.id, outcome: 'success', details: { username: user.username } });
    return data(c, user, 201);
  });
  app.patch('/api/users/:id', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const input = await body(c, z.object({ password: password.optional(), disabled: z.boolean().optional() }));
    const user = await users.updateClient(id, input);
    await audit(c, services, { action: 'client.update', resourceType: 'user', resourceId: id, outcome: 'success', details: { passwordChanged: Boolean(input.password), disabled: input.disabled } });
    return data(c, user);
  });
  app.put('/api/users/:id/access', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const input = await body(c, z.object({ access: z.array(z.object({ serverUuid: uuid, expiresAt: z.string().datetime({ offset: true }).nullable() })).max(10000) }));
    const user = await users.replaceAccess(id, input.access);
    await audit(c, services, { action: 'client.access_update', resourceType: 'user', resourceId: id, outcome: 'success', details: { assignments: input.access } });
    return data(c, user);
  });

  app.get('/api/backup', async (c) => {
    const snapshot = await db.read((state) => ({ ...state, sessions: [] }));
    await audit(c, services, { action: 'backup.download', resourceType: 'system', outcome: 'success' });
    const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    c.header('Content-Type', 'application/json; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="cerdasnet-${stamp}.json"`);
    c.header('Cache-Control', 'no-store');
    return c.body(`${JSON.stringify(snapshot, null, 2)}\n`);
  });

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } }, 404));
  app.onError((error, c) => {
    if (error instanceof ZodError) return c.json({ error: { code: 'BAD_REQUEST', message: 'Input tidak valid.', fields: error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } }, 400);
    if (error instanceof AppError) {
      const status = error.code === 'UPCLOUD_AUTH_FAILED' ? 422 : error.status;
      return c.json({ error: { code: error.code, message: error.message } }, status as any);
    }
    console.error('Worker API error', error instanceof Error ? error.message : 'Unknown error');
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan internal.' } }, 500);
  });
  return app;
}
