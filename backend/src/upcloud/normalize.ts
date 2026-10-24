import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import type {
  UpCloudIpAddress,
  UpCloudNetwork,
  UpCloudServerDetails,
  UpCloudServerSummary,
  UpCloudStatsSummary,
  UpCloudStorage,
} from './types.js';

const object = (value: unknown): Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): string | null => typeof value === 'string' || typeof value === 'number' ? String(value) : null;
const number = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (value: unknown): boolean | null => {
  if (value === true || value === 'yes' || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'no' || value === 'false' || value === 0 || value === '0') return false;
  return null;
};
const arrayAt = (value: unknown, key: string): unknown[] => {
  const nested = object(value)[key];
  if (Array.isArray(nested)) return nested;
  if (Array.isArray(value)) return value;
  return [];
};

export function normalizeServerSummary(input: unknown): UpCloudServerSummary {
  const value = object(input);
  const uuidResult = z.string().uuid().safeParse(value.uuid);
  if (!uuidResult.success || !text(value.title)) {
    throw new AppError(502, 'UPCLOUD_ERROR', 'Respons daftar server UpCloud tidak memiliki UUID atau judul yang valid.');
  }
  return {
    uuid: uuidResult.data,
    title: text(value.title)!,
    hostname: text(value.hostname),
    state: text(value.state) ?? 'unknown',
    zone: text(value.zone),
    coreNumber: Math.max(0, number(value.core_number)),
    memoryMib: Math.max(0, number(value.memory_amount)),
    plan: text(value.plan),
  };
}

export function normalizeServerList(payload: unknown): UpCloudServerSummary[] {
  const servers = arrayAt(object(payload).servers, 'server');
  return servers.map(normalizeServerSummary);
}

function normalizeLabels(value: unknown): Array<{ key: string; value: string }> {
  const labels = Array.isArray(value) ? value : arrayAt(value, 'label');
  return labels.flatMap((entry) => {
    const label = object(entry);
    return text(label.key) && text(label.value) !== null
      ? [{ key: text(label.key)!, value: text(label.value)! }]
      : [];
  });
}

function normalizeStorage(input: unknown): UpCloudStorage | null {
  const value = object(input);
  const uuid = text(value.storage) ?? text(value.uuid);
  if (!uuid || !z.string().uuid().safeParse(uuid).success) return null;
  return {
    uuid,
    title: text(value.storage_title) ?? text(value.title),
    sizeGib: Math.max(0, number(value.storage_size ?? value.size)),
    tier: text(value.storage_tier) ?? text(value.tier),
    deviceType: text(value.type),
    address: text(value.address),
    bootDisk: bool(value.boot_disk),
    partOfPlan: bool(value.part_of_plan),
    labels: normalizeLabels(value.labels),
  };
}

function normalizeIp(input: unknown, access?: string | null): UpCloudIpAddress {
  const value = object(input);
  return {
    address: text(value.address),
    family: text(value.family),
    access: text(value.access) ?? access,
    dhcpProvided: bool(value.dhcp_provided ?? value.dhcp),
    floating: bool(value.floating),
    releasePolicy: text(value.release_policy),
    network: text(value.network),
    gateway: text(value.gateway),
    prefix: text(value.prefix),
  };
}

function normalizeNetwork(input: unknown): UpCloudNetwork | null {
  const value = object(input);
  const index = number(value.index, -1);
  if (!Number.isInteger(index) || index < 0) return null;
  const type = text(value.type);
  return {
    index,
    networkUuid: text(value.network) ?? text(value.network_id),
    type,
    macAddress: text(value.mac),
    bootable: bool(value.bootable),
    sourceIpFiltering: bool(value.source_ip_filtering),
    ipAddresses: arrayAt(value.ip_addresses, 'ip_address').map((ip) => normalizeIp(ip, type)),
  };
}

