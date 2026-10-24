import type { Database, DatabaseTransaction } from '../../backend/src/db/index.js';
import type { AppConfig } from '../../backend/src/config.js';
import { assertDatabaseData, createEmptyDatabase, migrateDatabaseData } from '../../backend/src/db/types.js';
import type { DatabaseData } from '../../backend/src/db/types.js';

const OBJECT_KEY = 'database.json';

export class DurableObjectDatabase implements Database {
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private constructor(private readonly bucket: R2Bucket, private data: DatabaseData) {}

  static async open(bucket: R2Bucket, config: AppConfig): Promise<DurableObjectDatabase> {
    const object = await bucket.get(OBJECT_KEY);
    let data: DatabaseData;
    if (object) {
      let parsed: unknown;
      try { parsed = JSON.parse(await object.text()); } catch { throw new Error('R2 contains invalid panel JSON.'); }
      const migrated = migrateDatabaseData(parsed);
      data = migrated.data;
      if (migrated.migrated) await bucket.put(OBJECT_KEY, `${JSON.stringify(data, null, 2)}\n`);
    } else {
      data = createEmptyDatabase({
        syncIntervalSeconds: config.syncIntervalSeconds, serverPollSeconds: config.serverPollSeconds,
        metricsRefreshSeconds: config.metricsRefreshSeconds, metricsRetentionDays: config.metricsRetentionDays,
        siteName: config.siteName, siteTagline: config.siteTagline,
      });
      await bucket.put(OBJECT_KEY, `${JSON.stringify(data, null, 2)}\n`);
    }
    return new DurableObjectDatabase(bucket, data);
  }

  async read<T>(reader: (data: DatabaseData) => T | Promise<T>): Promise<T> {
    this.assertOpen();
    return structuredClone(await reader(this.data));
  }

  withTransaction<T>(callback: (transaction: DatabaseTransaction) => T | Promise<T>): Promise<T> {
    this.assertOpen();
    const operation = this.tail.then(async () => {
      const draft = structuredClone(this.data);
      const result = await callback({ data: draft });
      draft.updatedAt = new Date().toISOString();
      assertDatabaseData(draft);
      await this.bucket.put(OBJECT_KEY, `${JSON.stringify(draft, null, 2)}\n`);
      this.data = draft;
      return structuredClone(result);
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async checkHealth(): Promise<void> {
    this.assertOpen();
    if (!await this.bucket.head(OBJECT_KEY)) throw new Error('Panel JSON is unavailable in R2.');
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.tail;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Durable Object database is closed.');
  }
}
