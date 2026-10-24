import type { UpCloudIpAddress } from '../upcloud/types.js';

export type UserRecord = {
  id: string; username: string; password_hash: string; role: 'admin' | 'viewer'; disabled: boolean;
  created_at: string; updated_at: string;
};

export type SessionRecord = {
  id: string; user_id: string; token_hash: string; csrf_token: string; expires_at: string;
  last_seen_at: string; created_at: string; ip_address: string | null; user_agent: string | null;
};

export type ApiTokenRecord = {
  id: string; name: string; ciphertext: string; iv: string; auth_tag: string; key_version: number;
  fingerprint: string; masked_token: string; enabled: boolean;
  validation_status: 'unknown' | 'valid' | 'invalid' | 'expired';
  connection_status: 'unknown' | 'online' | 'degraded' | 'offline';
  expires_at: string | null; expires_at_verified: boolean; last_error_code: string | null;
  last_error_message: string | null; last_validated_at: string | null; last_used_at: string | null;
  last_sync_at: string | null; created_at: string; updated_at: string;
};

export type ServerRecord = {
  uuid: string; title: string; hostname: string | null; state: string; zone: string | null;
  core_number: number; memory_mib: number; plan: string | null; os_name: string | null;
  upcloud_created_at: string | null; config: Record<string, unknown>;
  sync_status: 'unknown' | 'ok' | 'degraded' | 'error' | 'not_found';
  last_error_message: string | null; last_synced_at: string | null; details_synced_at: string | null;
  last_sync_attempt_at: string | null; created_at: string; updated_at: string;
};

export type MembershipRecord = {
  token_id: string; server_uuid: string; active: boolean; first_seen_at: string;
  last_seen_at: string; last_synced_at: string | null;
};

export type ServerGroupRecord = { token_id: string; server_uuid: string; slot: 1 | 2; created_at: string };

export type StorageRecord = {
  server_uuid: string; storage_uuid: string; title: string | null; size_gib: number;
  tier: string | null; device_type: string | null; address: string | null;
  boot_disk: boolean | null; part_of_plan: boolean | null; zone: string | null;
  attached: boolean; labels: Array<{ key: string; value: string }>; synced_at: string;
};

export type NetworkRecord = {
  server_uuid: string; interface_index: number; network_uuid: string | null;
  network_type: string | null; mac_address: string | null; bootable: boolean | null;
  source_ip_filtering: boolean | null; ip_addresses: UpCloudIpAddress[]; synced_at: string;
};

export type MetricRecord = {
  id: string; server_uuid: string; sampled_at: string; source_period: string;
  cpu_percent: number | null; disk_read_bytes_per_second: number | null;
  disk_write_bytes_per_second: number | null; network_in_bits_per_second: number | null;
  network_out_bits_per_second: number | null; raw_summary: Record<string, unknown>; created_at: string;
};

export type SyncJobRecord = {
  id: string; job_type: 'token_sync' | 'server_sync' | 'server_control';
  status: 'queued' | 'running' | 'verifying' | 'succeeded' | 'failed' | 'verification_timeout';
  token_id: string | null; server_uuid: string | null; requested_by: string | null;
  trigger_type: 'manual' | 'automatic' | 'retry'; attempts: number;
  error_code: string | null; error_message: string | null; details: Record<string, unknown>;
  created_at: string; started_at: string | null; finished_at: string | null; updated_at: string;
};

export type AuditLogRecord = {
  id: string; user_id: string | null; action: string; resource_type: string;
  resource_id: string | null; outcome: 'success' | 'failure' | 'accepted' | 'info';
  request_id: string | null; ip_address: string | null; user_agent: string | null;
  details: Record<string, unknown>; created_at: string;
};

export type AppSettingRecord = { key: string; value: unknown; updated_at: string };

export type DatabaseData = {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  nextMetricId: number;
  nextAuditId: number;
  users: UserRecord[];
  sessions: SessionRecord[];
  api_tokens: ApiTokenRecord[];
  servers: ServerRecord[];
  token_server_memberships: MembershipRecord[];
  token_server_groups: ServerGroupRecord[];
  server_storage: StorageRecord[];
  server_networks: NetworkRecord[];
  server_metrics: MetricRecord[];
  sync_jobs: SyncJobRecord[];
  audit_logs: AuditLogRecord[];
  app_settings: AppSettingRecord[];
};

export const collectionNames = [
  'users', 'sessions', 'api_tokens', 'servers', 'token_server_memberships', 'token_server_groups',
  'server_storage', 'server_networks', 'server_metrics', 'sync_jobs', 'audit_logs', 'app_settings',
] as const satisfies ReadonlyArray<keyof DatabaseData>;

