#!/usr/bin/env node
import { access } from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from './lib/json-database.mjs';

process.env.DATA_FILE = path.resolve(ROOT_DIR, process.env.DATA_FILE || path.join('data', 'database.json'));
try {
  await access(path.join(ROOT_DIR, 'backend', 'dist', 'cli', 'bootstrap-admin.js'));
} catch {
  console.error('Build output is missing. Run "npm run build" before bootstrapping the admin.');
  process.exit(1);
}
await import('../backend/dist/cli/bootstrap-admin.js');
