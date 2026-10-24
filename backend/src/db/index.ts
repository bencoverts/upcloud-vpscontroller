import pg from 'pg';
import type { AppConfig } from '../config.js';

export type QueryResult<T> = { rows: T[]; rowCount: number };
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
  exec?(sql: string): Promise<void>;
}
export interface Database extends Queryable {
  withTransaction<T>(callback: (query: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PgQueryable implements Queryable {
  constructor(private readonly client: pg.Pool | pg.PoolClient) {}
  async query<T>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.client.query(text, values as unknown[]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }
  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }
}

export class PgDatabase extends PgQueryable implements Database {
  constructor(private readonly pool: pg.Pool) {
    super(pool);
  }

  async withTransaction<T>(callback: (query: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const queryable = new PgQueryable(client);
    try {
      await queryable.query('BEGIN');
      const result = await callback(queryable);
      await queryable.query('COMMIT');
      return result;
    } catch (error) {
      await queryable.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createDatabase(config: AppConfig): Database {
  const pool = new pg.Pool(
    config.databaseUrl
      ? { connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 }
      : {
          host: config.pg.host,
          port: config.pg.port,
          database: config.pg.database,
          user: config.pg.user,
          password: config.pg.password,
          ssl: config.pg.ssl ? { rejectUnauthorized: true } : undefined,
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
        },
  );
  pool.on('error', () => {
    // Request handlers surface database errors through the health endpoint and error middleware.
  });
  return new PgDatabase(pool);
}
