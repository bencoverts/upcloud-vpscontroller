import type { Database } from '../db/index.js';
import type { DatabaseData, MetricRecord } from '../db/types.js';
import { AppError, sanitizeUpstreamMessage } from '../lib/errors.js';
import type { PanelEvents } from '../lib/events.js';
import { parseMetricValue } from '../upcloud/normalize.js';
import type { UpCloudStatsSummary } from '../upcloud/types.js';
import { TokenService } from '../tokens/service.js';
import { SettingsService } from '../settings/service.js';

export type MetricRange = '15m' | '1h' | '6h' | '24h' | '7d';
export type AgentMetricInput = {
  filesystemUsedBytes: number; filesystemTotalBytes: number; filesystemCount: number;
  memoryUsedBytes: number | null; memoryTotalBytes: number | null;
  swapUsedBytes: number | null; swapTotalBytes: number | null; osUptimeSeconds: number | null;
  load1?: number | null; load5?: number | null; load15?: number | null; processCount?: number | null;
  filesystems?: Array<{ source: string; mount: string; totalBytes: number; usedBytes: number }>;
  osName?: string | null; agentVersion?: string;
};
const rangeMilliseconds: Record<MetricRange, number> = {
  '15m': 15 * 60_000, '1h': 60 * 60_000, '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000, '7d': 7 * 24 * 60 * 60_000,
};
const sampleFields = ['cpuPercent', 'diskReadBytesPerSecond', 'diskWriteBytesPerSecond',
  'networkInBitsPerSecond', 'networkOutBitsPerSecond', 'filesystemUsedBytes', 'filesystemTotalBytes',
  'memoryUsedBytes', 'memoryTotalBytes', 'swapUsedBytes', 'swapTotalBytes', 'osUptimeSeconds'] as const;

function recordsFor(data: DatabaseData, serverUuid: string): MetricRecord[] {
  return data.server_metrics.filter((row) => row.server_uuid === serverUuid)
    .sort((left, right) => right.sampled_at.localeCompare(left.sampled_at) || Number(right.id) - Number(left.id));
}
function metricDto(row: MetricRecord) {
  const values = {
    cpuPercent: row.cpu_percent === null ? null : Number(row.cpu_percent),
    diskReadBytesPerSecond: row.disk_read_bytes_per_second === null ? null : Number(row.disk_read_bytes_per_second),
    diskWriteBytesPerSecond: row.disk_write_bytes_per_second === null ? null : Number(row.disk_write_bytes_per_second),
    networkInBitsPerSecond: row.network_in_bits_per_second === null ? null : Number(row.network_in_bits_per_second),
    networkOutBitsPerSecond: row.network_out_bits_per_second === null ? null : Number(row.network_out_bits_per_second),
    filesystemUsedBytes: row.filesystem_used_bytes, filesystemTotalBytes: row.filesystem_total_bytes,
    memoryUsedBytes: row.memory_used_bytes, memoryTotalBytes: row.memory_total_bytes,
    swapUsedBytes: row.swap_used_bytes, swapTotalBytes: row.swap_total_bytes,
    osUptimeSeconds: row.os_uptime_seconds,
  };
  return {
    sampledAt: row.sampled_at, sourcePeriod: row.source_period, ...values,
    fieldSampledAt: Object.fromEntries(sampleFields.filter((field) => values[field] !== null).map((field) => [field, row.sampled_at])),
    rawSummary: row.raw_summary,
  };
}
type MetricDto = ReturnType<typeof metricDto>;

function variable(stats: UpCloudStatsSummary | null, title: string) {
  return stats?.variables.find((item) => item.title.toLowerCase() === title.toLowerCase()) ?? null;
}

export class MetricsService {
  private readonly pending = new Map<string, Promise<{ sample: MetricDto; cached: boolean; partial: boolean }>>();
  constructor(
    private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly settings: SettingsService,
    private readonly events?: PanelEvents,
  ) {}

  async latest(serverUuid: string): Promise<MetricDto | null> {
    const rows = await this.db.read((data) => recordsFor(data, serverUuid).slice(0, 250));
    if (rows.length === 0) return null;
    const merged = metricDto(rows[0]!);
    const fieldSampledAt: Record<string, string> = {};
    for (const field of sampleFields) {
      const source = rows.find((row) => metricDto(row)[field] !== null);
      merged[field] = source ? metricDto(source)[field] : null;
      if (source) fieldSampledAt[field] = source.sampled_at;
    }
    merged.fieldSampledAt = fieldSampledAt;
    merged.sourcePeriod = 'combined';
    merged.rawSummary = { agent: rows.find((row) => row.source_period === 'agent')?.raw_summary ?? null, note: 'Latest actual value per field; fieldSampledAt records each source sample time.' };
    return merged;
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
    const latest = await this.db.read((data) => recordsFor(data, serverUuid).find((row) => row.source_period !== 'agent'));
    const freshnessSeconds = force ? Math.min(15, settings.metricsRefreshSeconds) : settings.metricsRefreshSeconds;
    if (latest && Date.now() - new Date(latest.sampled_at).getTime() < freshnessSeconds * 1000) {
      return { sample: metricDto(latest), cached: true, partial: this.hasErrors(latest) };
    }
    const token = await this.tokens.bestForServer(serverUuid);
    let client;
    try { client = this.tokens.gatewayFor(token); } catch (error) {
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
      cpu: cpu?.variables ?? [], disk: disk?.variables ?? [], network: network?.variables ?? [], errors: failures,
      note: 'Values retrieved from UpCloud daily summary; sampled_at is the panel retrieval time.',
    };
    const result = await this.db.withTransaction(({ data }) => {
      if (!data.servers.some((row) => row.uuid === serverUuid)) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan.');
      const now = new Date().toISOString();
      const inserted: MetricRecord = {
        id: String(data.nextMetricId++), server_uuid: serverUuid, sampled_at: now, source_period: 'daily',
        cpu_percent: values.cpu, disk_read_bytes_per_second: values.diskRead,
        disk_write_bytes_per_second: values.diskWrite, network_in_bits_per_second: values.networkIn,
        network_out_bits_per_second: values.networkOut,
        filesystem_used_bytes: null, filesystem_total_bytes: null, memory_used_bytes: null, memory_total_bytes: null,
        swap_used_bytes: null, swap_total_bytes: null, os_uptime_seconds: null,
        raw_summary: rawSummary, created_at: now,
      };
      data.server_metrics.push(inserted);
      return { sample: metricDto(inserted), cached: false, partial: failures.length > 0 };
    });
    if (!result.cached) this.events?.publish({ type: 'metric', payload: { uuid: serverUuid, sample: result.sample } });
    return result;
  }

