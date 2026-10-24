import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.DATA_FILE = path.resolve(root, process.env.DATA_FILE || path.join('data', 'database.json'));
process.env.FRONTEND_DIST = path.resolve(root, process.env.FRONTEND_DIST || path.join('frontend', 'dist'));
process.env.APP_ORIGIN ||= `http://localhost:${process.env.PORT || '3000'}`;

try {
  await access(path.join(root, 'backend', 'dist', 'index.js'));
  await access(path.join(process.env.FRONTEND_DIST, 'index.html'));
} catch {
  console.error('Build output is missing. Run "npm run build" before "node server.js".');
  process.exit(1);
}

await import('./backend/dist/index.js');
