import { loadConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { bootstrapAdmin } from '../auth/service.js';

const config = loadConfig();
if (!config.adminUsername || !config.adminPassword) {
  throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (minimum 12 characters) for this one-time bootstrap command.');
}
const db = createDatabase(config);
try {
  await runMigrations(db);
  const user = await bootstrapAdmin(db, config.adminUsername, config.adminPassword);
  console.log(JSON.stringify({ status: 'created', username: user.username, role: user.role }));
  console.log('Remove ADMIN_PASSWORD from the environment and your .env file now.');
} finally {
  await db.close();
}
