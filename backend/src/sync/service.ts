import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { activeJobStatuses } from '../db/types.js';
import type { SyncJobRecord } from '../db/types.js';
import { AppError, sanitizeUpstreamMessage } from '../lib/errors.js';
import { appendAudit } from '../lib/audit.js';
import type { PanelEvents } from '../lib/events.js';
import { TokenService } from '../tokens/service.js';
import { UpCloudApiError } from '../upcloud/client.js';
import type { UpCloudServerDetails, UpCloudServerSummary } from '../upcloud/types.js';
import { deactivateMissingMemberships, persistServer, upsertMembership } from '../servers/catalog.js';
import { SettingsService } from '../settings/service.js';

type JobType = SyncJobRecord['job_type'];
type TriggerType = SyncJobRecord['trigger_type'];
type ControlAction = 'start' | 'stop' | 'restart';
type JobRow = SyncJobRecord;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class VerificationTimeout extends Error {}

export class SyncService {
  constructor(
    private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
    private readonly events: PanelEvents,
    private readonly logger?: SchedulerLogger,
  ) {}

  async enqueueTokenSync(tokenId: string, requestedBy: string | null, trigger: TriggerType = 'manual') {
    await this.tokens.requireRecord(tokenId);
    return this.enqueue('token_sync', { tokenId, requestedBy, trigger });
  }

  async enqueueServerSync(serverUuid: string, requestedBy: string | null, trigger: TriggerType = 'manual') {
    const token = await this.tokens.bestForServer(serverUuid);
    return this.enqueue('server_sync', { tokenId: token.id, serverUuid, requestedBy, trigger });
  }

  async enqueueControl(serverUuid: string, action: ControlAction, requestedBy: string) {
    const token = await this.tokens.bestForServer(serverUuid);
    return this.enqueue('server_control', { tokenId: token.id, serverUuid, requestedBy, details: { action } });
  }

  async enqueueSyncAll(requestedBy: string | null, trigger: TriggerType = 'manual') {
    const tokens = await this.tokens.listEnabled();
    const jobs = [];
    const skipped: Array<{ tokenId: string; reason: string }> = [];
    for (const token of tokens) {
      try {
        jobs.push(await this.enqueueTokenSync(token.id, requestedBy, trigger));
      } catch (error) {
        skipped.push({ tokenId: token.id, reason: error instanceof Error ? error.message : 'Job dilewati.' });
      }
    }
    return { jobs, skipped, disabledTokensExcluded: true };
  }

  async getJob(id: string) {
    const job = await this.db.read((data) => data.sync_jobs.find((row) => row.id === id));
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job sinkronisasi tidak ditemukan.');
    return this.toDto(job);
  }

