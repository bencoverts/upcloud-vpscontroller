import { describe, expect, it } from 'vitest';
import { createHarness } from './helpers.js';
import { runMigrations } from '../db/migrate.js';

describe('database migrations', () => {
  it('creates the complete schema and is idempotent', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
      const names = new Set(result.rows.map((row) => row.table_name));
      for (const table of ['users', 'api_tokens', 'token_server_groups', 'servers', 'server_metrics',
        'server_storage', 'server_networks', 'sync_jobs', 'audit_logs', 'app_settings', 'schema_migrations']) {
        expect(names.has(table)).toBe(true);
      }
      const settings = await harness.db.query('SELECT key FROM app_settings');
      expect(settings.rowCount).toBe(4);
      const migrations = await harness.db.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename');
      expect(migrations.rows.map((row) => row.filename)).toEqual(['001_initial.sql', '002_active_job_scope.sql']);
      await expect(runMigrations(harness.db)).resolves.toEqual([]);
    } finally { await harness.close(); }
  });
});
