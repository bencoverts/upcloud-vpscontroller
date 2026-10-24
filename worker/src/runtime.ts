import type { AppConfig } from '../../backend/src/config.js';

export interface WorkerEnv {
  PANEL: DurableObjectNamespace;
  DATA: R2Bucket;
  ASSETS: Fetcher;
  TOKEN_ENCRYPTION_KEY?: string;
  BOOTSTRAP_SECRET?: string;
  APP_ORIGIN?: string;
  SITE_NAME?: string;
  SITE_TAGLINE?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  COOKIE_SECURE?: string;
  SESSION_TTL_HOURS?: string;
  SYNC_INTERVAL_SECONDS?: string;
  SERVER_POLL_SECONDS?: string;
  METRICS_REFRESH_SECONDS?: string;
  METRICS_RETENTION_DAYS?: string;
  UPCLOUD_TIMEOUT_MS?: string;
  UPCLOUD_RETRY_BASE_MS?: string;
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`Worker numeric configuration must be ${minimum}–${maximum}.`);
  return parsed;
}

export function workerConfig(env: WorkerEnv): AppConfig {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error('TOKEN_ENCRYPTION_KEY secret is required.');
  const origin = new URL(env.APP_ORIGIN ?? 'http://localhost:8787');
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) {
    throw new Error('APP_ORIGIN must use HTTPS in Workers production.');
  }
  return {
    nodeEnv: 'production', port: 0, appOrigin: origin.origin, siteName: env.SITE_NAME?.slice(0, 80) || 'CerdasNet', siteTagline: env.SITE_TAGLINE?.slice(0, 120) || 'VPS Control',
    databasePath: 'r2://panel/database.json', tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
    cookieSecure: env.COOKIE_SECURE !== 'false', trustProxy: 0, logLevel: 'info',
    sessionTtlHours: integer(env.SESSION_TTL_HOURS, 12, 1, 168),
    upcloudTimeoutMs: integer(env.UPCLOUD_TIMEOUT_MS, 15_000, 1000, 60_000),
    upcloudRetryBaseMs: integer(env.UPCLOUD_RETRY_BASE_MS, 300, 1, 10_000),
    upcloudDetailsCacheSeconds: 60,
    syncIntervalSeconds: integer(env.SYNC_INTERVAL_SECONDS, 300, 60, 86_400),
    serverPollSeconds: integer(env.SERVER_POLL_SECONDS, 30, 5, 3600),
    metricsRefreshSeconds: integer(env.METRICS_REFRESH_SECONDS, 300, 60, 3600),
    metricsRetentionDays: integer(env.METRICS_RETENTION_DAYS, 30, 1, 365),
    controlVerifyTimeoutMs: 120_000, controlVerifyIntervalMs: 2000, autoSyncOnBoot: false,
    smtpHost: env.SMTP_HOST, smtpPort: integer(env.SMTP_PORT, 587, 1, 65535), smtpSecure: env.SMTP_SECURE === 'true',
    smtpUsername: env.SMTP_USERNAME, smtpPassword: env.SMTP_PASSWORD, smtpFrom: env.SMTP_FROM,
    googleClientId: env.GOOGLE_CLIENT_ID, googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}
