import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { createApplication } from './app.js';
import { SyncScheduler } from './sync/service.js';

const config = loadConfig();
const db = createDatabase(config);
await runMigrations(db);
const { app, services } = createApplication({ config, db });
const scheduler = new SyncScheduler(db, services.sync, services.settings, services.logger);
await scheduler.start(config.autoSyncOnBoot);
const server = app.listen(config.port, '0.0.0.0', () => {
  services.logger.info({ port: config.port }, 'CerdasNet VPS Control backend listening');
});
server.requestTimeout = 120_000;
server.headersTimeout = 125_000;

async function shutdown(signal: string): Promise<void> {
  services.logger.info({ signal }, 'Shutting down');
  scheduler.stop();
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
