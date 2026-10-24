import { loadConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';

const config = loadConfig();
const db = createDatabase(config);
try {
  const applied = await runMigrations(db);
  console.log(JSON.stringify({ applied, status: 'ok' }));
} finally {
  await db.close();
}
