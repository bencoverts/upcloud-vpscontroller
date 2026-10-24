import type { Queryable } from '../db/index.js';
import type { UpCloudServerDetails, UpCloudServerSummary } from '../upcloud/types.js';

export type ServerQuery = {
  search?: string;
  state?: string;
  zone?: string;
  tokenId?: string;
  syncStatus?: string;
  sort: 'title' | 'state' | 'zone' | 'cores' | 'memory' | 'storage' | 'lastSynced';
  order: 'asc' | 'desc';
  page: number;
  limit: number;
};

type ServerRow = {
  uuid: string; title: string; hostname: string | null; state: string; zone: string | null;
  core_number: number; memory_mib: string | number; plan: string | null; os_name: string | null;
  upcloud_created_at: Date | null; config: Record<string, unknown>; sync_status: string;
  last_error_message: string | null; last_synced_at: Date | null; details_synced_at: Date | null;
  last_sync_attempt_at: Date | null; storage_gib?: string | number;
};

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

export async function persistServer(
  query: Queryable,
  server: UpCloudServerSummary | UpCloudServerDetails,
  options: { syncStatus?: string; error?: string | null } = {},
): Promise<void> {
  const details = 'config' in server;
  const full = details ? server as UpCloudServerDetails : null;
  const syncStatus = options.syncStatus ?? 'ok';
  await query.query(
    `INSERT INTO servers (
      uuid, title, hostname, state, zone, core_number, memory_mib, plan, os_name,
      upcloud_created_at, config, sync_status, last_error_message, last_synced_at,
      details_synced_at, last_sync_attempt_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,
      CASE WHEN $12 = 'ok' THEN now() ELSE NULL END,
      CASE WHEN $14 AND $12 = 'ok' THEN now() ELSE NULL END, now(), now())
    ON CONFLICT (uuid) DO UPDATE SET
      title=EXCLUDED.title, hostname=EXCLUDED.hostname, state=EXCLUDED.state, zone=EXCLUDED.zone,
      core_number=EXCLUDED.core_number, memory_mib=EXCLUDED.memory_mib, plan=EXCLUDED.plan,
      os_name=CASE WHEN $14 THEN EXCLUDED.os_name ELSE servers.os_name END,
      upcloud_created_at=CASE WHEN $14 THEN EXCLUDED.upcloud_created_at ELSE servers.upcloud_created_at END,
      config=CASE WHEN $14 THEN EXCLUDED.config ELSE servers.config END,
      sync_status=EXCLUDED.sync_status, last_error_message=EXCLUDED.last_error_message,
      last_synced_at=CASE WHEN $12 = 'ok' THEN now() ELSE servers.last_synced_at END,
      details_synced_at=CASE WHEN $14 AND $12 = 'ok' THEN now() ELSE servers.details_synced_at END,
      last_sync_attempt_at=now(), updated_at=now()`,
    [
      server.uuid, server.title, server.hostname, server.state, server.zone, server.coreNumber,
      server.memoryMib, server.plan, full?.osName ?? null, full?.upcloudCreatedAt ?? null,
      JSON.stringify(full?.config ?? {}), syncStatus, options.error ?? null, details,
    ],
  );
  if (!full) return;
  if (full.storages) {
    await query.query('DELETE FROM server_storage WHERE server_uuid=$1', [server.uuid]);
    for (const storage of full.storages) {
      await query.query(
        `INSERT INTO server_storage (
          server_uuid, storage_uuid, title, size_gib, tier, device_type, address,
          boot_disk, part_of_plan, zone, attached, labels, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11::jsonb,now())`,
        [server.uuid, storage.uuid, storage.title, storage.sizeGib, storage.tier, storage.deviceType,
          storage.address, storage.bootDisk, storage.partOfPlan, server.zone, JSON.stringify(storage.labels)],
      );
    }
  }
  if (full.networks) {
    await query.query('DELETE FROM server_networks WHERE server_uuid=$1', [server.uuid]);
    for (const network of full.networks) {
      await query.query(
        `INSERT INTO server_networks (
          server_uuid, interface_index, network_uuid, network_type, mac_address,
          bootable, source_ip_filtering, ip_addresses, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())`,
        [server.uuid, network.index, network.networkUuid, network.type, network.macAddress,
          network.bootable, network.sourceIpFiltering, JSON.stringify(network.ipAddresses)],
      );
    }
  }
}

export async function upsertMembership(query: Queryable, tokenId: string, serverUuid: string): Promise<void> {
  await query.query(
    `INSERT INTO token_server_memberships(token_id, server_uuid, active, last_seen_at, last_synced_at)
     VALUES ($1,$2,TRUE,now(),now())
     ON CONFLICT(token_id, server_uuid) DO UPDATE SET active=TRUE, last_seen_at=now(), last_synced_at=now()`,
    [tokenId, serverUuid],
  );
}

