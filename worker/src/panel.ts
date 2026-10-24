import { DurableObject } from 'cloudflare:workers';
import type { ApplicationServices } from '../../backend/src/services.js';
import { createServices } from '../../backend/src/services.js';
import type { AuthContext } from '../../backend/src/auth/service.js';
import { hasServerAccess } from '../../backend/src/auth/access.js';
import { hashOpaqueToken } from '../../backend/src/lib/crypto.js';
import type { PanelEvent } from '../../backend/src/lib/events.js';
import type { DatabaseData } from '../../backend/src/db/types.js';
import { DurableObjectDatabase } from './database.js';
import { createWorkerApi } from './api.js';
import { workerConfig } from './runtime.js';
import type { WorkerEnv } from './runtime.js';

type SocketRecord = { context: AuthContext; expiry: ReturnType<typeof setTimeout> };
type RateBucket = { startedAt: number; count: number };

function sessionIsActive(data: DatabaseData, context: AuthContext): boolean {
  const session = data.sessions.find((row) => row.id === context.sessionId && new Date(row.expires_at).getTime() > Date.now());
  return Boolean(session && data.users.some((row) => row.id === context.user.id && !row.disabled));
}

export class PanelDurableObject extends DurableObject<WorkerEnv> {
  private services?: ApplicationServices;
  private api?: ReturnType<typeof createWorkerApi>;
  private readonly sockets = new Map<WebSocket, SocketRecord>();
  private readonly rateBuckets = new Map<string, RateBucket>();
  private loginTail: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;
  private lastScheduled = 0;
  private lastCleanup = 0;

  constructor(state: DurableObjectState, env: WorkerEnv) {
    super(state, env);
    this.ready = this.ctx.blockConcurrencyWhile(() => this.initialize());
  }

  private async initialize(): Promise<void> {
    const config = workerConfig(this.env);
    const db = await DurableObjectDatabase.open(this.env.DATA, config);
    this.services = createServices({
      config, db,
      scheduleTask: (task) => this.ctx.waitUntil(task()),
      logger: { error: (_details, message) => console.error(message) },
    });
    this.services.events.subscribe((event) => this.broadcast(event));
    await this.services.sync.recoverInterruptedJobs();
    this.api = createWorkerApi(this.services, this.env, {
      allowLogin: (ip) => this.allowLogin(ip),
      websocket: (c) => this.connectWebSocket(c),
    });
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + 30_000);
    setInterval(() => {
      for (const [socket, record] of this.sockets) {
        void this.services!.db.read((data) => sessionIsActive(data, record.context)).then((active) => {
          if (!active) return socket.close(4001, 'Session expired or revoked');
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat', payload: { at: new Date().toISOString() } }));
        }).catch(() => undefined);
      }
    }, 25_000);
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (new URL(request.url).pathname.startsWith('/api/') && !this.allowApi(ip)) {
      return Response.json({ error: { code: 'RATE_LIMITED', message: 'Terlalu banyak request ke panel.' } }, { status: 429 });
    }
    return this.api!.fetch(request, this.env);
  }

  async alarm(): Promise<void> {
    await this.ready;
    const services = this.services!;
    const settings = await services.settings.get();
    if (Date.now() - this.lastScheduled >= settings.syncIntervalSeconds * 1000) {
      this.lastScheduled = Date.now();
      await services.sync.enqueueSyncAll(null, 'automatic');
    }
    if (Date.now() - this.lastCleanup >= 60 * 60 * 1000) {
      this.lastCleanup = Date.now();
      await services.db.withTransaction(({ data }) => {
        const now = Date.now();
        data.sessions = data.sessions.filter((row) => new Date(row.expires_at).getTime() >= now);
        const cutoff = now - settings.metricsRetentionDays * 24 * 60 * 60 * 1000;
        data.server_metrics = data.server_metrics.filter((row) => new Date(row.sampled_at).getTime() >= cutoff);
      });
    }
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  private allowApi(ip: string): boolean {
    const now = Date.now();
    const current = this.rateBuckets.get(ip);
    if (!current || now - current.startedAt >= 5 * 60_000) {
      this.rateBuckets.set(ip, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    if (this.rateBuckets.size > 5000) {
      for (const [key, bucket] of this.rateBuckets) if (now - bucket.startedAt >= 5 * 60_000) this.rateBuckets.delete(key);
    }
    return current.count <= 600;
  }

  private allowLogin(ip: string): Promise<boolean> {
    const operation = this.loginTail.then(async () => {
      const window = Math.floor(Date.now() / (15 * 60_000));
      const key = `login:${hashOpaqueToken(ip)}:${window}`;
      const count = await this.ctx.storage.get<number>(key) ?? 0;
      if (count >= 10) return false;
      await this.ctx.storage.put(key, count + 1);
      return true;
    });
    this.loginTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async connectWebSocket(c: any): Promise<Response> {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return c.json({ error: { code: 'WEBSOCKET_REQUIRED', message: 'Gunakan WebSocket untuk realtime event.' } }, 426);
    }
    const origin = c.req.header('origin');
    if (!origin || ![this.services!.config.appOrigin, new URL(c.req.url).origin].includes(new URL(origin).origin)) {
      return c.json({ error: { code: 'CSRF_INVALID', message: 'Origin WebSocket tidak diizinkan.' } }, 403);
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const context = c.get('auth') as AuthContext;
    server.accept();
    const expiry = setTimeout(() => server.close(4001, 'Session expired'), Math.max(1, context.expiresAt.getTime() - Date.now()));
    this.sockets.set(server, { context, expiry });
    const cleanup = () => {
      clearTimeout(expiry);
      this.sockets.delete(server);
    };
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);
    server.addEventListener('message', () => server.close(1003, 'Client messages are not supported'));
    server.send(JSON.stringify({ type: 'ready', payload: { connectedAt: new Date().toISOString(), transport: 'websocket' } }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(event: PanelEvent): void {
    for (const [socket, record] of this.sockets) {
      const send = () => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: event.type, payload: event.payload }));
      };
      const { context } = record;
      void this.services!.db.read((data) => {
        if (!sessionIsActive(data, context)) return 'close' as const;
        if (context.user.role === 'admin') return 'send' as const;
        if (event.type === 'access' && event.payload.userId === context.user.id) return 'send' as const;
        if (event.type === 'client' && event.payload.id === context.user.id) return 'send' as const;
        const uuid = typeof event.payload.uuid === 'string' ? event.payload.uuid
          : typeof event.payload.serverUuid === 'string' ? event.payload.serverUuid : null;
        if (!uuid || !['server', 'metric', 'job'].includes(event.type)) return 'ignore' as const;
        if (event.type === 'job' && event.payload.requestedBy !== context.user.id) return 'ignore' as const;
        return hasServerAccess(data, context.user, uuid) ? 'send' as const : 'ignore' as const;
      }).then((decision) => {
        if (decision === 'close') socket.close(4001, 'Session expired or revoked');
        else if (decision === 'send') send();
      }).catch(() => undefined);
    }
  }
}
