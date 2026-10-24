import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './index.js';

const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function runMigrations(db: Database): Promise<string[]> {
  const files = (await readdir(migrationsDirectory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  return db.withTransaction(async (query) => {
    await query.query('SELECT pg_advisory_xact_lock($1)', [841_927_001]);
    await query.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = await query.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const appliedNames = new Set(applied.rows.map((row) => row.filename));
    const completed: string[] = [];
    for (const filename of files) {
      if (appliedNames.has(filename)) continue;
      const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8');
      if (query.exec) await query.exec(sql);
      else await query.query(sql);
      await query.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [filename]);
      completed.push(filename);
    }
    return completed;
  });
}
