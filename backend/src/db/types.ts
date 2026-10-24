import type { UpCloudIpAddress } from '../upcloud/types.js';

export type UserRecord = {
  id: string; username: string; email: string | null; display_name: string | null;
  password_hash: string; role: 'admin' | 'client'; disabled: boolean;
  created_at: string; updated_at: string;
};
export type ClientAccessRecord = { user_id: string; server_uuid: string; expires_at: string | null; created_at: string; updated_at: string };
export type ServerAgentRecord = { server_uuid: string; token_hash: string; label: string; revoked: boolean; created_at: string; last_seen_at: string | null };
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
export type PanelApiKeyRecord = {
  id: string; user_id: string; name: string; prefix: string; token_hash: string; scopes: string[];
  expires_at: string | null; last_used_at: string | null; revoked: boolean; created_at: string;
};
export type OauthIdentityRecord = {
  id: string; user_id: string; provider: 'google'; subject: string; email: string;
  created_at: string; updated_at: string;
};
export type OauthStateRecord = {
  id: string; state_hash: string; verifier: string; nonce: string; expires_at: string; created_at: string;
};
export type ProxmoxConnectionRecord = {
  id: string; name: string; base_url: string; token_id: string;
  ciphertext: string; iv: string; auth_tag: string; key_version: number; enabled: boolean;
  connection_status: 'unknown' | 'online' | 'offline'; last_error_message: string | null;
  last_synced_at: string | null; created_at: string; updated_at: string;
};
export type ProxmoxResourceRecord = {
  id: string; connection_id: string; node: string; vmid: number; type: 'qemu' | 'lxc';
  name: string; status: string; cpu_percent: number | null; memory_used_bytes: number | null;
  memory_total_bytes: number | null; disk_used_bytes: number | null; disk_total_bytes: number | null;
  uptime_seconds: number | null; raw: Record<string, unknown>; synced_at: string;
};
export type ServerRecord = {
  uuid: string; title: string; hostname: string | null; state: string; zone: string | null;
  core_number: number; memory_mib: number; plan: string | null; os_name: string | null;
  upcloud_created_at: string | null; config: Record<string, unknown>;
  sync_status: 'unknown' | 'ok' | 'degraded' | 'error' | 'not_found';
  last_error_message: string | null; last_synced_at: string | null; details_synced_at: string | null;
  last_sync_attempt_at: string | null; created_at: string; updated_at: string;
};
export type MembershipRecord = { token_id: string; server_uuid: string; active: boolean; first_seen_at: string; last_seen_at: string; last_synced_at: string | null };
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
  network_out_bits_per_second: number | null; filesystem_used_bytes: number | null;
  filesystem_total_bytes: number | null; memory_used_bytes: number | null; memory_total_bytes: number | null;
  swap_used_bytes: number | null; swap_total_bytes: number | null; os_uptime_seconds: number | null;
  raw_summary: Record<string, unknown>; created_at: string;
};
export type SyncJobRecord = {
  id: string; job_type: 'token_sync' | 'server_sync' | 'server_control' | 'server_rebuild' | 'server_deploy';
  status: 'queued' | 'running' | 'verifying' | 'succeeded' | 'failed' | 'verification_timeout';
  token_id: string | null; server_uuid: string | null; requested_by: string | null;
  trigger_type: 'manual' | 'automatic' | 'retry'; attempts: number;
  error_code: string | null; error_message: string | null; details: Record<string, unknown>;
  created_at: string; started_at: string | null; finished_at: string | null; updated_at: string;
};
export type AuditLogRecord = {
  id: string; user_id: string | null; action: string; resource_type: string; resource_id: string | null;
  outcome: 'success' | 'failure' | 'accepted' | 'info'; request_id: string | null;
  ip_address: string | null; user_agent: string | null; details: Record<string, unknown>; created_at: string;
};
export type AppSettingRecord = { key: string; value: unknown; updated_at: string };

