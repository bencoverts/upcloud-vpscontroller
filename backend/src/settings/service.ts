import type { Database } from '../db/index.js';
import type { AppConfig } from '../config.js';

export type PanelSettings = {
  syncIntervalSeconds: number;
  serverPollSeconds: number;
  metricsRefreshSeconds: number;
  metricsRetentionDays: number;
};

export class SettingsService {
  constructor(private readonly db: Database, private readonly config: AppConfig) {}
  async get(): Promise<PanelSettings> {
    const result = await this.db.query<{ key: keyof PanelSettings; value: number | string }>('SELECT key,value FROM app_settings');
    const values = new Map(result.rows.map((row) => [row.key, Number(row.value)]));
    return {
      syncIntervalSeconds: values.get('syncIntervalSeconds') ?? this.config.syncIntervalSeconds,
      serverPollSeconds: values.get('serverPollSeconds') ?? this.config.serverPollSeconds,
      metricsRefreshSeconds: values.get('metricsRefreshSeconds') ?? this.config.metricsRefreshSeconds,
      metricsRetentionDays: values.get('metricsRetentionDays') ?? this.config.metricsRetentionDays,
    };
  }
  async update(input: PanelSettings): Promise<PanelSettings> {
    await this.db.withTransaction(async (query) => {
      for (const [key, value] of Object.entries(input)) {
        await query.query(
          'INSERT INTO app_settings(key,value,updated_at) VALUES ($1,$2::jsonb,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',
          [key, JSON.stringify(value)],
        );
      }
    });
    return this.get();
  }
}
