import { randomUUID } from 'node:crypto';
import { access, chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { assertDatabaseData, migrateDatabaseData, createEmptyDatabase } from './types.js';
import type { DatabaseData } from './types.js';

export type DatabaseTransaction = { data: DatabaseData };

export interface Database {
  read<T>(reader: (data: DatabaseData) => T | Promise<T>): Promise<T>;
  withTransaction<T>(callback: (transaction: DatabaseTransaction) => T | Promise<T>): Promise<T>;
  checkHealth(): Promise<void>;
  close(): Promise<void>;
}

function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code !== 'ESRCH'; }
}

export class JsonDatabase implements Database {
  readonly filePath: string;
  private readonly lockPath: string;
  private readonly lockToken: string;
  private state: DatabaseData;
  private tail: Promise<void> = Promise.resolve();
  private closing = false;
  private closed = false;

  private constructor(filePath: string, state: DatabaseData, lockToken: string) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
    this.state = state;
    this.lockToken = lockToken;
  }

  static async open(config: AppConfig): Promise<JsonDatabase> {
    const filePath = path.resolve(config.databasePath);
    const lockPath = `${filePath}.lock`;
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const lockToken = randomUUID();
    await acquireLock(lockPath, lockToken);
    try {
      let state: DatabaseData;
      try {
        const raw = await readFile(filePath, 'utf8');
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { throw new Error(`Invalid JSON in database file: ${filePath}`); }
        const migrated = migrateDatabaseData(parsed);
        state = migrated.data;
        if (migrated.migrated) await persistAtomic(filePath, state);
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
        state = createEmptyDatabase({
          syncIntervalSeconds: config.syncIntervalSeconds,
          serverPollSeconds: config.serverPollSeconds,
          metricsRefreshSeconds: config.metricsRefreshSeconds,
          metricsRetentionDays: config.metricsRetentionDays,
          siteName: config.siteName, siteTagline: config.siteTagline,
        });
        await persistAtomic(filePath, state);
      }
      await chmod(filePath, 0o600);
      return new JsonDatabase(filePath, state, lockToken);
    } catch (error) {
      await releaseLock(lockPath, lockToken);
      throw error;
    }
  }

  async read<T>(reader: (data: DatabaseData) => T | Promise<T>): Promise<T> {
    this.assertOpen();
    const snapshot = this.state;
    const result = await reader(snapshot);
    return structuredClone(result);
  }

  withTransaction<T>(callback: (transaction: DatabaseTransaction) => T | Promise<T>): Promise<T> {
    this.assertOpen();
    const operation = this.tail.then(async () => {
      const draft = structuredClone(this.state);
      const result = await callback({ data: draft });
      draft.updatedAt = new Date().toISOString();
      assertDatabaseData(draft);
      await persistAtomic(this.filePath, draft);
      this.state = draft;
      return structuredClone(result);
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async checkHealth(): Promise<void> {
    this.assertOpen();
    await access(this.filePath);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closing = true;
    await this.tail;
    this.closed = true;
    await releaseLock(this.lockPath, this.lockToken);
  }

  private assertOpen(): void {
    if (this.closing || this.closed) throw new Error('JSON database is closed.');
  }
}

export async function createDatabase(config: AppConfig): Promise<JsonDatabase> {
  return JsonDatabase.open(config);
}

async function acquireLock(lockPath: string, token: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() })}\n`, 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      return;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      let lock: { pid?: number };
      try { lock = JSON.parse(await readFile(lockPath, 'utf8')); } catch {
        throw new Error(`Database lock is unreadable: ${lockPath}. Stop other panel processes and inspect the lock file.`);
      }
      if (processIsRunning(Number(lock.pid))) {
        throw new Error(`Database is already in use by PID ${lock.pid}. Run only one PM2 process for this JSON file.`);
      }
      await rm(lockPath, { force: true });
    }
  }
  throw new Error(`Unable to acquire database lock: ${lockPath}`);
}

async function releaseLock(lockPath: string, token: string): Promise<void> {
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { token?: string };
    if (lock.token === token) await rm(lockPath, { force: true });
  } catch (error: any) {
    if (error?.code !== 'ENOENT') return;
  }
}

async function persistAtomic(filePath: string, data: DatabaseData): Promise<void> {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
    try {
      const directoryHandle = await open(directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch { /* Directory fsync is not available on every supported filesystem. */ }
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}