export type DatabaseData = {
  schemaVersion: 3; createdAt: string; updatedAt: string; nextMetricId: number; nextAuditId: number;
  users: UserRecord[]; sessions: SessionRecord[]; client_server_access: ClientAccessRecord[];
  server_agents: ServerAgentRecord[]; api_tokens: ApiTokenRecord[]; panel_api_keys: PanelApiKeyRecord[];
  oauth_identities: OauthIdentityRecord[]; oauth_states: OauthStateRecord[];
  proxmox_connections: ProxmoxConnectionRecord[]; proxmox_resources: ProxmoxResourceRecord[];
  servers: ServerRecord[]; token_server_memberships: MembershipRecord[]; token_server_groups: ServerGroupRecord[];
  server_storage: StorageRecord[]; server_networks: NetworkRecord[]; server_metrics: MetricRecord[];
  sync_jobs: SyncJobRecord[]; audit_logs: AuditLogRecord[]; app_settings: AppSettingRecord[];
};
export const collectionNames = [
  'users', 'sessions', 'client_server_access', 'server_agents', 'api_tokens', 'panel_api_keys',
  'oauth_identities', 'oauth_states', 'proxmox_connections', 'proxmox_resources', 'servers',
  'token_server_memberships', 'token_server_groups', 'server_storage', 'server_networks',
  'server_metrics', 'sync_jobs', 'audit_logs', 'app_settings',
] as const satisfies ReadonlyArray<keyof DatabaseData>;
export const activeJobStatuses = new Set(['queued', 'running', 'verifying']);