  async ingestAgent(serverUuid: string, input: AgentMetricInput) {
    const result = await this.db.withTransaction(({ data }) => {
      if (!data.servers.some((row) => row.uuid === serverUuid)) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan.');
      const now = new Date().toISOString();
      const inserted: MetricRecord = {
        id: String(data.nextMetricId++), server_uuid: serverUuid, sampled_at: now, source_period: 'agent',
        cpu_percent: null, disk_read_bytes_per_second: null, disk_write_bytes_per_second: null,
        network_in_bits_per_second: null, network_out_bits_per_second: null,
        filesystem_used_bytes: input.filesystemUsedBytes, filesystem_total_bytes: input.filesystemTotalBytes,
        memory_used_bytes: input.memoryUsedBytes, memory_total_bytes: input.memoryTotalBytes,
        swap_used_bytes: input.swapUsedBytes, swap_total_bytes: input.swapTotalBytes,
        os_uptime_seconds: input.osUptimeSeconds,
        raw_summary: { source: 'guest_agent', filesystemCount: input.filesystemCount, load1: input.load1 ?? null, load5: input.load5 ?? null, load15: input.load15 ?? null, processCount: input.processCount ?? null, filesystems: input.filesystems ?? [], osName: input.osName ?? null, agentVersion: input.agentVersion ?? 'unknown' }, created_at: now,
      };
      data.server_metrics.push(inserted);
      const agent = data.server_agents.find((row) => row.server_uuid === serverUuid);
      if (agent) agent.last_seen_at = now;
      return metricDto(inserted);
    });
    this.events?.publish({ type: 'metric', payload: { uuid: serverUuid, sample: result } });
    return result;
  }

  async history(serverUuid: string, range: MetricRange) {
    const cutoff = Date.now() - rangeMilliseconds[range];
    const rows = await this.db.read((data) => data.server_metrics
      .filter((row) => row.server_uuid === serverUuid && new Date(row.sampled_at).getTime() >= cutoff)
      .sort((left, right) => left.sampled_at.localeCompare(right.sampled_at) || Number(left.id) - Number(right.id))
      .slice(0, 20_000));
    const allPoints = rows.map(metricDto);
    const points = this.downsample(allPoints, 600);
    const latest = await this.latest(serverUuid);
    return {
      range, points, latest,
      source: {
        type: 'panel_samples', upstreamPeriod: 'daily',
        timestampMeaning: 'Waktu panel menerima summary UpCloud atau sampel agent; fieldSampledAt membedakan sumber per metrik.',
        note: 'Riwayat berisi sampel nyata UpCloud dan/atau agent. Tidak ada backfill, interpolasi, atau angka simulasi.',
      },
      downsampled: points.length !== allPoints.length,
      downsamplingStrategy: points.length !== allPoints.length ? 'latest-actual-sample-per-time-bucket' : null,
      availability: this.availability(latest),
    };
  }

  private availability(latest: MetricDto | null) {
    const upcloud = (available: boolean) => ({
      available, source: 'upcloud_api',
      reason: available ? null : 'Belum ada nilai valid dari endpoint statistik UpCloud. Server stopped, izin token, atau retensi statistik dapat memengaruhi ketersediaan.',
    });
    const agent = (available: boolean) => ({
      available, source: available ? 'guest_agent' : 'agent_required',
      reason: available ? null : 'Tidak tersedia melalui API UpCloud. Instal agent panel di dalam VPS untuk metrik guest OS aktual.',
    });
    return {
      cpuUsage: upcloud(latest?.cpuPercent != null), diskActivity: upcloud(latest?.diskReadBytesPerSecond != null),
      networkTraffic: upcloud(latest?.networkInBitsPerSecond != null),
      memoryUsage: agent(latest?.memoryUsedBytes != null), swapUsage: agent(latest?.swapUsedBytes != null),
      filesystemUsage: agent(latest?.filesystemUsedBytes != null), osUptime: agent(latest?.osUptimeSeconds != null),
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