export async function deactivateMissingMemberships(query: Queryable, tokenId: string, visibleUuids: string[]): Promise<void> {
  if (visibleUuids.length === 0) {
    await query.query('UPDATE token_server_memberships SET active=FALSE WHERE token_id=$1', [tokenId]);
    return;
  }
  const placeholders = visibleUuids.map((_, index) => `$${index + 2}`).join(',');
  await query.query(
    `UPDATE token_server_memberships SET active=FALSE WHERE token_id=$1 AND server_uuid NOT IN (${placeholders})`,
    [tokenId, ...visibleUuids],
  );
}

async function relationsFor(query: Queryable, uuids: string[]) {
  if (uuids.length === 0) return { tokens: [], networks: [], storages: [], jobs: [] };
  const placeholders = uuids.map((_, index) => `$${index + 1}`).join(',');
  const [tokens, networks, storages, jobs] = await Promise.all([
    query.query<any>(
      `SELECT m.server_uuid, t.id, t.name, t.enabled, t.connection_status, t.validation_status, g.slot
       FROM token_server_memberships m JOIN api_tokens t ON t.id=m.token_id
       LEFT JOIN token_server_groups g ON g.token_id=m.token_id AND g.server_uuid=m.server_uuid
       WHERE m.active=TRUE AND m.server_uuid IN (${placeholders}) ORDER BY t.name`, uuids),
    query.query<any>(`SELECT * FROM server_networks WHERE server_uuid IN (${placeholders}) ORDER BY interface_index`, uuids),
    query.query<any>(`SELECT * FROM server_storage WHERE server_uuid IN (${placeholders}) ORDER BY title, storage_uuid`, uuids),
    query.query<any>(`SELECT j.id,m.server_uuid,j.job_type,j.status FROM sync_jobs j
      JOIN token_server_memberships m ON m.token_id=j.token_id AND m.active=TRUE
      WHERE m.server_uuid IN (${placeholders}) AND j.status IN ('queued','running','verifying')
      AND (j.server_uuid=m.server_uuid OR j.job_type='token_sync') ORDER BY j.created_at DESC`, uuids),
  ]);
  return { tokens: tokens.rows, networks: networks.rows, storages: storages.rows, jobs: jobs.rows };
}

function toServerDto(row: ServerRow, relations: any) {
  const tokens = relations.tokens.filter((item: any) => item.server_uuid === row.uuid).map((item: any) => ({
    id: item.id, name: item.name, enabled: item.enabled,
    connectionStatus: item.connection_status, validationStatus: item.validation_status,
    selectedSlot: item.slot === null ? null : Number(item.slot),
  }));
  const networks = relations.networks.filter((item: any) => item.server_uuid === row.uuid);
  const addresses: any[] = networks.flatMap((network: any) => {
    const ips = jsonValue<any[]>(network.ip_addresses, []);
    return ips.map((ip) => ({ ...ip, interfaceType: network.network_type }));
  });
  const publicIps = addresses.filter((ip) => (ip.access ?? ip.interfaceType) === 'public').map((ip) => ip.address).filter(Boolean);
  const privateIps = addresses.filter((ip) => ['private', 'utility'].includes(ip.access ?? ip.interfaceType)).map((ip) => ip.address).filter(Boolean);
  const activeJob = relations.jobs.find((job: any) => job.server_uuid === row.uuid);
  return {
    uuid: row.uuid, title: row.title, hostname: row.hostname, state: row.state, zone: row.zone,
    coreNumber: Number(row.core_number), memoryMib: Number(row.memory_mib), plan: row.plan,
    osName: row.os_name, storageGib: Number(row.storage_gib ?? 0), upcloudCreatedAt: row.upcloud_created_at,
    syncStatus: row.sync_status, lastError: row.last_error_message, lastSyncedAt: row.last_synced_at,
    detailsSyncedAt: row.details_synced_at, lastSyncAttemptAt: row.last_sync_attempt_at,
    publicIps, privateIps, networkConfigurationStatus: networks.length > 0 ? 'available' : 'unavailable',
    activeJob: activeJob ? { id: activeJob.id, type: activeJob.job_type, status: activeJob.status } : null,
    tokens,
    groups: tokens.filter((token: any) => token.selectedSlot !== null),
  };
}

const sortColumns = {
  title: 'lower(s.title)', state: 's.state', zone: 's.zone', cores: 's.core_number', memory: 's.memory_mib',
  storage: 'storage_gib', lastSynced: 's.last_synced_at',
} as const;

