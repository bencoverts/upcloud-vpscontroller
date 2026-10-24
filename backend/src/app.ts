import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { AppConfig } from './config.js';
import type { Database } from './db/index.js';
import { createHttpLogger, createLogger } from './lib/logger.js';
import { TokenCipher } from './lib/crypto.js';
import { PanelEvents } from './lib/events.js';
import { createUpCloudFactory } from './upcloud/factory.js';
import type { UpCloudGatewayFactory } from './upcloud/factory.js';
import { TokenService } from './tokens/service.js';
import { SyncService } from './sync/service.js';
import { MetricsService } from './metrics/service.js';
import { SettingsService } from './settings/service.js';
import { AuthService } from './auth/service.js';
import { originGuard, requireAdminForMutations, requireAuth, requireCsrf } from './auth/middleware.js';
import { authRoutes } from './auth/routes.js';
import { tokenRoutes } from './tokens/routes.js';
import { serverRoutes } from './servers/routes.js';
import { syncRoutes } from './sync/routes.js';
import { settingsRoutes } from './settings/routes.js';
import { activityRoutes } from './activity/routes.js';
import { dashboardRoutes } from './dashboard/routes.js';
import { errorHandler, notFoundHandler } from './http/error.js';

export function createApplication(input: { config: AppConfig; db: Database; upcloudFactory?: UpCloudGatewayFactory }) {
  const { config, db } = input;
  const logger = createLogger(config);
  const events = new PanelEvents();
  const cipher = new TokenCipher(config.tokenEncryptionKey);
  const upcloudFactory = input.upcloudFactory ?? createUpCloudFactory(config);
  const tokens = new TokenService(db, cipher, upcloudFactory);
  const sync = new SyncService(db, tokens, config, events, logger);
  const settings = new SettingsService(db, config);
  const metrics = new MetricsService(db, tokens, settings);
  const auth = new AuthService(db, config);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({ crossOriginEmbedderPolicy: false }));
  app.use(createHttpLogger(config, logger));
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(cookieParser());

  app.get('/health/live', (_req, res) => { res.json({ status: 'ok' }); });
  app.get('/health/ready', async (_req, res) => {
    try {
      await db.checkHealth();
      res.json({ status: 'ready', database: 'ok', storage: 'json' });
    } catch {
      res.status(503).json({ status: 'not_ready', database: 'unavailable' });
    }
  });

  const api = express.Router();
  api.use(originGuard(config));
  api.use(rateLimit({
    windowMs: 5 * 60 * 1000, limit: config.nodeEnv === 'test' ? 10_000 : 600,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Terlalu banyak request ke panel. Coba lagi beberapa saat.' } },
  }));
  api.use('/auth', authRoutes(db, auth, config));
  api.use(requireAuth(auth, config));
  api.use(requireCsrf);
  api.use(requireAdminForMutations);
  api.use('/dashboard', dashboardRoutes(db));
  api.use('/tokens', tokenRoutes(db, tokens, sync));
  api.use('/servers', serverRoutes(db, sync, metrics));
  api.use('/sync', syncRoutes(db, sync));
  api.use('/settings', settingsRoutes(db, settings));
  api.use('/activity', activityRoutes(db, sync));
  api.get('/events', (req, res) => {
    res.status(200).set({
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
    const unsubscribe = events.subscribe((event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    });
    const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); }, 25_000);
    const sessionExpiry = setTimeout(() => { res.end(); }, Math.max(1, new Date(req.auth!.expiresAt).getTime() - Date.now()));
    req.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(sessionExpiry);
      unsubscribe();
    });
  });
  api.use(notFoundHandler);
  app.use('/api', api);
  if (config.frontendDist) {
    app.use(express.static(config.frontendDist, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${process.platform === 'win32' ? '\\' : '/'}assets${process.platform === 'win32' ? '\\' : '/'}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else res.setHeader('Cache-Control', 'public, max-age=3600');
      },
    }));
    app.get('/{*splat}', (req, res, next) => {
      if (!req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile('index.html', { root: config.frontendDist }, (error) => { if (error) next(error); });
    });
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, services: { config, db, logger, events, cipher, tokens, sync, settings, metrics, auth } };
}
