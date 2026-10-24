import { z } from 'zod';
import type { Database } from '../db/index.js';
import type { PanelEvents } from '../lib/events.js';
import { AppError, sanitizeUpstreamMessage } from '../lib/errors.js';
import { base64ToBytes, bytesToBase64, randomId, TokenCipher } from '../lib/crypto.js';
import { ProxmoxClient } from './client.js';

export const proxmoxConnectionSchema = z.object({
  name: z.string().trim().min(3).max(80), baseUrl: z.string().trim().max(500),
  tokenId: z.string().trim().max(200).regex(/^[^@\s]+@[^!\s]+![^\s=]+$/),
  secret: z.string().trim().min(16).max(300).regex(/^\S+$/),
});
function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new AppError(400, 'PROXMOX_URL_INVALID', 'Proxmox memerlukan HTTPS tanpa credential, query, atau fragment pada URL.');
  if (['', '/'].includes(url.pathname)) url.pathname = '/api2/json';
  url.pathname = url.pathname.replace(/\/$/, '');
  if (url.pathname !== '/api2/json') throw new AppError(400, 'PROXMOX_URL_INVALID', 'Gunakan origin Proxmox atau path /api2/json.');
  return url.toString().replace(/\/$/, '');
}
export class ProxmoxService {
  constructor(private readonly db: Database, private readonly cipher: TokenCipher, private readonly events: PanelEvents, private readonly fetchImpl: typeof fetch = globalThis.fetch) {}
  async listConnections() {
    return this.db.read((data) => data.proxmox_connections.map((row) => ({
      id: row.id, name: row.name, baseUrl: row.base_url, tokenId: row.token_id, enabled: row.enabled,
      connectionStatus: row.connection_status, lastError: row.last_error_message, lastSyncedAt: row.last_synced_at,
      resourceCount: data.proxmox_resources.filter((item) => item.connection_id === row.id).length,
    })));
  }
  async create(raw: unknown) {
    const input = proxmoxConnectionSchema.parse(raw);
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const resources = await new ProxmoxClient(baseUrl, input.tokenId, input.secret, this.fetchImpl).listResources();
    const id = randomId();
    const encrypted = this.cipher.encrypt(input.secret, `proxmox:${id}`);
    const now = new Date().toISOString();
    await this.db.withTransaction(({ data }) => {
      if (data.proxmox_connections.some((row) => row.name.toLowerCase() === input.name.toLowerCase())) throw new AppError(409, 'CONFLICT', 'Nama koneksi Proxmox sudah digunakan.');
      data.proxmox_connections.push({
        id, name: input.name, base_url: baseUrl, token_id: input.tokenId,
        ciphertext: bytesToBase64(encrypted.ciphertext), iv: bytesToBase64(encrypted.iv), auth_tag: bytesToBase64(encrypted.authTag),
        key_version: 1, enabled: true, connection_status: 'online', last_error_message: null,
        last_synced_at: now, created_at: now, updated_at: now,
      });
      this.persistResources(data, id, resources, now);
    });
    this.events.publish({ type: 'proxmox', payload: { connectionId: id } });
    return (await this.listConnections()).find((row) => row.id === id);
  }
  async sync(id: string) {
    const connection = await this.db.read((data) => data.proxmox_connections.find((row) => row.id === id));
    if (!connection) throw new AppError(404, 'NOT_FOUND', 'Koneksi Proxmox tidak ditemukan.');
    if (!connection.enabled) throw new AppError(409, 'CONFLICT', 'Koneksi Proxmox dinonaktifkan.');
    try {
      const secret = this.cipher.decrypt({ ciphertext: base64ToBytes(connection.ciphertext), iv: base64ToBytes(connection.iv), authTag: base64ToBytes(connection.auth_tag) }, `proxmox:${id}`);
      const resources = await new ProxmoxClient(connection.base_url, connection.token_id, secret, this.fetchImpl).listResources();
      const now = new Date().toISOString();
      await this.db.withTransaction(({ data }) => {
        const current = data.proxmox_connections.find((row) => row.id === id);
        if (current) Object.assign(current, { connection_status: 'online' as const, last_error_message: null, last_synced_at: now, updated_at: now });
        this.persistResources(data, id, resources, now);
      });
      this.events.publish({ type: 'proxmox', payload: { connectionId: id } });
      return { synchronized: true, resourceCount: resources.length, syncedAt: now };
    } catch (error) {
      await this.db.withTransaction(({ data }) => {
        const current = data.proxmox_connections.find((row) => row.id === id);
        if (current) Object.assign(current, { connection_status: 'offline' as const, last_error_message: sanitizeUpstreamMessage(error instanceof Error ? error.message : 'Sync gagal.'), updated_at: new Date().toISOString() });
      });
      throw error;
    }
  }
  async syncAll() {
    const ids = await this.db.read((data) => data.proxmox_connections.filter((row) => row.enabled).map((row) => row.id));
    const results = await Promise.allSettled(ids.map((id) => this.sync(id)));
    return results.map((result, index) => ({ connectionId: ids[index], ok: result.status === 'fulfilled' }));
  }
  async resources() {
    return this.db.read((data) => data.proxmox_resources.map((row) => {
      const connection = data.proxmox_connections.find((item) => item.id === row.connection_id);
      return {
        id: row.id, connectionId: row.connection_id, connectionName: connection?.name ?? 'Unknown', node: row.node,
        vmid: row.vmid, type: row.type, name: row.name, status: row.status, cpuPercent: row.cpu_percent,
        memoryUsedBytes: row.memory_used_bytes, memoryTotalBytes: row.memory_total_bytes,
        diskUsedBytes: row.disk_used_bytes, diskTotalBytes: row.disk_total_bytes, uptimeSeconds: row.uptime_seconds,
        syncedAt: row.synced_at,
      };
    }).sort((a, b) => a.name.localeCompare(b.name)));
  }
  async power(resourceId: string, action: 'start' | 'shutdown' | 'stop' | 'reboot', confirmationName?: string) {
    const resource = await this.db.read((data) => data.proxmox_resources.find((row) => row.id === resourceId));
    if (action !== 'start' && resource?.name !== confirmationName) throw new AppError(400, 'CONFIRMATION_INVALID', 'Nama konfirmasi resource tidak sesuai.');
    if (!resource) throw new AppError(404, 'NOT_FOUND', 'Resource Proxmox tidak ditemukan. Sinkronisasi mungkin diperlukan.');
    const connection = await this.db.read((data) => data.proxmox_connections.find((row) => row.id === resource.connection_id && row.enabled));
    if (!connection) throw new AppError(409, 'CONFLICT', 'Koneksi Proxmox tidak aktif.');
    const secret = this.cipher.decrypt({ ciphertext: base64ToBytes(connection.ciphertext), iv: base64ToBytes(connection.iv), authTag: base64ToBytes(connection.auth_tag) }, `proxmox:${connection.id}`);
    const result = await new ProxmoxClient(connection.base_url, connection.token_id, secret, this.fetchImpl).power({ node: resource.node, vmid: resource.vmid, type: resource.type, action });
    await this.sync(connection.id);
    return result;
  }
  async remove(id: string, confirmationName: string) {
    await this.db.withTransaction(({ data }) => {
      const connection = data.proxmox_connections.find((row) => row.id === id);
      if (!connection || connection.name !== confirmationName) throw new AppError(400, 'CONFIRMATION_INVALID', 'Nama konfirmasi koneksi tidak sesuai.');
      data.proxmox_connections = data.proxmox_connections.filter((row) => row.id !== id);
      data.proxmox_resources = data.proxmox_resources.filter((row) => row.connection_id !== id);
    });
    return { removed: true, upstreamDeleted: false };
  }
  private persistResources(data: any, connectionId: string, resources: any[], now: string) {
    const previous = new Map(data.proxmox_resources.filter((row: any) => row.connection_id === connectionId).map((row: any) => [`${row.type}:${row.node}:${row.vmid}`, row.id]));
    data.proxmox_resources = data.proxmox_resources.filter((row: any) => row.connection_id !== connectionId);
    for (const resource of resources) data.proxmox_resources.push({
      id: previous.get(`${resource.type}:${resource.node}:${resource.vmid}`) ?? randomId(), connection_id: connectionId,
      node: resource.node, vmid: resource.vmid, type: resource.type, name: resource.name, status: resource.status,
      cpu_percent: resource.cpuPercent, memory_used_bytes: resource.memoryUsedBytes, memory_total_bytes: resource.memoryTotalBytes,
      disk_used_bytes: resource.diskUsedBytes, disk_total_bytes: resource.diskTotalBytes,
      uptime_seconds: resource.uptimeSeconds, raw: resource.raw, synced_at: now,
    });
  }
}
