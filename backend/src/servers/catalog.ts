import type { Database } from '../db/index.js';
import { activeJobStatuses } from '../db/types.js';
import type { DatabaseData, ServerRecord } from '../db/types.js';
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

type ServerRow = ServerRecord & { storage_gib: number };

export function persistServer(
  data: DatabaseData,
  server: UpCloudServerSummary | UpCloudServerDetails,
  options: { syncStatus?: ServerRecord['sync_status']; error?: string | null } = {},
): void {
  const full = 'config' in server ? server as UpCloudServerDetails : null;
  const syncStatus = options.syncStatus ?? 'ok';
  const now = new Date().toISOString();
  let row = data.servers.find((item) => item.uuid === server.uuid);
  if (!row) {
    row = {
      uuid: server.uuid, title: server.title, hostname: server.hostname, state: server.state,
      zone: server.zone, core_number: server.coreNumber, memory_mib: server.memoryMib, plan: server.plan,
      os_name: full?.osName ?? null,
      upcloud_created_at: full?.upcloudCreatedAt ? new Date(full.upcloudCreatedAt).toISOString() : null,
      config: full?.config ?? {}, sync_status: syncStatus, last_error_message: options.error ?? null,
      last_synced_at: syncStatus === 'ok' ? now : null,
      details_synced_at: full && syncStatus === 'ok' ? now : null,
      last_sync_attempt_at: now, created_at: now, updated_at: now,
    };
    data.servers.push(row);
  } else {
    Object.assign(row, {
      title: server.title, hostname: server.hostname, state: server.state, zone: server.zone,
      core_number: server.coreNumber, memory_mib: server.memoryMib, plan: server.plan,
      sync_status: syncStatus, last_error_message: options.error ?? null,
      last_sync_attempt_at: now, updated_at: now,
    });
    if (full) {
      row.os_name = full.osName;
      row.upcloud_created_at = full.upcloudCreatedAt ? new Date(full.upcloudCreatedAt).toISOString() : null;
      row.config = full.config;
    }
    if (syncStatus === 'ok') {
      row.last_synced_at = now;
      if (full) row.details_synced_at = now;
    }
  }
  if (!full) return;
  if (full.storages) {
    data.server_storage = data.server_storage.filter((item) => item.server_uuid !== server.uuid);
    for (const storage of full.storages) {
      data.server_storage.push({
        server_uuid: server.uuid, storage_uuid: storage.uuid, title: storage.title,
        size_gib: storage.sizeGib, tier: storage.tier, device_type: storage.deviceType,
        address: storage.address, boot_disk: storage.bootDisk, part_of_plan: storage.partOfPlan,
        zone: server.zone, attached: true, labels: storage.labels, synced_at: now,
      });
    }
  }
  if (full.networks) {
    data.server_networks = data.server_networks.filter((item) => item.server_uuid !== server.uuid);
    for (const network of full.networks) {
      data.server_networks.push({
        server_uuid: server.uuid, interface_index: network.index, network_uuid: network.networkUuid,
        network_type: network.type, mac_address: network.macAddress, bootable: network.bootable,
        source_ip_filtering: network.sourceIpFiltering, ip_addresses: network.ipAddresses, synced_at: now,
      });
    }
  }
}

export function upsertMembership(data: DatabaseData, tokenId: string, serverUuid: string): void {
  const now = new Date().toISOString();
  const current = data.token_server_memberships.find((row) => row.token_id === tokenId && row.server_uuid === serverUuid);
  if (current) {
    current.active = true;
    current.last_seen_at = now;
    current.last_synced_at = now;
  } else {
    data.token_server_memberships.push({
      token_id: tokenId, server_uuid: serverUuid, active: true,
      first_seen_at: now, last_seen_at: now, last_synced_at: now,
    });
  }
}

export function deactivateMissingMemberships(data: DatabaseData, tokenId: string, visibleUuids: string[]): void {
  const visible = new Set(visibleUuids);
  for (const row of data.token_server_memberships) {
    if (row.token_id === tokenId && !visible.has(row.server_uuid)) row.active = false;
  }
}

