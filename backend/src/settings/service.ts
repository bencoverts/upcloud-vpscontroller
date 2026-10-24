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
    return this.db.read((data) => {
      const values = new Map(data.app_settings.map((row) => [row.key, Number(row.value)]));
      return {
        syncIntervalSeconds: values.get('syncIntervalSeconds') ?? this.config.syncIntervalSeconds,
        serverPollSeconds: values.get('serverPollSeconds') ?? this.config.serverPollSeconds,
        metricsRefreshSeconds: values.get('metricsRefreshSeconds') ?? this.config.metricsRefreshSeconds,
        metricsRetentionDays: values.get('metricsRetentionDays') ?? this.config.metricsRetentionDays,
      };
    });
  }

  async update(input: PanelSettings): Promise<PanelSettings> {
    await this.db.withTransaction(({ data }) => {
      for (const [key, value] of Object.entries(input)) {
        const current = data.app_settings.find((row) => row.key === key);
        if (current) {
          current.value = value;
          current.updated_at = new Date().toISOString();
        } else data.app_settings.push({ key, value, updated_at: new Date().toISOString() });
      }
    });
    return this.get();
  }
}
