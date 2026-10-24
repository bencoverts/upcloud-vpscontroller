import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';

export function createLogger(config: AppConfig) {
  return pino({
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.authorization', 'req.headers.cookie', 'req.headers.x-csrf-token',
        'res.headers.set-cookie', '*.password', '*.token', '*.apiToken', '*.newToken',
        '*.currentPassword', '*.newPassword', '*.ciphertext', '*.authTag',
      ],
      censor: '[redacted]',
    },
  });
}

export function createHttpLogger(config: AppConfig, logger: pino.Logger) {
  return pinoHttp({
    logger,
    genReqId: () => randomUUID(),
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, error?: Error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return config.nodeEnv === 'test' ? 'silent' : 'info';
    },
    customSuccessMessage: () => 'http request',
    customErrorMessage: () => 'http request failed',
    serializers: {
      req: (req: any) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0], remoteAddress: req.remoteAddress }),
      res: (res: any) => ({ statusCode: res.statusCode }),
    },
  });
}
