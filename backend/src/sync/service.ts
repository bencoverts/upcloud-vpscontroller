import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { AppError, sanitizeUpstreamMessage } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import type { PanelEvents } from '../lib/events.js';
import { TokenService } from '../tokens/service.js';
import { UpCloudApiError } from '../upcloud/client.js';
import type { UpCloudServerDetails, UpCloudServerSummary } from '../upcloud/types.js';
import { deactivateMissingMemberships, persistServer, upsertMembership } from '../servers/catalog.js';
import { SettingsService } from '../settings/service.js';

type JobType = 'token_sync' | 'server_sync' | 'server_control';
type TriggerType = 'manual' | 'automatic' | 'retry';
type ControlAction = 'start' | 'stop' | 'restart';

type JobRow = {
  id: string; job_type: JobType; status: string; token_id: string | null; server_uuid: string | null;
  requested_by: string | null; trigger_type: TriggerType; attempts: number; error_code: string | null;
  error_message: string | null; details: any; created_at: Date; started_at: Date | null;
  finished_at: Date | null; updated_at: Date;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const json = <T>(value: unknown, fallback: T): T => {
  if (typeof value === 'string') { try { return JSON.parse(value) as T; } catch { return fallback; } }
  return value as T ?? fallback;
};

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
    const result = await this.db.query<JobRow>('SELECT * FROM sync_jobs WHERE id=$1', [id]);
    if (!result.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Job sinkronisasi tidak ditemukan.');
    return this.toDto(result.rows[0]);
  }

  async listJobs(input: { page: number; limit: number; status?: string; type?: string; search?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (input.status) { values.push(input.status); conditions.push(`status=$${values.length}`); }
    if (input.type) { values.push(input.type); conditions.push(`job_type=$${values.length}`); }
    if (input.search) {
      values.push(`%${input.search}%`);
      const placeholder = `$${values.length}`;
      conditions.push(`(id::text ILIKE ${placeholder} OR COALESCE(server_uuid,'') ILIKE ${placeholder} OR COALESCE(token_id::text,'') ILIKE ${placeholder} OR COALESCE(error_message,'') ILIKE ${placeholder})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = await this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM sync_jobs ${where}`, values);
    values.push(input.limit, (input.page - 1) * input.limit);
    const result = await this.db.query<JobRow>(
      `SELECT * FROM sync_jobs ${where} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      items: result.rows.map((row) => this.toDto(row)),
      pagination: { page: input.page, limit: input.limit, total, pages: Math.max(1, Math.ceil(total / input.limit)) },
    };
  }

  async retry(id: string, requestedBy: string) {
    const result = await this.db.query<JobRow>('SELECT * FROM sync_jobs WHERE id=$1', [id]);
    const job = result.rows[0];
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
    await this.db.query(
      `UPDATE sync_jobs SET status='failed',error_code='PROCESS_RESTARTED',
        error_message='Proses panel berhenti sebelum job selesai. Verifikasi status resource; operasi power tidak diulang otomatis.',
        finished_at=now(),updated_at=now() WHERE status IN ('queued','running','verifying')`);
  }

  private async enqueue(
    jobType: JobType,
    input: { tokenId?: string; serverUuid?: string; requestedBy: string | null; trigger?: TriggerType; details?: Record<string, unknown> },
  ) {
    const id = randomUUID();
    try {
      await this.db.query(
        `INSERT INTO sync_jobs(id,job_type,status,token_id,server_uuid,requested_by,trigger_type,details)
         VALUES ($1,$2,'queued',$3,$4,$5,$6,$7::jsonb)`,
        [id, jobType, input.tokenId ?? null, input.serverUuid ?? null, input.requestedBy,
          input.trigger ?? 'manual', JSON.stringify(input.details ?? {})]);
    } catch (error: any) {
      if (error?.code === '23505') throw new AppError(409, 'CONFLICT', 'Sudah ada job aktif untuk resource ini. Tunggu hingga selesai.');
      throw error;
    }
    setImmediate(() => { void this.run(id).catch((error: unknown) => this.handleWorkerFailure(id, error)); });
    return this.getJob(id);
  }

  private async run(id: string): Promise<void> {
    const started = await this.db.query<JobRow>(
      `UPDATE sync_jobs SET status='running',started_at=COALESCE(started_at,now()),attempts=attempts+1,updated_at=now()
       WHERE id=$1 AND status='queued' RETURNING *`, [id]);
    const job = started.rows[0];
    if (!job) return;
    await this.publish(id);
    let action: string = job.job_type;
    try {
      if (job.job_type === 'token_sync') await this.runTokenSync(job);
      else if (job.job_type === 'server_sync') await this.runServerSync(job);
      else {
        action = `server.${json<Record<string, unknown>>(job.details, {}).action ?? 'control'}`;
        await this.runControl(job);
      }
      await this.db.query(
        `UPDATE sync_jobs SET status='succeeded',error_code=NULL,error_message=NULL,finished_at=now(),updated_at=now() WHERE id=$1`, [id]);
      await writeAudit(this.db, {
        userId: job.requested_by, action, resourceType: job.server_uuid ? 'server' : 'token',
        resourceId: job.server_uuid ?? job.token_id, outcome: 'success', details: { jobId: id, trigger: job.trigger_type },
      });
    } catch (error) {
      const timeout = error instanceof VerificationTimeout;
      const code = timeout ? 'VERIFICATION_TIMEOUT' : error instanceof UpCloudApiError ? error.upstreamCode ?? error.code : error instanceof AppError ? error.code : 'SYNC_FAILED';
      const message = timeout
        ? 'UpCloud menerima operasi, tetapi status target belum terverifikasi sebelum timeout. Refresh status; jangan ulangi tindakan secara buta.'
        : sanitizeUpstreamMessage(error instanceof Error ? error.message : 'Job gagal.');
      await this.db.query(
        `UPDATE sync_jobs SET status=$2,error_code=$3,error_message=$4,finished_at=now(),updated_at=now() WHERE id=$1`,
        [id, timeout ? 'verification_timeout' : 'failed', code, message]);
      if (job.token_id && !timeout) {
        try { await this.tokens.markError(await this.tokens.requireRecord(job.token_id), error); } catch { /* resource may be deleted */ }
      }
      await writeAudit(this.db, {
        userId: job.requested_by, action, resourceType: job.server_uuid ? 'server' : 'token',
        resourceId: job.server_uuid ?? job.token_id, outcome: timeout ? 'accepted' : 'failure',
        details: { jobId: id, errorCode: code, trigger: job.trigger_type },
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
      await this.db.query(
        `UPDATE sync_jobs SET status='failed',error_code='WORKER_FAILED',
          error_message='Worker berhenti karena kesalahan internal. Periksa status resource sebelum mencoba lagi.',
          finished_at=now(),updated_at=now()
         WHERE id=$1 AND status IN ('queued','running','verifying')`, [id]);
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
          const cached = await this.db.query<{ details_synced_at: Date | null }>('SELECT details_synced_at FROM servers WHERE uuid=$1', [summary.uuid]);
          const detailsAt = cached.rows[0]?.details_synced_at;
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
    await this.db.withTransaction(async (query) => {
      for (const [uuid, server] of resolved) {
        const failure = failures.get(uuid);
        await persistServer(query, server, failure ? { syncStatus: 'degraded', error: failure.message } : {});
        await upsertMembership(query, token.id, uuid);
      }
      await deactivateMissingMemberships(query, token.id, unique.map((server) => server.uuid));
      await query.query(
        `UPDATE api_tokens SET validation_status='valid',connection_status=$2,
          last_error_code=$3,last_error_message=$4,last_validated_at=now(),last_used_at=now(),last_sync_at=now(),updated_at=now()
         WHERE id=$1`,
        [token.id, failures.size ? 'degraded' : 'online', failures.size ? 'PARTIAL_SERVER_SYNC' : null,
          failures.size ? `${failures.size} detail server gagal diperbarui; data cache sebelumnya dipertahankan.` : null]);
      await query.query('UPDATE sync_jobs SET details=details || $2::jsonb,updated_at=now() WHERE id=$1', [job.id, JSON.stringify({
        serverCount: unique.length,
        detailFailures: [...failures.entries()].map(([uuid, failure]) => ({ uuid, code: failure.code, message: failure.message })),
      })]);
    });
  }

  private async runServerSync(job: JobRow): Promise<void> {
    if (!job.server_uuid || !job.token_id) throw new AppError(409, 'CONFLICT', 'Resource job sudah tidak tersedia.');
    const token = await this.tokens.requireRecord(job.token_id);
    const client = this.tokens.gatewayFor(token);
    try {
      const server = await client.getServer(job.server_uuid);
      await this.db.withTransaction(async (query) => {
        await persistServer(query, server);
        await upsertMembership(query, token.id, job.server_uuid!);
      });
      await this.tokens.markSuccess(token.id, false);
    } catch (error) {
      if (error instanceof UpCloudApiError && error.upstreamStatus === 404) {
        await this.db.withTransaction(async (query) => {
          await query.query('UPDATE token_server_memberships SET active=FALSE WHERE token_id=$1 AND server_uuid=$2', [token.id, job.server_uuid]);
          await query.query(
            `UPDATE servers SET sync_status='not_found',last_error_message='Server tidak ditemukan melalui token terkait.',last_sync_attempt_at=now()
             WHERE uuid=$1 AND NOT EXISTS (SELECT 1 FROM token_server_memberships WHERE server_uuid=$1 AND active=TRUE)`, [job.server_uuid]);
        });
      } else {
        await this.db.query(
          `UPDATE servers SET sync_status='error',last_error_message=$2,last_sync_attempt_at=now(),updated_at=now() WHERE uuid=$1`,
          [job.server_uuid, sanitizeUpstreamMessage(error instanceof Error ? error.message : 'Sinkronisasi gagal.')]);
      }
      throw error;
    }
  }

  private async runControl(job: JobRow): Promise<void> {
    if (!job.server_uuid || !job.token_id) throw new AppError(409, 'CONFLICT', 'Resource job sudah tidak tersedia.');
    const token = await this.tokens.requireRecord(job.token_id);
    const client = this.tokens.gatewayFor(token);
    const action = json<Record<string, unknown>>(job.details, {}).action;
    if (!['start', 'stop', 'restart'].includes(String(action))) throw new AppError(400, 'BAD_REQUEST', 'Aksi server tidak valid.');
    const uuid = job.server_uuid;
    const response = action === 'start' ? await client.startServer(uuid)
      : action === 'stop' ? await client.stopServer(uuid) : await client.restartServer(uuid);
    await this.db.withTransaction(async (query) => {
      await persistServer(query, response, { syncStatus: 'degraded', error: 'Operasi diterima; menunggu verifikasi status target.' });
      await upsertMembership(query, token.id, uuid);
    });
    await this.db.query("UPDATE sync_jobs SET status='verifying',updated_at=now() WHERE id=$1", [job.id]);
    await this.publish(job.id);
    const expected = action === 'stop' ? 'stopped' : 'started';
    const deadline = Date.now() + this.config.controlVerifyTimeoutMs;
    let stableObservations = 0;
    while (Date.now() < deadline) {
      await sleep(this.config.controlVerifyIntervalMs);
      const current = await client.getServer(uuid);
      stableObservations = current.state === expected ? stableObservations + 1 : 0;
      await this.db.withTransaction(async (query) => {
        await persistServer(query, current, stableObservations >= 2 ? {} : {
          syncStatus: 'degraded', error: `Menunggu status ${expected} terverifikasi.`,
        });
        await upsertMembership(query, token.id, uuid);
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
      details: json<Record<string, unknown>>(row.details, {}), createdAt: row.created_at,
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
    await this.db.query('DELETE FROM sessions WHERE expires_at < now()');
    await this.db.query("DELETE FROM server_metrics WHERE sampled_at < now() - ($1::integer * interval '1 day')", [settings.metricsRetentionDays]);
  }
}