  async listJobs(input: { page: number; limit: number; status?: string; type?: string; search?: string }) {
    return this.db.read((data) => {
      const search = input.search?.toLowerCase();
      const rows = data.sync_jobs.filter((job) => {
        if (input.status && job.status !== input.status) return false;
        if (input.type && job.job_type !== input.type) return false;
        if (search) {
          const haystack = `${job.id} ${job.server_uuid ?? ''} ${job.token_id ?? ''} ${job.error_message ?? ''}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      }).sort((left, right) => right.created_at.localeCompare(left.created_at));
      const total = rows.length;
      const offset = (input.page - 1) * input.limit;
      return {
        items: rows.slice(offset, offset + input.limit).map((row) => this.toDto(row)),
        pagination: { page: input.page, limit: input.limit, total, pages: Math.max(1, Math.ceil(total / input.limit)) },
      };
    });
  }

  async retry(id: string, requestedBy: string) {
    const job = await this.db.read((data) => data.sync_jobs.find((row) => row.id === id));
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job tidak ditemukan.');
    if (!['failed', 'verification_timeout'].includes(job.status)) {
      throw new AppError(409, 'CONFLICT', 'Hanya job yang gagal atau timeout yang dapat dicoba ulang.');
    }
    if (job.job_type === 'server_control') {
      throw new AppError(409, 'CONFLICT', 'Operasi power tidak di-retry otomatis. Refresh status lalu kirim tindakan baru secara sadar.');
    }
    if (job.job_type === 'token_sync' && job.token_id) return this.enqueueTokenSync(job.token_id, requestedBy, 'retry');
    if (job.job_type === 'server_sync' && job.server_uuid) return this.enqueueServerSync(job.server_uuid, requestedBy, 'retry');
    throw new AppError(409, 'CONFLICT', 'Resource untuk job ini sudah tidak tersedia.');
  }

  async recoverInterruptedJobs(): Promise<void> {
    await this.db.withTransaction(({ data }) => {
      const now = new Date().toISOString();
      for (const job of data.sync_jobs) {
        if (!activeJobStatuses.has(job.status)) continue;
        Object.assign(job, {
          status: 'failed' as const, error_code: 'PROCESS_RESTARTED',
          error_message: 'Proses panel berhenti sebelum job selesai. Verifikasi status resource; operasi power tidak diulang otomatis.',
          finished_at: now, updated_at: now,
        });
      }
    });
  }

  private async enqueue(
    jobType: JobType,
    input: { tokenId?: string; serverUuid?: string; requestedBy: string | null; trigger?: TriggerType; details?: Record<string, unknown> },
  ) {
    const id = randomUUID();
    await this.db.withTransaction(({ data }) => {
      if (input.tokenId && !data.api_tokens.some((token) => token.id === input.tokenId)) {
        throw new AppError(404, 'NOT_FOUND', 'Token untuk job sudah tidak tersedia.');
      }
      if (input.serverUuid && !data.servers.some((server) => server.uuid === input.serverUuid)) {
        throw new AppError(404, 'NOT_FOUND', 'Server untuk job sudah tidak tersedia.');
      }
      const conflict = data.sync_jobs.some((job) => {
        if (!activeJobStatuses.has(job.status)) return false;
        if (input.tokenId && job.token_id === input.tokenId) return true;
        return Boolean(input.serverUuid && job.server_uuid === input.serverUuid
          && ['server_sync', 'server_control'].includes(jobType)
          && ['server_sync', 'server_control'].includes(job.job_type));
      });
      if (conflict) throw new AppError(409, 'CONFLICT', 'Sudah ada job aktif untuk resource ini. Tunggu hingga selesai.');
      const now = new Date().toISOString();
      data.sync_jobs.push({
        id, job_type: jobType, status: 'queued', token_id: input.tokenId ?? null,
        server_uuid: input.serverUuid ?? null, requested_by: input.requestedBy,
        trigger_type: input.trigger ?? 'manual', attempts: 0, error_code: null, error_message: null,
        details: input.details ?? {}, created_at: now, started_at: null, finished_at: null, updated_at: now,
      });
    });
    setImmediate(() => { void this.run(id).catch((error: unknown) => this.handleWorkerFailure(id, error)); });
    return this.getJob(id);
  }

  private async updateJob(id: string, patch: Partial<SyncJobRecord>, onlyActive = false): Promise<JobRow | undefined> {
    return this.db.withTransaction(({ data }) => {
      const job = data.sync_jobs.find((row) => row.id === id);
      if (!job || (onlyActive && !activeJobStatuses.has(job.status))) return undefined;
      Object.assign(job, patch, { updated_at: new Date().toISOString() });
      return job;
    });
  }

  private async run(id: string): Promise<void> {
    const job = await this.db.withTransaction(({ data }) => {
      const current = data.sync_jobs.find((row) => row.id === id && row.status === 'queued');
      if (!current) return null;
      const now = new Date().toISOString();
      current.status = 'running';
      current.started_at ??= now;
      current.attempts += 1;
      current.updated_at = now;
      return current;
    });
    if (!job) return;
    await this.publish(id);
    let action: string = job.job_type;
    try {
      if (job.job_type === 'token_sync') await this.runTokenSync(job);
      else if (job.job_type === 'server_sync') await this.runServerSync(job);
      else {
        action = `server.${job.details.action ?? 'control'}`;
        await this.runControl(job);
      }
      await this.db.withTransaction((transaction) => {
        const current = transaction.data.sync_jobs.find((row) => row.id === id);
        if (current) Object.assign(current, {
          status: 'succeeded' as const, error_code: null, error_message: null,
          finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
        appendAudit(transaction, {
          userId: job.requested_by, action, resourceType: job.server_uuid ? 'server' : 'token',
          resourceId: job.server_uuid ?? job.token_id, outcome: 'success', details: { jobId: id, trigger: job.trigger_type },
        });
      });
    } catch (error) {
      const timeout = error instanceof VerificationTimeout;
      const code = timeout ? 'VERIFICATION_TIMEOUT' : error instanceof UpCloudApiError ? error.upstreamCode ?? error.code : error instanceof AppError ? error.code : 'SYNC_FAILED';
      const message = timeout
        ? 'UpCloud menerima operasi, tetapi status target belum terverifikasi sebelum timeout. Refresh status; jangan ulangi tindakan secara buta.'
        : sanitizeUpstreamMessage(error instanceof Error ? error.message : 'Job gagal.');
      if (job.token_id && !timeout) {
        try { await this.tokens.markError(await this.tokens.requireRecord(job.token_id), error); } catch { /* resource may be deleted */ }
      }
      await this.db.withTransaction((transaction) => {
        const current = transaction.data.sync_jobs.find((row) => row.id === id);
        if (current) Object.assign(current, {
          status: timeout ? 'verification_timeout' as const : 'failed' as const, error_code: code,
          error_message: message, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
        appendAudit(transaction, {
          userId: job.requested_by, action, resourceType: job.server_uuid ? 'server' : 'token',
          resourceId: job.server_uuid ?? job.token_id, outcome: timeout ? 'accepted' : 'failure',
          details: { jobId: id, errorCode: code, trigger: job.trigger_type },
        });
      });
    } finally {
      await this.publish(id);
      if (job.server_uuid) this.events.publish({ type: 'server', payload: { uuid: job.server_uuid } });
      if (job.token_id) this.events.publish({ type: 'token', payload: { id: job.token_id } });
    }
  }

  private async handleWorkerFailure(id: string, error: unknown): Promise<void> {
    if (this.logger) this.logger.error({ err: error }, 'Background job failed outside its normal error path');
    else console.error('Background job failed outside its normal error path');
    try {
      await this.updateJob(id, {
        status: 'failed', error_code: 'WORKER_FAILED',
        error_message: 'Worker berhenti karena kesalahan internal. Periksa status resource sebelum mencoba lagi.',
        finished_at: new Date().toISOString(),
      }, true);
      const job = await this.getJob(id);
      this.events.publish({ type: 'job', payload: job });
      if (job.serverUuid) this.events.publish({ type: 'server', payload: { uuid: job.serverUuid } });
      if (job.tokenId) this.events.publish({ type: 'token', payload: { id: job.tokenId } });
    } catch (fallbackError) {
      if (this.logger) this.logger.error({ err: fallbackError }, 'Unable to persist background worker failure');
    }
  }

  private async runTokenSync(job: JobRow): Promise<void> {
    if (!job.token_id) throw new AppError(409, 'CONFLICT', 'Token untuk job sudah dihapus.');
    const token = await this.tokens.requireRecord(job.token_id);
    if (!token.enabled) throw new AppError(409, 'CONFLICT', 'Token sedang dinonaktifkan.');
    const client = this.tokens.gatewayFor(token);
    const list = await client.listServers();
    const unique = [...new Map(list.map((server) => [server.uuid, server])).values()];
    const resolved = new Map<string, UpCloudServerSummary | UpCloudServerDetails>();
    const failures = new Map<string, { code: string; message: string }>();
    let cursor = 0;
    const workers = Array.from({ length: Math.min(2, Math.max(1, unique.length)) }, async () => {
      while (cursor < unique.length) {
        const summary = unique[cursor++]!;
        try {
          const detailsAt = await this.db.read((data) => data.servers.find((row) => row.uuid === summary.uuid)?.details_synced_at);
          const fresh = detailsAt && Date.now() - new Date(detailsAt).getTime() < this.config.upcloudDetailsCacheSeconds * 1000;
          resolved.set(summary.uuid, fresh ? summary : await client.getServer(summary.uuid));
        } catch (error) {
          resolved.set(summary.uuid, summary);
          failures.set(summary.uuid, {
            code: error instanceof UpCloudApiError ? error.upstreamCode ?? error.code : 'DETAIL_SYNC_FAILED',
            message: sanitizeUpstreamMessage(error instanceof Error ? error.message : 'Detail server gagal disinkronkan.'),
          });
        }
      }
    });
    await Promise.all(workers);
    await this.db.withTransaction(({ data }) => {
      for (const [uuid, server] of resolved) {
        const failure = failures.get(uuid);
        persistServer(data, server, failure ? { syncStatus: 'degraded', error: failure.message } : {});
        upsertMembership(data, token.id, uuid);
      }
      deactivateMissingMemberships(data, token.id, unique.map((server) => server.uuid));
      const currentToken = data.api_tokens.find((row) => row.id === token.id);
      if (currentToken) {
        const now = new Date().toISOString();
        Object.assign(currentToken, {
          validation_status: 'valid' as const, connection_status: failures.size ? 'degraded' as const : 'online' as const,
          last_error_code: failures.size ? 'PARTIAL_SERVER_SYNC' : null,
          last_error_message: failures.size ? `${failures.size} detail server gagal diperbarui; data cache sebelumnya dipertahankan.` : null,
          last_validated_at: now, last_used_at: now, last_sync_at: now, updated_at: now,
        });
      }
      const currentJob = data.sync_jobs.find((row) => row.id === job.id);
      if (currentJob) {
        currentJob.details = {
          ...currentJob.details, serverCount: unique.length,
          detailFailures: [...failures.entries()].map(([uuid, failure]) => ({ uuid, code: failure.code, message: failure.message })),
        };
        currentJob.updated_at = new Date().toISOString();
      }
    });
  }

  private async runServerSync(job: JobRow): Promise<void> {
    if (!job.server_uuid || !job.token_id) throw new AppError(409, 'CONFLICT', 'Resource job sudah tidak tersedia.');
    const token = await this.tokens.requireRecord(job.token_id);
    const client = this.tokens.gatewayFor(token);
    try {
      const server = await client.getServer(job.server_uuid);
      await this.db.withTransaction(({ data }) => {
        persistServer(data, server);
        upsertMembership(data, token.id, job.server_uuid!);
      });
      await this.tokens.markSuccess(token.id, false);
    } catch (error) {
      if (error instanceof UpCloudApiError && error.upstreamStatus === 404) {
        await this.db.withTransaction(({ data }) => {
          const membership = data.token_server_memberships.find((row) => row.token_id === token.id && row.server_uuid === job.server_uuid);
          if (membership) membership.active = false;
          const stillVisible = data.token_server_memberships.some((row) => row.server_uuid === job.server_uuid && row.active);
          const server = data.servers.find((row) => row.uuid === job.server_uuid);
          if (server && !stillVisible) {
            server.sync_status = 'not_found';
            server.last_error_message = 'Server tidak ditemukan melalui token terkait.';
            server.last_sync_attempt_at = new Date().toISOString();
            server.updated_at = new Date().toISOString();
          }
        });
      } else {
        await this.db.withTransaction(({ data }) => {
          const server = data.servers.find((row) => row.uuid === job.server_uuid);
          if (server) {
            server.sync_status = 'error';
            server.last_error_message = sanitizeUpstreamMessage(error instanceof Error ? error.message : 'Sinkronisasi gagal.');
            server.last_sync_attempt_at = new Date().toISOString();
            server.updated_at = new Date().toISOString();
          }
        });
      }
      throw error;
    }
  }

  private async runControl(job: JobRow): Promise<void> {
    if (!job.server_uuid || !job.token_id) throw new AppError(409, 'CONFLICT', 'Resource job sudah tidak tersedia.');
    const token = await this.tokens.requireRecord(job.token_id);
    const client = this.tokens.gatewayFor(token);
    const action = job.details.action;
    if (!['start', 'stop', 'restart'].includes(String(action))) throw new AppError(400, 'BAD_REQUEST', 'Aksi server tidak valid.');
    const uuid = job.server_uuid;
    const response = action === 'start' ? await client.startServer(uuid)
      : action === 'stop' ? await client.stopServer(uuid) : await client.restartServer(uuid);
    await this.db.withTransaction(({ data }) => {
      persistServer(data, response, { syncStatus: 'degraded', error: 'Operasi diterima; menunggu verifikasi status target.' });
      upsertMembership(data, token.id, uuid);
    });
    await this.updateJob(job.id, { status: 'verifying' });
    await this.publish(job.id);
    const expected = action === 'stop' ? 'stopped' : 'started';
    const deadline = Date.now() + this.config.controlVerifyTimeoutMs;
    let stableObservations = 0;
    while (Date.now() < deadline) {
      await sleep(this.config.controlVerifyIntervalMs);
      const current = await client.getServer(uuid);
      stableObservations = current.state === expected ? stableObservations + 1 : 0;
      await this.db.withTransaction(({ data }) => {
        persistServer(data, current, stableObservations >= 2 ? {} : {
          syncStatus: 'degraded', error: `Menunggu status ${expected} terverifikasi.`,
        });
        upsertMembership(data, token.id, uuid);
      });
      this.events.publish({ type: 'server', payload: { uuid } });
      if (stableObservations >= 2) {
        await this.tokens.markSuccess(token.id, false);
        return;
      }
    }
    throw new VerificationTimeout();
  }

  private async publish(id: string): Promise<void> {
    try { this.events.publish({ type: 'job', payload: await this.getJob(id) }); } catch { /* job may have been removed with its resource */ }
  }

  private toDto(row: JobRow) {
    return {
      id: row.id, type: row.job_type, status: row.status, tokenId: row.token_id, serverUuid: row.server_uuid,
      requestedBy: row.requested_by, trigger: row.trigger_type, attempts: row.attempts,
      error: row.error_message ? { code: row.error_code, message: row.error_message } : null,
      details: row.details, createdAt: row.created_at,
      startedAt: row.started_at, finishedAt: row.finished_at, updatedAt: row.updated_at,
    };
  }
}

type SchedulerLogger = { error: (details: { err: unknown }, message: string) => void };

export class SyncScheduler {
  private timer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private bootTimer?: NodeJS.Timeout;
  private running = false;
  private lastRun = 0;
  constructor(
    private readonly db: Database,
    private readonly sync: SyncService,
    private readonly settings: SettingsService,
    private readonly logger?: SchedulerLogger,
  ) {}

  async start(runOnBoot: boolean): Promise<void> {
    await this.sync.recoverInterruptedJobs();
    if (runOnBoot) {
      this.bootTimer = setTimeout(() => this.supervise(() => this.runScheduled(), 'Scheduled synchronization failed'), 5_000);
      this.bootTimer.unref();
    }
    this.timer = setInterval(() => this.supervise(() => this.runScheduled(), 'Scheduled synchronization failed'), 30_000);
    this.timer.unref();
    this.cleanupTimer = setInterval(() => this.supervise(() => this.cleanup(), 'Scheduled cleanup failed'), 60 * 60 * 1000);
    this.cleanupTimer.unref();
    this.supervise(() => this.cleanup(), 'Initial cleanup failed');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  private supervise(task: () => Promise<void>, message: string): void {
    void task().catch((error: unknown) => {
      if (this.logger) this.logger.error({ err: error }, message);
      else console.error(message);
    });
  }

  private async runScheduled(): Promise<void> {
    if (this.running) return;
    const settings = await this.settings.get();
    if (Date.now() - this.lastRun < settings.syncIntervalSeconds * 1000) return;
    this.running = true;
    this.lastRun = Date.now();
    try { await this.sync.enqueueSyncAll(null, 'automatic'); } finally { this.running = false; }
  }

  private async cleanup(): Promise<void> {
    const settings = await this.settings.get();
    await this.db.withTransaction(({ data }) => {
      const now = Date.now();
      data.sessions = data.sessions.filter((row) => new Date(row.expires_at).getTime() >= now);
      const cutoff = now - settings.metricsRetentionDays * 24 * 60 * 60 * 1000;
      data.server_metrics = data.server_metrics.filter((row) => new Date(row.sampled_at).getTime() >= cutoff);
    });
  }
}
