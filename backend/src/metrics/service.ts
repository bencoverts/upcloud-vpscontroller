import type { Database } from '../db/index.js';
import type { DatabaseData, MetricRecord } from '../db/types.js';
import { AppError, sanitizeUpstreamMessage } from '../lib/errors.js';
import { parseMetricValue } from '../upcloud/normalize.js';
import type { UpCloudStatsSummary } from '../upcloud/types.js';
import { TokenService } from '../tokens/service.js';
import { SettingsService } from '../settings/service.js';

export type MetricRange = '15m' | '1h' | '6h' | '24h' | '7d';
const rangeMilliseconds: Record<MetricRange, number> = {
  '15m': 15 * 60_000, '1h': 60 * 60_000, '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000, '7d': 7 * 24 * 60 * 60_000,
};

function latestRecord(data: DatabaseData, serverUuid: string): MetricRecord | undefined {
  return data.server_metrics
    .filter((row) => row.server_uuid === serverUuid)
    .sort((left, right) => right.sampled_at.localeCompare(left.sampled_at) || Number(right.id) - Number(left.id))[0];
}

function metricDto(row: MetricRecord) {
  return {
    sampledAt: row.sampled_at, sourcePeriod: row.source_period,
    cpuPercent: row.cpu_percent === null ? null : Number(row.cpu_percent),
    diskReadBytesPerSecond: row.disk_read_bytes_per_second === null ? null : Number(row.disk_read_bytes_per_second),
    diskWriteBytesPerSecond: row.disk_write_bytes_per_second === null ? null : Number(row.disk_write_bytes_per_second),
    networkInBitsPerSecond: row.network_in_bits_per_second === null ? null : Number(row.network_in_bits_per_second),
    networkOutBitsPerSecond: row.network_out_bits_per_second === null ? null : Number(row.network_out_bits_per_second),
    rawSummary: row.raw_summary,
  };
}

function variable(stats: UpCloudStatsSummary | null, title: string) {
  return stats?.variables.find((item) => item.title.toLowerCase() === title.toLowerCase()) ?? null;
}

export class MetricsService {
  private readonly pending = new Map<string, Promise<{ sample: ReturnType<typeof metricDto>; cached: boolean; partial: boolean }>>();
  constructor(private readonly db: Database, private readonly tokens: TokenService, private readonly settings: SettingsService) {}

  async latest(serverUuid: string): Promise<ReturnType<typeof metricDto> | null> {
    const row = await this.db.read((data) => latestRecord(data, serverUuid));
    return row ? metricDto(row) : null;
  }

  async refresh(serverUuid: string, force = false) {
    const existing = this.pending.get(serverUuid);
    if (existing) return existing;
    const task = this.performRefresh(serverUuid, force).finally(() => { this.pending.delete(serverUuid); });
    this.pending.set(serverUuid, task);
    return task;
  }

  private async performRefresh(serverUuid: string, force: boolean) {
    const settings = await this.settings.get();
    const latest = await this.db.read((data) => latestRecord(data, serverUuid));
    const freshnessSeconds = force ? Math.min(15, settings.metricsRefreshSeconds) : settings.metricsRefreshSeconds;
    if (latest && Date.now() - new Date(latest.sampled_at).getTime() < freshnessSeconds * 1000) {
      return { sample: metricDto(latest), cached: true, partial: this.hasErrors(latest) };
    }
    const token = await this.tokens.bestForServer(serverUuid);
    let client;
    try {
      client = this.tokens.gatewayFor(token);
    } catch (error) {
      await this.tokens.markError(token, error);
      throw error;
    }
    const [cpuResult, diskResult, networkResult] = await Promise.allSettled([
      client.getCpuStats(serverUuid, 'daily'), client.getDiskStats(serverUuid, 'daily'), client.getNetworkStats(serverUuid, 'daily'),
    ]);
    const failures = [cpuResult, diskResult, networkResult].flatMap((result, index) => result.status === 'rejected' ? [{
      metric: ['cpu', 'disk', 'network'][index],
      message: sanitizeUpstreamMessage(result.reason instanceof Error ? result.reason.message : 'Statistik tidak tersedia.'),
    }] : []);
    if (failures.length === 3) {
      const firstError = cpuResult.status === 'rejected' ? cpuResult.reason : new AppError(502, 'UPCLOUD_ERROR', 'Statistik tidak tersedia.');
      await this.tokens.markError(token, firstError);
      throw firstError;
    }
    const cpu = cpuResult.status === 'fulfilled' ? cpuResult.value : null;
    const disk = diskResult.status === 'fulfilled' ? diskResult.value : null;
    const network = networkResult.status === 'fulfilled' ? networkResult.value : null;
    const values = {
      cpu: parseMetricValue(variable(cpu, 'CPU usage %')?.current ?? '', 'cpu'),
      diskRead: parseMetricValue(variable(disk, 'Read')?.current ?? '', 'disk'),
      diskWrite: parseMetricValue(variable(disk, 'Write')?.current ?? '', 'disk'),
      networkIn: parseMetricValue(variable(network, 'In')?.current ?? '', 'network'),
      networkOut: parseMetricValue(variable(network, 'Out')?.current ?? '', 'network'),
    };
    const rawSummary = {
      cpu: cpu?.variables ?? [], disk: disk?.variables ?? [], network: network?.variables ?? [],
      errors: failures,
      note: 'Values retrieved from UpCloud daily summary; sampled_at is the panel retrieval time.',
    };
    return this.db.withTransaction(({ data }) => {
      if (!data.servers.some((row) => row.uuid === serverUuid)) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan.');
      const now = new Date().toISOString();
      const inserted: MetricRecord = {
        id: String(data.nextMetricId++), server_uuid: serverUuid, sampled_at: now, source_period: 'daily',
        cpu_percent: values.cpu, disk_read_bytes_per_second: values.diskRead,
        disk_write_bytes_per_second: values.diskWrite, network_in_bits_per_second: values.networkIn,
        network_out_bits_per_second: values.networkOut, raw_summary: rawSummary, created_at: now,
      };
      data.server_metrics.push(inserted);
      return { sample: metricDto(inserted), cached: false, partial: failures.length > 0 };
    });
  }

