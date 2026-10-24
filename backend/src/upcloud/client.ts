import { AppError, sanitizeUpstreamMessage } from '../lib/errors.js';
import { normalizeServerDetails, normalizeServerList, normalizeStats } from './normalize.js';
import type { UpCloudGateway, UpCloudStatsSummary } from './types.js';

const API_BASE_URL = 'https://api.upcloud.com/1.3';
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class UpCloudApiError extends AppError {
  constructor(
    status: number,
    code: string,
    message: string,
    public readonly upstreamStatus?: number,
    public readonly upstreamCode?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(status, code, message);
    this.name = 'UpCloudApiError';
  }
}

type ClientOptions = {
  timeoutMs: number;
  retryBaseMs: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export class UpCloudClient implements UpCloudGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  constructor(private readonly token: string, private readonly options: ClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? API_BASE_URL;
  }

  async getAccount(): Promise<{ username: string | null }> {
    const payload = await this.request('/account');
    const account = (payload as any)?.account;
    return { username: typeof account?.username === 'string' ? account.username : null };
  }

  async listServers() {
    const results = [];
    // Keep batches conservative: some UpCloud API deployments reject larger limit values.
    const limit = 100;
    for (let page = 0; page < 100; page += 1) {
      const payload = await this.request(`/server?limit=${limit}&offset=${page * limit}`);
      const servers = normalizeServerList(payload);
      results.push(...servers);
      if (servers.length < limit) return results;
    }
    throw new UpCloudApiError(502, 'UPCLOUD_ERROR', 'Pagination daftar server UpCloud melebihi batas pengaman.');
  }

  async getServer(uuid: string) {
    return normalizeServerDetails(await this.request(`/server/${encodeURIComponent(uuid)}`));
  }

  async updateServer(uuid: string, identity: { title: string; hostname: string }) {
    return normalizeServerDetails(await this.request(`/server/${encodeURIComponent(uuid)}`, {
      method: 'PUT', body: { server: identity }, retry: false,
    }));
  }

  async getCpuStats(uuid: string, period: UpCloudStatsSummary['period'] = 'daily') {
    return normalizeStats(await this.request(`/server/${encodeURIComponent(uuid)}/stats/cpu/${period}`), period);
  }

  async getDiskStats(uuid: string, period: UpCloudStatsSummary['period'] = 'daily') {
    return normalizeStats(await this.request(`/server/${encodeURIComponent(uuid)}/stats/disk/bytes/${period}`), period);
  }

  async getNetworkStats(uuid: string, period: UpCloudStatsSummary['period'] = 'daily') {
    return normalizeStats(await this.request(`/server/${encodeURIComponent(uuid)}/stats/network/bytes/${period}`), period);
  }

  async startServer(uuid: string) {
    return normalizeServerDetails(await this.request(`/server/${encodeURIComponent(uuid)}/start`, {
      method: 'POST', body: { server: { start_type: 'async' } }, retry: false,
    }));
  }

  async stopServer(uuid: string) {
    return normalizeServerDetails(await this.request(`/server/${encodeURIComponent(uuid)}/stop`, {
      method: 'POST', body: { stop_server: { stop_type: 'soft', timeout: '60' } }, retry: false,
    }));
  }

  async restartServer(uuid: string) {
    return normalizeServerDetails(await this.request(`/server/${encodeURIComponent(uuid)}/restart`, {
      method: 'POST',
      body: { restart_server: { stop_type: 'soft', timeout: '60', timeout_action: 'ignore' } },
      retry: false,
    }));
  }

  private async request(path: string, options: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<unknown> {
    const method = options.method ?? 'GET';
    const canRetry = options.retry ?? method === 'GET';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json',
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            'User-Agent': 'CerdasNet-VPS-Control/1.0',
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
          redirect: 'error',
        });
        const responseText = await response.text();
        if (new TextEncoder().encode(responseText).byteLength > MAX_RESPONSE_BYTES) {
          throw new UpCloudApiError(502, 'UPCLOUD_ERROR', 'Respons UpCloud melebihi batas ukuran yang diizinkan.');
        }
        let payload: any = null;
        if (responseText) {
          try { payload = JSON.parse(responseText); } catch {
            throw new UpCloudApiError(502, 'UPCLOUD_ERROR', 'UpCloud mengembalikan respons non-JSON yang tidak valid.');
          }
        }
        if (response.ok) return payload;
        const upstreamCode = String(payload?.error?.error_code ?? payload?.error?.code ?? `HTTP_${response.status}`).slice(0, 100);
        const retryAfter = this.parseRetryAfter(response.headers.get('retry-after'));
        const error = this.toApiError(response.status, upstreamCode, payload?.error?.error_message ?? payload?.error?.message, retryAfter);
        if (canRetry && attempt < 3 && [429, 502, 503, 504].includes(response.status)) {
          if (retryAfter !== undefined && retryAfter > 30) throw error;
          await sleep(this.retryDelay(attempt, retryAfter));
          continue;
        }
        throw error;
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof AppError) throw error;
        if (canRetry && attempt < 3) {
          await sleep(this.retryDelay(attempt));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new UpCloudApiError(502, 'UPSTREAM_UNAVAILABLE', 'Tidak dapat terhubung ke UpCloud API. Periksa koneksi jaringan server panel.', undefined, undefined, undefined);
  }

  private toApiError(status: number, code: string, message: unknown, retryAfter?: number): UpCloudApiError {
    const safeMessage = sanitizeUpstreamMessage(message, [this.token]);
    if (status === 401) {
      return new UpCloudApiError(401, 'UPCLOUD_AUTH_FAILED', 'Autentikasi UpCloud gagal. Token mungkin salah, kedaluwarsa, dicabut, atau dibatasi alamat IP.', status, code, retryAfter);
    }
    if (status === 429) {
      return new UpCloudApiError(429, 'UPCLOUD_RATE_LIMITED', 'Batas request UpCloud tercapai. Coba kembali setelah jeda yang disarankan.', status, code, retryAfter);
    }
    const panelStatus = status === 404 ? 404 : status === 409 || status === 403 || status === 400 ? status : 502;
    return new UpCloudApiError(panelStatus, 'UPCLOUD_ERROR', safeMessage, status, code, retryAfter);
  }

  private parseRetryAfter(value: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
  }

  private retryDelay(attempt: number, retryAfter?: number): number {
    if (retryAfter !== undefined) return retryAfter * 1000;
    const ceiling = Math.min(10_000, this.options.retryBaseMs * 2 ** attempt);
    return Math.floor(Math.random() * ceiling) + 1;
  }
}