export async function listServers(query: Queryable, input: ServerQuery) {
  const conditions = ['EXISTS (SELECT 1 FROM token_server_memberships ma WHERE ma.server_uuid=s.uuid AND ma.active=TRUE)'];
  const values: unknown[] = [];
  const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (input.search) {
    const placeholder = add(`%${input.search}%`);
    conditions.push(`(s.title ILIKE ${placeholder} OR s.hostname ILIKE ${placeholder} OR s.uuid ILIKE ${placeholder}
      OR s.zone ILIKE ${placeholder} OR EXISTS (SELECT 1 FROM server_networks sn WHERE sn.server_uuid=s.uuid AND sn.ip_addresses::text ILIKE ${placeholder}))`);
  }
  if (input.state) conditions.push(`s.state=${add(input.state)}`);
  if (input.zone) conditions.push(`s.zone=${add(input.zone)}`);
  if (input.syncStatus) conditions.push(`s.sync_status=${add(input.syncStatus)}`);
  if (input.tokenId) conditions.push(`EXISTS (SELECT 1 FROM token_server_memberships mt WHERE mt.server_uuid=s.uuid AND mt.active=TRUE AND mt.token_id=${add(input.tokenId)})`);
  const where = conditions.join(' AND ');
  const count = await query.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM servers s WHERE ${where}`, values);
  const listValues = [...values];
  const limitPlaceholder = `$${listValues.push(input.limit)}`;
  const offsetPlaceholder = `$${listValues.push((input.page - 1) * input.limit)}`;
  const result = await query.query<ServerRow>(
    `SELECT s.*, COALESCE((SELECT SUM(ss.size_gib) FROM server_storage ss WHERE ss.server_uuid=s.uuid),0) AS storage_gib
     FROM servers s WHERE ${where}
     ORDER BY ${sortColumns[input.sort]} ${input.order.toUpperCase()}, s.uuid ASC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`, listValues);
  const relations = await relationsFor(query, result.rows.map((row) => row.uuid));
  const zones = await query.query<{ zone: string }>(
    `SELECT DISTINCT s.zone FROM servers s WHERE s.zone IS NOT NULL
      AND EXISTS (SELECT 1 FROM token_server_memberships m WHERE m.server_uuid=s.uuid AND m.active=TRUE)
      ORDER BY s.zone`);
  const total = Number(count.rows[0]?.count ?? 0);
  return {
    items: result.rows.map((row) => toServerDto(row, relations)),
    pagination: { page: input.page, limit: input.limit, total, pages: Math.max(1, Math.ceil(total / input.limit)) },
    filters: { zones: zones.rows.map((row) => row.zone) },
  };
}

export async function getServer(query: Queryable, uuid: string) {
  const result = await query.query<ServerRow>(
    `SELECT s.*, COALESCE((SELECT SUM(ss.size_gib) FROM server_storage ss WHERE ss.server_uuid=s.uuid),0) AS storage_gib
     FROM servers s WHERE s.uuid=$1 AND EXISTS (
       SELECT 1 FROM token_server_memberships m WHERE m.server_uuid=s.uuid AND m.active=TRUE)`, [uuid]);
  const row = result.rows[0];
  if (!row) return null;
  const relations = await relationsFor(query, [uuid]);
  return {
    ...toServerDto(row, relations),
    config: jsonValue<Record<string, unknown>>(row.config, {}),
    storages: relations.storages.map((storage: any) => ({
      uuid: storage.storage_uuid, title: storage.title, sizeGib: Number(storage.size_gib), tier: storage.tier,
      deviceType: storage.device_type, address: storage.address, bootDisk: storage.boot_disk,
      partOfPlan: storage.part_of_plan, zone: storage.zone, attached: storage.attached,
      labels: jsonValue(storage.labels, []), syncedAt: storage.synced_at,
    })),
    networks: relations.networks.map((network: any) => ({
      index: network.interface_index, networkUuid: network.network_uuid, type: network.network_type,
      macAddress: network.mac_address, bootable: network.bootable, sourceIpFiltering: network.source_ip_filtering,
      ipAddresses: jsonValue(network.ip_addresses, []), syncedAt: network.synced_at,
    })),
  };
}

export async function dashboardSummary(query: Queryable) {
  const result = await query.query<any>(
    `SELECT
      COUNT(*)::text AS total_servers,
      COUNT(*) FILTER (WHERE s.state='started')::text AS started,
      COUNT(*) FILTER (WHERE s.state='stopped')::text AS stopped,
      COUNT(*) FILTER (WHERE s.state='error')::text AS error_state,
      COUNT(*) FILTER (WHERE s.state='maintenance')::text AS maintenance,
      COUNT(*) FILTER (WHERE s.sync_status IN ('error','not_found'))::text AS connection_issues,
      COALESCE(SUM(s.core_number),0)::text AS total_cores,
      COALESCE(SUM(s.memory_mib),0)::text AS total_memory_mib,
      MAX(s.last_synced_at) AS last_updated_at
     FROM servers s WHERE EXISTS (
       SELECT 1 FROM token_server_memberships m WHERE m.server_uuid=s.uuid AND m.active=TRUE)`);
  const storage = await query.query<{ total: string }>(
    `SELECT COALESCE(SUM(st.size_gib),0)::text AS total FROM server_storage st
     WHERE EXISTS (SELECT 1 FROM token_server_memberships m WHERE m.server_uuid=st.server_uuid AND m.active=TRUE)`);
  const row = result.rows[0] ?? {};
  return {
    totalServers: Number(row.total_servers ?? 0), started: Number(row.started ?? 0),
    stopped: Number(row.stopped ?? 0), errorState: Number(row.error_state ?? 0),
    maintenance: Number(row.maintenance ?? 0), connectionIssues: Number(row.connection_issues ?? 0),
    totalCores: Number(row.total_cores ?? 0), totalMemoryMib: Number(row.total_memory_mib ?? 0),
    totalStorageGib: Number(storage.rows[0]?.total ?? 0), lastUpdatedAt: row.last_updated_at ?? null,
  };
}
