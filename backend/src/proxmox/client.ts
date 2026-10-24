import { AppError, sanitizeUpstreamMessage } from '../lib/errors.js';

export type ProxmoxResource = {
  node: string; vmid: number; type: 'qemu' | 'lxc'; name: string; status: string;
  cpuPercent: number | null; memoryUsedBytes: number | null; memoryTotalBytes: number | null;
  diskUsedBytes: number | null; diskTotalBytes: number | null; uptimeSeconds: number | null;
  raw: Record<string, unknown>;
};
const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
export class ProxmoxClient {
  constructor(private readonly baseUrl: string, private readonly tokenId: string, private readonly secret: string, private readonly fetchImpl: typeof fetch = globalThis.fetch) {}
  async listResources(): Promise<ProxmoxResource[]> {
    const payload = await this.request('/cluster/resources?type=vm');
    if (!Array.isArray(payload)) throw new AppError(502, 'PROXMOX_ERROR', 'Respons resource Proxmox tidak valid.');
    return payload.flatMap((row: any) => {
      if (Number(row.template) === 1) return [];
      if (!['qemu', 'lxc'].includes(row.type) || !Number.isInteger(Number(row.vmid)) || typeof row.node !== 'string') return [];
      const allowed = ['status', 'cpu', 'mem', 'maxmem', 'disk', 'maxdisk', 'uptime', 'template', ' hastate'];
      const raw = Object.fromEntries(Object.entries(row).filter(([key]) => allowed.includes(key.trim())));
      return [{
        node: row.node, vmid: Number(row.vmid), type: row.type, name: String(row.name ?? `${row.type}-${row.vmid}`),
        status: String(row.status ?? 'unknown'), cpuPercent: numberOrNull(row.cpu) === null ? null : Number(row.cpu) * 100,
        memoryUsedBytes: numberOrNull(row.mem), memoryTotalBytes: numberOrNull(row.maxmem),
        diskUsedBytes: numberOrNull(row.disk), diskTotalBytes: numberOrNull(row.maxdisk),
        uptimeSeconds: numberOrNull(row.uptime), raw,
      } satisfies ProxmoxResource];
    });
  }
  async power(input: { node: string; vmid: number; type: 'qemu' | 'lxc'; action: 'start' | 'shutdown' | 'stop' | 'reboot' }) {
    const root = `/nodes/${encodeURIComponent(input.node)}/${input.type}/${input.vmid}`;
    const upid = await this.request(`${root}/status/${input.action}`, { method: 'POST', body: {} });
    if (typeof upid !== 'string' || !upid.startsWith('UPID:')) throw new AppError(502, 'PROXMOX_ERROR', 'Proxmox tidak mengembalikan UPID task yang valid.');
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const status = await this.request(`/nodes/${encodeURIComponent(input.node)}/tasks/${encodeURIComponent(upid)}/status`);
      if (status?.status === 'stopped') {
        if (status.exitstatus !== 'OK') throw new AppError(502, 'PROXMOX_TASK_FAILED', `Task Proxmox gagal: ${String(status.exitstatus).slice(0, 100)}`);
        return { upid, status: 'completed', exitstatus: 'OK' };
      }
    }
    throw new AppError(504, 'PROXMOX_TASK_TIMEOUT', 'Task diterima Proxmox tetapi belum selesai sebelum timeout. Periksa UPID di Proxmox; jangan ulangi secara buta.');
  }
  private async request(path: string, options: { method?: string; body?: unknown } = {}): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET', headers: {
          Authorization: `PVEAPIToken=${this.tokenId}=${this.secret}`, Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        }, body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal, redirect: 'error',
      });
      const text = await response.text();
      if (text.length > 4_000_000) throw new AppError(502, 'PROXMOX_ERROR', 'Respons Proxmox terlalu besar.');
      let payload: any;
      try { payload = text ? JSON.parse(text) : {}; } catch { throw new AppError(502, 'PROXMOX_ERROR', 'Proxmox mengembalikan respons non-JSON.'); }
      if (!response.ok) throw new AppError(response.status === 401 || response.status === 403 ? 403 : 502, 'PROXMOX_ERROR', sanitizeUpstreamMessage(payload?.errors ?? payload?.message ?? `Proxmox HTTP ${response.status}`));
      return payload.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'PROXMOX_UNAVAILABLE', 'Tidak dapat terhubung ke Proxmox dengan TLS valid.');
    } finally { clearTimeout(timer); }
  }
}