function relationsFor(data: DatabaseData, uuids: string[]) {
  const included = new Set(uuids);
  const tokens = data.token_server_memberships
    .filter((membership) => membership.active && included.has(membership.server_uuid))
    .flatMap((membership) => {
      const token = data.api_tokens.find((row) => row.id === membership.token_id);
      if (!token) return [];
      const group = data.token_server_groups.find((row) => row.token_id === membership.token_id && row.server_uuid === membership.server_uuid);
      return [{
        server_uuid: membership.server_uuid, id: token.id, name: token.name, enabled: token.enabled,
        connection_status: token.connection_status, validation_status: token.validation_status,
        slot: group?.slot ?? null,
      }];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const networks = data.server_networks
    .filter((row) => included.has(row.server_uuid))
    .sort((left, right) => left.interface_index - right.interface_index);
  const storages = data.server_storage
    .filter((row) => included.has(row.server_uuid))
    .sort((left, right) => (left.title ?? '').localeCompare(right.title ?? '') || left.storage_uuid.localeCompare(right.storage_uuid));
  const jobs = data.sync_jobs
    .filter((job) => activeJobStatuses.has(job.status) && job.token_id)
    .flatMap((job) => data.token_server_memberships
      .filter((membership) => membership.active && membership.token_id === job.token_id
        && included.has(membership.server_uuid)
        && (job.server_uuid === membership.server_uuid || job.job_type === 'token_sync'))
      .map((membership) => ({
        id: job.id, server_uuid: membership.server_uuid, job_type: job.job_type,
        status: job.status, created_at: job.created_at,
      })))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
  return { tokens, networks, storages, jobs };
}

type Relations = ReturnType<typeof relationsFor>;

function toServerDto(row: ServerRow, relations: Relations) {
  const tokens = relations.tokens.filter((item) => item.server_uuid === row.uuid).map((item) => ({
    id: item.id, name: item.name, enabled: item.enabled,
    connectionStatus: item.connection_status, validationStatus: item.validation_status,
    selectedSlot: item.slot === null ? null : Number(item.slot),
  }));
  const networks = relations.networks.filter((item) => item.server_uuid === row.uuid);
  const addresses = networks.flatMap((network) => network.ip_addresses.map((ip) => ({ ...ip, interfaceType: network.network_type })));
  const publicIps = addresses.filter((ip) => (ip.access ?? ip.interfaceType) === 'public').map((ip) => ip.address).filter(Boolean);
  const privateIps = addresses.filter((ip) => ['private', 'utility'].includes(ip.access ?? ip.interfaceType ?? '')).map((ip) => ip.address).filter(Boolean);
  const activeJob = relations.jobs.find((job) => job.server_uuid === row.uuid);
  return {
    uuid: row.uuid, title: row.title, hostname: row.hostname, state: row.state, zone: row.zone,
    coreNumber: Number(row.core_number), memoryMib: Number(row.memory_mib), plan: row.plan,
    osName: row.os_name, storageGib: Number(row.storage_gib ?? 0), upcloudCreatedAt: row.upcloud_created_at,
    syncStatus: row.sync_status, lastError: row.last_error_message, lastSyncedAt: row.last_synced_at,
    detailsSyncedAt: row.details_synced_at, lastSyncAttemptAt: row.last_sync_attempt_at,
    publicIps, privateIps, networkConfigurationStatus: networks.length > 0 ? 'available' : 'unavailable',
    activeJob: activeJob ? { id: activeJob.id, type: activeJob.job_type, status: activeJob.status } : null,
    tokens,
    groups: tokens.filter((token) => token.selectedSlot !== null),
  };
}

function activeServerRows(data: DatabaseData): ServerRow[] {
  const active = new Set(data.token_server_memberships.filter((row) => row.active).map((row) => row.server_uuid));
  return data.servers.filter((row) => active.has(row.uuid)).map((row) => ({
    ...row,
    storage_gib: data.server_storage.filter((storage) => storage.server_uuid === row.uuid)
      .reduce((total, storage) => total + Number(storage.size_gib), 0),
  }));
}

function compareServers(left: ServerRow, right: ServerRow, input: ServerQuery): number {
  const values = (row: ServerRow) => ({
    title: row.title.toLowerCase(), state: row.state, zone: row.zone, cores: row.core_number,
    memory: row.memory_mib, storage: row.storage_gib, lastSynced: row.last_synced_at,
  });
  const a = values(left)[input.sort];
  const b = values(right)[input.sort];
  if ((a === null || a === undefined) && (b === null || b === undefined)) return left.uuid.localeCompare(right.uuid);
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  const direction = input.order === 'asc' ? 1 : -1;
  if (a === b) return left.uuid.localeCompare(right.uuid);
  return (a < b ? -1 : 1) * direction;
}

export async function listServers(db: Database, input: ServerQuery) {
  return db.read((data) => {
    const search = input.search?.toLowerCase();
    const allRows = activeServerRows(data);
    const rows = allRows.filter((row) => {
      if (search) {
        const addresses = data.server_networks.filter((network) => network.server_uuid === row.uuid)
          .map((network) => JSON.stringify(network.ip_addresses)).join(' ');
        const haystack = `${row.title} ${row.hostname ?? ''} ${row.uuid} ${row.zone ?? ''} ${addresses}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (input.state && row.state !== input.state) return false;
      if (input.zone && row.zone !== input.zone) return false;
      if (input.syncStatus && row.sync_status !== input.syncStatus) return false;
      if (input.tokenId && !data.token_server_memberships.some((membership) => membership.active
        && membership.token_id === input.tokenId && membership.server_uuid === row.uuid)) return false;
      return true;
    });
    const total = rows.length;
    rows.sort((left, right) => compareServers(left, right, input));
    const offset = (input.page - 1) * input.limit;
    const pageRows = rows.slice(offset, offset + input.limit);
    const relations = relationsFor(data, pageRows.map((row) => row.uuid));
    const zones = [...new Set(allRows.flatMap((row) => row.zone ? [row.zone] : []))].sort();
    return {
      items: pageRows.map((row) => toServerDto(row, relations)),
      pagination: { page: input.page, limit: input.limit, total, pages: Math.max(1, Math.ceil(total / input.limit)) },
      filters: { zones },
    };
  });
}

export async function getServer(db: Database, uuid: string) {
  return db.read((data) => {
    const row = activeServerRows(data).find((item) => item.uuid === uuid);
    if (!row) return null;
    const relations = relationsFor(data, [uuid]);
    return {
      ...toServerDto(row, relations),
      config: row.config,
      storages: relations.storages.map((storage) => ({
        uuid: storage.storage_uuid, title: storage.title, sizeGib: Number(storage.size_gib), tier: storage.tier,
        deviceType: storage.device_type, address: storage.address, bootDisk: storage.boot_disk,
        partOfPlan: storage.part_of_plan, zone: storage.zone, attached: storage.attached,
        labels: storage.labels, syncedAt: storage.synced_at,
      })),
      networks: relations.networks.map((network) => ({
        index: network.interface_index, networkUuid: network.network_uuid, type: network.network_type,
        macAddress: network.mac_address, bootable: network.bootable, sourceIpFiltering: network.source_ip_filtering,
        ipAddresses: network.ip_addresses, syncedAt: network.synced_at,
      })),
    };
  });
}

export async function dashboardSummary(db: Database) {
  return db.read((data) => {
    const rows = activeServerRows(data);
    const timestamps = rows.flatMap((row) => row.last_synced_at ? [row.last_synced_at] : []).sort();
    return {
      totalServers: rows.length,
      started: rows.filter((row) => row.state === 'started').length,
      stopped: rows.filter((row) => row.state === 'stopped').length,
      errorState: rows.filter((row) => row.state === 'error').length,
      maintenance: rows.filter((row) => row.state === 'maintenance').length,
      connectionIssues: rows.filter((row) => ['error', 'not_found'].includes(row.sync_status)).length,
      totalCores: rows.reduce((total, row) => total + row.core_number, 0),
      totalMemoryMib: rows.reduce((total, row) => total + row.memory_mib, 0),
      totalStorageGib: rows.reduce((total, row) => total + row.storage_gib, 0),
      lastUpdatedAt: timestamps.at(-1) ?? null,
    };
  });
}
