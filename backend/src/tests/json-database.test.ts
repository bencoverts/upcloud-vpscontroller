import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/index.js';
import { assertDatabaseData, createEmptyDatabase, migrateDatabaseData } from '../db/types.js';
import { createHarness, testConfig } from './helpers.js';

describe('local JSON database', () => {
  it('persists valid JSON and rolls back failed transactions without changing the file', async () => {
    const harness = await createHarness();
    try {
      const before = await readFile(harness.db.filePath, 'utf8');
      await expect(harness.db.withTransaction(({ data }) => {
        data.app_settings = [];
        throw new Error('intentional rollback');
      })).rejects.toThrow('intentional rollback');
      expect(await readFile(harness.db.filePath, 'utf8')).toBe(before);
      expect(await harness.db.read((data) => data.app_settings)).toHaveLength(6);
      const stored = JSON.parse(before);
      expect(stored.schemaVersion).toBe(4);
      expect(stored.users).toHaveLength(1);
      expect(stored.sessions).toHaveLength(1);
    } finally { await harness.close(); }
  });

  it('migrates schema v3 and validates provider and direct-login relations', () => {
    const legacy = structuredClone(createEmptyDatabase({})) as any;
    legacy.schemaVersion = 3;
    delete legacy.provider_connections;
    delete legacy.provider_resources;
    delete legacy.direct_login_tokens;

    const migrated = migrateDatabaseData(legacy);
    expect(migrated.migrated).toBe(true);
    expect(migrated.data.schemaVersion).toBe(4);
    expect(migrated.data.provider_connections).toEqual([]);
    expect(migrated.data.provider_resources).toEqual([]);
    expect(migrated.data.direct_login_tokens).toEqual([]);
    expect(migrated.data.schemaVersion).toBe(4);

    expect(() => assertDatabaseData({
      ...migrated.data,
      provider_resources: [{ id: 'resource-1', connection_id: 'missing', external_id: 'external-1' }],
    })).toThrow(/provider resource references a missing connection/);
    expect(() => assertDatabaseData({
      ...migrated.data,
      direct_login_tokens: [{ id: 'login-1', user_id: 'missing', created_by: 'also-missing', token_hash: 'a'.repeat(64) }],
    })).toThrow(/direct-login token references a missing user/);
  });

  it('reopens persisted data and prevents a second process from using the same file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cerdasnet-json-reopen-'));
    const config = { ...testConfig, databasePath: path.join(directory, 'database.json') };
    let db = await createDatabase(config);
    try {
      await db.withTransaction(({ data }) => {
        data.app_settings.find((row) => row.key === 'serverPollSeconds')!.value = 45;
      });
      await expect(createDatabase(config)).rejects.toThrow(/already in use/);
      await db.close();
      db = await createDatabase(config);
      const settings = new Map((await db.read((data) => data.app_settings)).map((row) => [row.key, row.value]));
      expect(settings.get('serverPollSeconds')).toBe(45);
    } finally {
      await db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects corrupted JSON instead of silently replacing it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cerdasnet-json-corrupt-'));
    const databasePath = path.join(directory, 'database.json');
    await writeFile(databasePath, '{broken-json');
    try {
      await expect(createDatabase({ ...testConfig, databasePath })).rejects.toThrow(/Invalid JSON/);
      expect(await readFile(databasePath, 'utf8')).toBe('{broken-json');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