export function createEmptyDatabase(settings: Record<string, unknown>): DatabaseData {
  const now = new Date().toISOString();
  return {
    schemaVersion: 3, createdAt: now, updatedAt: now, nextMetricId: 1, nextAuditId: 1,
    users: [], sessions: [], client_server_access: [], server_agents: [], api_tokens: [], panel_api_keys: [],
    oauth_identities: [], oauth_states: [], proxmox_connections: [], proxmox_resources: [], servers: [],
    token_server_memberships: [], token_server_groups: [], server_storage: [], server_networks: [],
    server_metrics: [], sync_jobs: [], audit_logs: [],
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
function migrateLegacy(value: Record<string, unknown>): DatabaseData {
  const legacy = value as unknown as Omit<DatabaseData, 'schemaVersion'> & { schemaVersion: number };
  const now = new Date().toISOString();
  const migrated = {
    ...legacy, schemaVersion: 3,
    users: legacy.users.map((user) => ({
      ...user, role: (user.role as string) === 'viewer' ? 'client' : user.role,
      email: user.email ?? null, display_name: user.display_name ?? null,
    })),
    client_server_access: legacy.client_server_access ?? [], server_agents: legacy.server_agents ?? [],
    panel_api_keys: legacy.panel_api_keys ?? [], oauth_identities: legacy.oauth_identities ?? [],
    oauth_states: legacy.oauth_states ?? [], proxmox_connections: legacy.proxmox_connections ?? [],
    proxmox_resources: legacy.proxmox_resources ?? [],
    server_metrics: legacy.server_metrics.map((metric) => ({
      ...metric, filesystem_used_bytes: metric.filesystem_used_bytes ?? null,
      filesystem_total_bytes: metric.filesystem_total_bytes ?? null, memory_used_bytes: metric.memory_used_bytes ?? null,
      memory_total_bytes: metric.memory_total_bytes ?? null, swap_used_bytes: metric.swap_used_bytes ?? null,
      swap_total_bytes: metric.swap_total_bytes ?? null, os_uptime_seconds: metric.os_uptime_seconds ?? null,
    })),
    app_settings: legacy.app_settings ?? [{ key: 'siteName', value: 'CerdasNet', updated_at: now }],
  } as DatabaseData;
  assertDatabaseData(migrated);
  return migrated;
}
export function migrateDatabaseData(value: unknown): { data: DatabaseData; migrated: boolean } {
  if (!value || typeof value !== 'object') throw new Error('JSON database must contain an object.');
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion === 3) {
    assertDatabaseData(candidate);
    return { data: candidate as DatabaseData, migrated: false };
  }
  if (![1, 2].includes(Number(candidate.schemaVersion))) throw new Error('Unsupported JSON database schemaVersion; expected 1, 2, or 3.');
  return { data: migrateLegacy(candidate), migrated: true };
}
export function assertDatabaseData(value: unknown): asserts value is DatabaseData {
  if (!value || typeof value !== 'object') throw new Error('JSON database must contain an object.');
  const data = value as Partial<DatabaseData>;
  if (data.schemaVersion !== 3) throw new Error('Unsupported JSON database schemaVersion; expected 3.');
  if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') throw new Error('JSON database timestamps are missing.');
  if (!Number.isInteger(data.nextMetricId) || (data.nextMetricId ?? 0) < 1 || !Number.isInteger(data.nextAuditId) || (data.nextAuditId ?? 0) < 1) {
    throw new Error('JSON database ID counters are invalid.');
  }
  for (const name of collectionNames) if (!Array.isArray(data[name])) throw new Error(`JSON database collection ${name} must be an array.`);
  const valid = data as DatabaseData;
  unique(valid.users, (row) => row.id, 'user id'); unique(valid.users, (row) => row.username.toLowerCase(), 'username');
  unique(valid.sessions, (row) => row.id, 'session id'); unique(valid.sessions, (row) => row.token_hash, 'session token hash');
  unique(valid.client_server_access, (row) => `${row.user_id}:${row.server_uuid}`, 'client server access');
  unique(valid.server_agents, (row) => row.server_uuid, 'server agent'); unique(valid.api_tokens, (row) => row.id, 'token id');
  unique(valid.api_tokens, (row) => row.fingerprint, 'token fingerprint'); unique(valid.panel_api_keys, (row) => row.id, 'panel API key id');
  unique(valid.panel_api_keys, (row) => row.token_hash, 'panel API key hash'); unique(valid.oauth_identities, (row) => row.id, 'OAuth identity');
  unique(valid.oauth_identities, (row) => `${row.provider}:${row.subject}`, 'OAuth subject'); unique(valid.oauth_states, (row) => row.id, 'OAuth state');
  unique(valid.proxmox_connections, (row) => row.id, 'Proxmox connection'); unique(valid.proxmox_resources, (row) => row.id, 'Proxmox resource');
  unique(valid.proxmox_resources, (row) => `${row.connection_id}:${row.type}:${row.node}:${row.vmid}`, 'Proxmox resource identity');
  unique(valid.servers, (row) => row.uuid, 'server UUID');
  unique(valid.token_server_memberships, (row) => `${row.token_id}:${row.server_uuid}`, 'membership');
  unique(valid.token_server_groups, (row) => `${row.token_id}:${row.server_uuid}`, 'server group');
  unique(valid.token_server_groups, (row) => `${row.token_id}:${row.slot}`, 'token group slot');
  unique(valid.server_storage, (row) => `${row.server_uuid}:${row.storage_uuid}`, 'server storage');
  unique(valid.server_networks, (row) => `${row.server_uuid}:${row.interface_index}`, 'server network');
  unique(valid.server_metrics, (row) => row.id, 'metric id'); unique(valid.sync_jobs, (row) => row.id, 'job id');
  unique(valid.audit_logs, (row) => row.id, 'audit id'); unique(valid.app_settings, (row) => row.key, 'setting key');
  const users = new Set(valid.users.map((row) => row.id)); const tokens = new Set(valid.api_tokens.map((row) => row.id));
  const servers = new Set(valid.servers.map((row) => row.uuid));
  const memberships = new Set(valid.token_server_memberships.map((row) => `${row.token_id}:${row.server_uuid}`));
  for (const row of valid.client_server_access) if (!users.has(row.user_id) || !servers.has(row.server_uuid)) throw new Error('JSON database client access references a missing user or server.');
  for (const row of valid.server_agents) if (!servers.has(row.server_uuid)) throw new Error('JSON database agent references a missing server.');
  for (const row of valid.sessions) if (!users.has(row.user_id)) throw new Error('JSON database session references a missing user.');
  for (const row of valid.panel_api_keys) if (!users.has(row.user_id)) throw new Error('JSON database API key references a missing user.');
  for (const row of valid.oauth_identities) if (!users.has(row.user_id)) throw new Error('JSON database OAuth identity references a missing user.');
  for (const row of valid.token_server_memberships) if (!tokens.has(row.token_id) || !servers.has(row.server_uuid)) throw new Error('JSON database membership references a missing resource.');
  for (const row of valid.token_server_groups) if (![1, 2].includes(row.slot) || !memberships.has(`${row.token_id}:${row.server_uuid}`)) throw new Error('JSON database group has an invalid slot or membership.');
  for (const collection of [valid.server_storage, valid.server_networks, valid.server_metrics]) for (const row of collection) if (!servers.has(row.server_uuid)) throw new Error('JSON database server relation references a missing server.');
  const connections = new Set(valid.proxmox_connections.map((row) => row.id));
  for (const row of valid.proxmox_resources) if (!connections.has(row.connection_id)) throw new Error('JSON database Proxmox resource references a missing connection.');
  const activeTokens = new Set<string>(); const activeServers = new Set<string>();
  for (const job of valid.sync_jobs) {
    if (!activeJobStatuses.has(job.status)) continue;
    if (job.token_id) {
      if (activeTokens.has(job.token_id)) throw new Error('JSON database has duplicate active jobs for a token.');
      activeTokens.add(job.token_id);
    }
    if (job.server_uuid && ['server_sync', 'server_control', 'server_rebuild'].includes(job.job_type)) {
      if (activeServers.has(job.server_uuid)) throw new Error('JSON database has duplicate active jobs for a server.');
      activeServers.add(job.server_uuid);
    }
  }
}