export const activeJobStatuses = new Set(['queued', 'running', 'verifying']);

export function createEmptyDatabase(settings: Record<string, number>): DatabaseData {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, createdAt: now, updatedAt: now, nextMetricId: 1, nextAuditId: 1,
    users: [], sessions: [], api_tokens: [], servers: [], token_server_memberships: [],
    token_server_groups: [], server_storage: [], server_networks: [], server_metrics: [],
    sync_jobs: [], audit_logs: [],
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value, updated_at: now })),
  };
}

function unique(items: readonly unknown[], key: (item: any) => unknown, label: string): void {
  const values = new Set<unknown>();
  for (const item of items) {
    const value = key(item);
    if (values.has(value)) throw new Error(`JSON database integrity error: duplicate ${label}.`);
    values.add(value);
  }
}

export function assertDatabaseData(value: unknown): asserts value is DatabaseData {
  if (!value || typeof value !== 'object') throw new Error('JSON database must contain an object.');
  const data = value as Partial<DatabaseData>;
  if (data.schemaVersion !== 1) throw new Error('Unsupported JSON database schemaVersion; expected 1.');
  if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') {
    throw new Error('JSON database timestamps are missing.');
  }
  if (!Number.isInteger(data.nextMetricId) || (data.nextMetricId ?? 0) < 1
    || !Number.isInteger(data.nextAuditId) || (data.nextAuditId ?? 0) < 1) {
    throw new Error('JSON database ID counters are invalid.');
  }
  for (const name of collectionNames) {
    if (!Array.isArray(data[name])) throw new Error(`JSON database collection ${name} must be an array.`);
  }
  const valid = data as DatabaseData;
  unique(valid.users, (row) => row.id, 'user id');
  unique(valid.users, (row) => row.username.toLowerCase(), 'username');
  unique(valid.sessions, (row) => row.id, 'session id');
  unique(valid.sessions, (row) => row.token_hash, 'session token hash');
  unique(valid.api_tokens, (row) => row.id, 'token id');
  unique(valid.api_tokens, (row) => row.fingerprint, 'token fingerprint');
  unique(valid.servers, (row) => row.uuid, 'server UUID');
  unique(valid.token_server_memberships, (row) => `${row.token_id}:${row.server_uuid}`, 'membership');
  unique(valid.token_server_groups, (row) => `${row.token_id}:${row.server_uuid}`, 'server group');
  unique(valid.token_server_groups, (row) => `${row.token_id}:${row.slot}`, 'token group slot');
  unique(valid.server_storage, (row) => `${row.server_uuid}:${row.storage_uuid}`, 'server storage');
  unique(valid.server_networks, (row) => `${row.server_uuid}:${row.interface_index}`, 'server network');
  unique(valid.server_metrics, (row) => row.id, 'metric id');
  unique(valid.sync_jobs, (row) => row.id, 'job id');
  unique(valid.audit_logs, (row) => row.id, 'audit id');
  unique(valid.app_settings, (row) => row.key, 'setting key');

  const users = new Set(valid.users.map((row) => row.id));
  const tokens = new Set(valid.api_tokens.map((row) => row.id));
  const servers = new Set(valid.servers.map((row) => row.uuid));
  const memberships = new Set(valid.token_server_memberships.map((row) => `${row.token_id}:${row.server_uuid}`));
  for (const row of valid.sessions) if (!users.has(row.user_id)) throw new Error('JSON database session references a missing user.');
  for (const row of valid.token_server_memberships) {
    if (!tokens.has(row.token_id) || !servers.has(row.server_uuid)) throw new Error('JSON database membership references a missing resource.');
  }
  for (const row of valid.token_server_groups) {
    if (![1, 2].includes(row.slot) || !memberships.has(`${row.token_id}:${row.server_uuid}`)) {
      throw new Error('JSON database group has an invalid slot or membership.');
    }
  }
  for (const collection of [valid.server_storage, valid.server_networks, valid.server_metrics]) {
    for (const row of collection) if (!servers.has(row.server_uuid)) throw new Error('JSON database server relation references a missing server.');
  }
  const activeTokens = new Set<string>();
  const activeServers = new Set<string>();
  for (const job of valid.sync_jobs) {
    if (!activeJobStatuses.has(job.status)) continue;
    if (job.token_id) {
      if (activeTokens.has(job.token_id)) throw new Error('JSON database has duplicate active jobs for a token.');
      activeTokens.add(job.token_id);
    }
    if (job.server_uuid && ['server_sync', 'server_control'].includes(job.job_type)) {
      if (activeServers.has(job.server_uuid)) throw new Error('JSON database has duplicate active jobs for a server.');
      activeServers.add(job.server_uuid);
    }
  }
}
