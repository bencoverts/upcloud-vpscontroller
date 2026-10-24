import type { AppConfig } from './config.js';
import type { Database } from './db/index.js';
import { PanelEvents } from './lib/events.js';
import { TokenCipher } from './lib/crypto.js';
import { createUpCloudFactory } from './upcloud/factory.js';
import type { UpCloudGatewayFactory } from './upcloud/factory.js';
import { TokenService } from './tokens/service.js';
import { SyncService } from './sync/service.js';
import { MetricsService } from './metrics/service.js';
import { AgentService } from './metrics/agent.js';
import { SettingsService } from './settings/service.js';
import { AuthService } from './auth/service.js';
import { UserService } from './users/service.js';

export function createServices(input: {
  config: AppConfig;
  db: Database;
  upcloudFactory?: UpCloudGatewayFactory;
  events?: PanelEvents;
  scheduleTask?: (task: () => Promise<void>) => void;
  logger?: { error: (details: { err: unknown }, message: string) => void };
}) {
  const { config, db } = input;
  const events = input.events ?? new PanelEvents();
  const cipher = new TokenCipher(config.tokenEncryptionKey);
  const upcloudFactory = input.upcloudFactory ?? createUpCloudFactory(config);
  const tokens = new TokenService(db, cipher, upcloudFactory);
  const sync = new SyncService(db, tokens, config, events, input.logger, input.scheduleTask);
  const settings = new SettingsService(db, config);
  const metrics = new MetricsService(db, tokens, settings, events);
  const agents = new AgentService(db, metrics);
  const auth = new AuthService(db, config);
  const users = new UserService(db, events);
  return { config, db, events, cipher, tokens, sync, settings, metrics, agents, auth, users };
}

export type ApplicationServices = ReturnType<typeof createServices>;