const configFields = [
  'boot_order', 'core_number', 'created', 'firewall', 'firewall_private',
  'firewall_private_default_incoming_action', 'firewall_private_default_outgoing_action',
  'firewall_public_default_incoming_action', 'firewall_public_default_outgoing_action',
  'hostname', 'labels', 'memory_amount', 'metadata', 'nic_model', 'plan',
  'plan_ipv4_bytes', 'plan_ipv6_bytes', 'progress', 'remote_access_enabled',
  'remote_access_type', 'server_group', 'simple_backup', 'state', 'tags',
  'timezone', 'title', 'uuid', 'video_model', 'zone',
] as const;

export function normalizeServerDetails(payload: unknown): UpCloudServerDetails {
  const value = object(object(payload).server);
  const summary = normalizeServerSummary(value);
  const storageValues = arrayAt(value.storage_devices, 'storage_device');
  const storages = value.storage_devices === undefined
    ? null
    : storageValues.map(normalizeStorage).filter((item): item is UpCloudStorage => item !== null);

  let networks: UpCloudNetwork[] | null = null;
  if (value.networking !== undefined) {
    const interfaces = arrayAt(object(value.networking).interfaces, 'interface');
    networks = interfaces.map(normalizeNetwork).filter((item): item is UpCloudNetwork => item !== null);
  } else if (value.ip_addresses !== undefined) {
    networks = [{
      index: 0,
      networkUuid: null,
      type: null,
      macAddress: null,
      bootable: null,
      sourceIpFiltering: null,
      ipAddresses: arrayAt(value.ip_addresses, 'ip_address').map((ip) => normalizeIp(ip)),
    }];
  }

  const labels = (storages ?? []).flatMap((storage) => storage.labels);
  const brand = labels.find((label) => label.key === '_os_brand_name')?.value;
  const version = labels.find((label) => label.key === '_os_brand_version')?.value;
  const created = number(value.created, 0);
  const config: Record<string, unknown> = {};
  for (const field of configFields) {
    if (value[field] !== undefined && !['password', 'remote_access_password', 'vnc_password'].includes(field)) {
      config[field] = value[field];
    }
  }
  return {
    ...summary,
    osName: brand ? `${brand}${version ? ` ${version}` : ''}` : null,
    upcloudCreatedAt: created > 0 ? new Date(created * 1000) : null,
    config,
    storages,
    networks,
  };
}

export function normalizeStats(payload: unknown, period: UpCloudStatsSummary['period']): UpCloudStatsSummary {
  const periodData = object(object(payload).stats)[period];
  const variables = arrayAt(object(object(periodData).summary), 'variable').flatMap((input) => {
    const value = object(input);
    const title = text(value.title);
    if (!title) return [];
    return [{
      title,
      current: text(value.current) ?? '',
      average: text(value.average) ?? '',
      maximum: text(value.maximum) ?? '',
      total: text(value.total) ?? '',
    }];
  });
  return { period, variables };
}

export function parseMetricValue(raw: string, kind: 'cpu' | 'disk' | 'network'): number | null {
  const match = raw.trim().replace(',', '.').match(/^([0-9]+(?:\.[0-9]+)?)\s*(\S+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2]!;
  if (kind === 'cpu') return unit === '%' && value >= 0 && value <= 100 ? value : null;
  const unitMatch = unit.match(/^([kKMGT]?)(i?)(b|B)(?:ps|\/s)$/);
  if (!unitMatch) return null;
  const prefix = unitMatch[1]!.toUpperCase();
  const binary = unitMatch[2] === 'i';
  const power = ['', 'K', 'M', 'G', 'T'].indexOf(prefix);
  if (power < 0) return null;
  const factor = Math.pow(binary ? 1024 : 1000, power);
  const bits = unitMatch[3] === 'b';
  if (kind === 'network') return value * factor * (bits ? 1 : 8);
  return value * factor * (bits ? 1 / 8 : 1);
}
