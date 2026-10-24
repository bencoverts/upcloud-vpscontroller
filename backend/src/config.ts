import path from 'node:path';
import { z } from 'zod';

const integer = (fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : Number(value)),
    z.number().int().min(min).max(max),
  );

const boolean = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') return fallback;
    return value === true || value === 'true' || value === '1';
  }, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: integer(3000, 1, 65535),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  SITE_NAME: z.string().trim().min(1).max(80).default('CerdasNet'),
  SITE_TAGLINE: z.string().trim().min(1).max(120).default('VPS Control'),
  FRONTEND_DIST: z.string().optional(),
  DATA_FILE: z.string().min(1).default(path.join(process.cwd(), 'data', 'database.json')),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  COOKIE_SECURE: boolean(process.env.NODE_ENV === 'production'),
  TRUST_PROXY: integer(1, 0, 10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SESSION_TTL_HOURS: integer(12, 1, 168),
  UPCLOUD_TIMEOUT_MS: integer(15_000, 1_000, 60_000),
  UPCLOUD_RETRY_BASE_MS: integer(300, 1, 10_000),
  UPCLOUD_DETAILS_CACHE_SECONDS: integer(60, 0, 3600),
  SYNC_INTERVAL_SECONDS: integer(300, 60, 86_400),
  SERVER_POLL_SECONDS: integer(30, 5, 3600),
  METRICS_REFRESH_SECONDS: integer(300, 60, 3600),
  METRICS_RETENTION_DAYS: integer(30, 1, 365),
  CONTROL_VERIFY_TIMEOUT_MS: integer(120_000, 1_000, 600_000),
  CONTROL_VERIFY_INTERVAL_MS: integer(2_000, 100, 30_000),
  AUTO_SYNC_ON_BOOT: boolean(true),
  ADMIN_USERNAME: z.string().min(3).max(64).optional(),
  ADMIN_PASSWORD: z.string().min(12).max(256).optional(),
  GOOGLE_CLIENT_ID: z.string().max(300).optional(),
  GOOGLE_CLIENT_SECRET: z.string().max(300).optional(),
  SMTP_HOST: z.string().max(255).optional(),
  SMTP_PORT: integer(587, 1, 65535),
  SMTP_SECURE: boolean(false),
  SMTP_USERNAME: z.string().max(320).optional(),
  SMTP_PASSWORD: z.string().max(512).optional(),
  SMTP_FROM: z.string().max(320).optional(),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  appOrigin: string;
  siteName: string;
  siteTagline: string;
  frontendDist?: string;
  databasePath: string;
  tokenEncryptionKey: string;
  cookieSecure: boolean;
  trustProxy: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  sessionTtlHours: number;
  upcloudTimeoutMs: number;
  upcloudRetryBaseMs: number;
  upcloudDetailsCacheSeconds: number;
  syncIntervalSeconds: number;
  serverPollSeconds: number;
  metricsRefreshSeconds: number;
  metricsRetentionDays: number;
  controlVerifyTimeoutMs: number;
  controlVerifyIntervalMs: number;
  autoSyncOnBoot: boolean;
  adminUsername?: string;
  adminPassword?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  smtpHost?: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpFrom?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const origin = new URL(parsed.APP_ORIGIN);
  if (parsed.NODE_ENV === 'production' && origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) {
    throw new Error('APP_ORIGIN must use HTTPS in production.');
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    appOrigin: parsed.APP_ORIGIN.replace(/\/$/, ''),
    siteName: parsed.SITE_NAME,
    siteTagline: parsed.SITE_TAGLINE,
    frontendDist: parsed.FRONTEND_DIST,
    databasePath: path.resolve(parsed.DATA_FILE),
    tokenEncryptionKey: parsed.TOKEN_ENCRYPTION_KEY,
    cookieSecure: parsed.COOKIE_SECURE,
    trustProxy: parsed.TRUST_PROXY,
    logLevel: parsed.LOG_LEVEL,
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    upcloudTimeoutMs: parsed.UPCLOUD_TIMEOUT_MS,
    upcloudRetryBaseMs: parsed.UPCLOUD_RETRY_BASE_MS,
    upcloudDetailsCacheSeconds: parsed.UPCLOUD_DETAILS_CACHE_SECONDS,
    syncIntervalSeconds: parsed.SYNC_INTERVAL_SECONDS,
    serverPollSeconds: parsed.SERVER_POLL_SECONDS,
    metricsRefreshSeconds: parsed.METRICS_REFRESH_SECONDS,
    metricsRetentionDays: parsed.METRICS_RETENTION_DAYS,
    controlVerifyTimeoutMs: parsed.CONTROL_VERIFY_TIMEOUT_MS,
    controlVerifyIntervalMs: parsed.CONTROL_VERIFY_INTERVAL_MS,
    autoSyncOnBoot: parsed.AUTO_SYNC_ON_BOOT,
    adminUsername: parsed.ADMIN_USERNAME,
    adminPassword: parsed.ADMIN_PASSWORD,
    googleClientId: parsed.GOOGLE_CLIENT_ID,
    googleClientSecret: parsed.GOOGLE_CLIENT_SECRET,
    smtpHost: parsed.SMTP_HOST,
    smtpPort: parsed.SMTP_PORT,
    smtpSecure: parsed.SMTP_SECURE,
    smtpUsername: parsed.SMTP_USERNAME,
    smtpPassword: parsed.SMTP_PASSWORD,
    smtpFrom: parsed.SMTP_FROM,
  };
}
