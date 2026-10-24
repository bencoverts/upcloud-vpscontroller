import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { AppConfig } from './config.js';
import type { Database } from './db/index.js';
import type { DatabaseData } from './db/types.js';
import type { AuthService, AuthContext } from './auth/service.js';
import type { PanelEvents, PanelEvent } from './lib/events.js';
import { hasServerAccess } from './auth/access.js';
import { sessionCookieName } from './auth/middleware.js';

function cookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    try { result[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim()); } catch { /* Ignore malformed cookie values. */ }
  }
  return result;
}

function sessionIsActive(data: DatabaseData, context: AuthContext): boolean {
  const session = data.sessions.find((row) => row.id === context.sessionId && new Date(row.expires_at).getTime() > Date.now());
  return Boolean(session && data.users.some((row) => row.id === context.user.id && !row.disabled));
}

function validOrigin(request: IncomingMessage, config: AppConfig): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    const actual = new URL(origin).origin;
    if (actual === new URL(config.appOrigin).origin) return true;
    const forwarded = config.trustProxy > 0 ? request.headers['x-forwarded-proto'] : undefined;
    const protocol = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0] ?? 'http';
    return Boolean(request.headers.host && actual === new URL(`${protocol}://${request.headers.host}`).origin);
  } catch { return false; }
}

function rejectUpgrade(socket: import('node:stream').Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachRealtimeServer(server: Server, input: {
  config: AppConfig; db: Database; auth: AuthService; events: PanelEvents;
}) {
  const { config, db, auth, events } = input;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/api/events') return;
    void (async () => {
      if (!validOrigin(request, config)) return rejectUpgrade(socket, 403, 'Forbidden');
      const token = cookies(request.headers.cookie)[sessionCookieName(config)];
      if (!token || token.length > 200) return rejectUpgrade(socket, 401, 'Unauthorized');
      const context = await auth.authenticate(token);
      if (!context) return rejectUpgrade(socket, 401, 'Unauthorized');
      wss.handleUpgrade(request, socket, head, (ws) => connect(ws, context));
    })().catch(() => rejectUpgrade(socket, 500, 'Internal Error'));
  });

  function connect(ws: WebSocket, context: AuthContext): void {
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const send = (event: PanelEvent) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: event.type, payload: event.payload }));
    };
    const unsubscribe = events.subscribe((event) => {
      void db.read((data) => {
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
        if (decision === 'close') ws.close(4001, 'Session expired or revoked');
        else if (decision === 'send') send(event);
      }).catch(() => undefined);
    });
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      void db.read((data) => sessionIsActive(data, context)).then((active) => {
        if (!active) return ws.close(4001, 'Session expired or revoked');
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }).catch(() => undefined);
    }, 25_000);
    const expiry = setTimeout(() => ws.close(4001, 'Session expired'), Math.max(1, context.expiresAt.getTime() - Date.now()));
    ws.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(expiry);
      unsubscribe();
    });
    ws.on('error', () => { /* close performs listener cleanup */ });
    send({ type: 'ready', payload: { connectedAt: new Date().toISOString(), transport: 'websocket' } });
  }

  return {
    close: () => {
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