  async history(serverUuid: string, range: MetricRange) {
    const cutoff = Date.now() - rangeMilliseconds[range];
    const rows = await this.db.read((data) => data.server_metrics
      .filter((row) => row.server_uuid === serverUuid && new Date(row.sampled_at).getTime() >= cutoff)
      .sort((left, right) => left.sampled_at.localeCompare(right.sampled_at) || Number(left.id) - Number(right.id))
      .slice(0, 20_000));
    const allPoints = rows.map(metricDto);
    const points = this.downsample(allPoints, 600);
    const latest = allPoints.at(-1) ?? await this.latest(serverUuid);
    return {
      range, points, latest,
      source: {
        type: 'panel_samples', upstreamPeriod: 'daily',
        timestampMeaning: 'Waktu panel menerima summary UpCloud, bukan timestamp deret waktu per titik dari UpCloud.',
        note: 'Riwayat terbentuk dari sampel nyata yang dikumpulkan panel. Tidak ada backfill atau interpolasi untuk waktu sebelum panel mengumpulkan data.',
      },
      downsampled: points.length !== allPoints.length,
      downsamplingStrategy: points.length !== allPoints.length ? 'latest-actual-sample-per-time-bucket' : null,
      availability: this.availability(latest),
    };
  }

  private availability(latest: ReturnType<typeof metricDto> | null) {
    const upcloud = (available: boolean) => ({
      available, source: 'upcloud_api',
      reason: available ? null : 'Belum ada nilai valid dari endpoint statistik UpCloud. Server stopped, izin token, atau retensi statistik dapat memengaruhi ketersediaan.',
    });
    const agent = {
      available: false, source: 'agent_required',
      reason: 'Tidak tersedia melalui API UpCloud. Memerlukan agent di dalam VPS atau integrasi monitoring OS seperti Prometheus node_exporter.',
    };
    return {
      cpuUsage: upcloud(latest?.cpuPercent !== null && latest?.cpuPercent !== undefined),
      diskActivity: upcloud(latest?.diskReadBytesPerSecond !== null && latest?.diskReadBytesPerSecond !== undefined),
      networkTraffic: upcloud(latest?.networkInBitsPerSecond !== null && latest?.networkInBitsPerSecond !== undefined),
      memoryUsage: agent, swapUsage: agent, filesystemUsage: agent, osUptime: agent,
    };
  }

  private downsample<T extends { sampledAt: string }>(points: T[], maximum: number): T[] {
    if (points.length <= maximum) return points;
    const start = new Date(points[0]!.sampledAt).getTime();
    const end = new Date(points.at(-1)!.sampledAt).getTime();
    const bucketSize = Math.max(1, (end - start) / maximum);
    const buckets = new Map<number, T>();
    for (const point of points) {
      const bucket = Math.floor((new Date(point.sampledAt).getTime() - start) / bucketSize);
      buckets.set(bucket, point);
    }
    return [...buckets.entries()].sort(([left], [right]) => left - right).map(([, point]) => point);
  }

  private hasErrors(row: MetricRecord): boolean {
    return Array.isArray(row.raw_summary.errors) && row.raw_summary.errors.length > 0;
  }
}
