import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { AppConfig } from './config.js';
import type { Database } from './db/index.js';
import { createHttpLogger, createLogger } from './lib/logger.js';
import { createServices } from './services.js';
import type { UpCloudGatewayFactory } from './upcloud/factory.js';
import { originGuard, requireAdmin, requireAuth, requireCsrf } from './auth/middleware.js';
import { authRoutes } from './auth/routes.js';
import { tokenRoutes } from './tokens/routes.js';
import { serverRoutes } from './servers/routes.js';
import { syncRoutes } from './sync/routes.js';
import { settingsRoutes } from './settings/routes.js';
import { activityRoutes } from './activity/routes.js';
import { dashboardRoutes } from './dashboard/routes.js';
import { userRoutes } from './users/routes.js';
import { backupRoutes } from './backup/routes.js';
import { agentRoutes } from './metrics/routes.js';
import { errorHandler, notFoundHandler } from './http/error.js';

export function createApplication(input: { config: AppConfig; db: Database; upcloudFactory?: UpCloudGatewayFactory }) {
  const { config, db } = input;
  const logger = createLogger(config);
  const services = createServices({ config, db, upcloudFactory: input.upcloudFactory, logger });
  const { tokens, sync, settings, metrics, agents, auth, users } = services;

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
  api.use('/agent', agentRoutes(agents));
  api.use(requireAuth(auth, config));
  api.use(requireCsrf);
  api.use('/dashboard', dashboardRoutes(db));
  api.use('/tokens', requireAdmin, tokenRoutes(db, tokens, sync));
  api.use('/servers', serverRoutes(db, sync, metrics, agents));
  api.use('/sync', syncRoutes(db, sync));
  api.use('/settings', settingsRoutes(db, settings));
  api.use('/activity', requireAdmin, activityRoutes(db, sync));
  api.use('/users', requireAdmin, userRoutes(db, users));
  api.use('/backup', requireAdmin, backupRoutes(db));
  api.get('/events', (_req, res) => {
    res.status(426).json({ error: { code: 'WEBSOCKET_REQUIRED', message: 'Gunakan WebSocket untuk realtime event.' } });
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
  return { app, services: { ...services, logger } };
}
