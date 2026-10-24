import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { createApplication } from './app.js';
import { SyncScheduler } from './sync/service.js';
import { attachRealtimeServer } from './realtime.js';

const config = loadConfig();
const db = await createDatabase(config);
const { app, services } = createApplication({ config, db });
const scheduler = new SyncScheduler(db, services.sync, services.settings, services.logger);
await scheduler.start(config.autoSyncOnBoot);
const server = app.listen(config.port, '0.0.0.0', () => {
  services.logger.info({ port: config.port, database: db.filePath }, 'CerdasNet VPS Control listening with local JSON storage');
});
server.requestTimeout = 120_000;
server.headersTimeout = 125_000;
const realtime = attachRealtimeServer(server, services);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  services.logger.info({ signal }, 'Shutting down');
  scheduler.stop();
  realtime.close();
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
