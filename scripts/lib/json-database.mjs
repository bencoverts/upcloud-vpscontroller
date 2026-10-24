import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
export const databaseFile = path.resolve(ROOT_DIR, process.env.DATA_FILE || 'data/database.json');

const baseCollections = [
  'users', 'sessions', 'api_tokens', 'servers', 'token_server_memberships', 'token_server_groups',
  'server_storage', 'server_networks', 'server_metrics', 'sync_jobs', 'audit_logs', 'app_settings',
];
const v2Collections = [...baseCollections.slice(0, 2), 'client_server_access', 'server_agents', ...baseCollections.slice(2)];
const v3Collections = [
  ...v2Collections.slice(0, 5), 'panel_api_keys', 'oauth_identities', 'oauth_states',
  'proxmox_connections', 'proxmox_resources', ...v2Collections.slice(5),
];
const v4Collections = [
  ...v3Collections.slice(0, 10), 'provider_connections', 'provider_resources',
  'direct_login_tokens', ...v3Collections.slice(10),
];

export function validateDatabase(value, source = 'JSON database') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${source} must contain an object.`);
  if (![1, 2, 3, 4].includes(value.schemaVersion)) throw new Error(`${source} has an unsupported schemaVersion.`);
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') throw new Error(`${source} timestamps are missing.`);
  if (!Number.isInteger(value.nextMetricId) || value.nextMetricId < 1
    || !Number.isInteger(value.nextAuditId) || value.nextAuditId < 1) throw new Error(`${source} ID counters are invalid.`);
  const collections = value.schemaVersion === 4 ? v4Collections
    : value.schemaVersion === 3 ? v3Collections : value.schemaVersion === 2 ? v2Collections : baseCollections;
  for (const name of collections) {
    if (!Array.isArray(value[name])) throw new Error(`${source} collection ${name} must be an array.`);
  }
  return value;
}

export async function readDatabase(filePath = databaseFile) {
  const raw = await readFile(filePath, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`Invalid JSON in ${filePath}.`); }
  validateDatabase(data, filePath);
  return { data, raw };
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function writeFileAtomic(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}

export async function acquireDatabaseLock(filePath = databaseFile) {
  const lockPath = `${filePath}.lock`;
  const token = randomUUID();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, token, purpose: 'restore' })}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      return async () => {
        try {
          const current = JSON.parse(await readFile(lockPath, 'utf8'));
          if (current.token === token) await rm(lockPath, { force: true });
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (error?.code !== 'EEXIST') throw error;
      let lock;
      try { lock = JSON.parse(await readFile(lockPath, 'utf8')); } catch {
        throw new Error(`Database lock cannot be verified: ${lockPath}`);
      }
      const pid = Number(lock.pid);
      let running = false;
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); running = true; } catch (killError) { running = killError?.code !== 'ESRCH'; }
      }
      if (running) throw new Error(`Refusing restore: database is still in use by PID ${pid}. Stop the panel/PM2 process first.`);
      await rm(lockPath, { force: true });
    }
  }
  throw new Error(`Unable to acquire database lock: ${lockPath}`);
}
