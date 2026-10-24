import { randomId } from '../lib/crypto.js';
import type { Database } from '../db/index.js';
import { activeJobStatuses } from '../db/types.js';
import type { ApiTokenRecord, DatabaseData } from '../db/types.js';
import { AppError } from '../lib/errors.js';
import { base64ToBytes, bytesToBase64, TokenCipher, maskUpCloudToken } from '../lib/crypto.js';
import type { UpCloudGatewayFactory } from '../upcloud/factory.js';
import { UpCloudApiError } from '../upcloud/client.js';
import type { UpCloudServerSummary } from '../upcloud/types.js';
import { deactivateMissingMemberships, persistServer, upsertMembership } from '../servers/catalog.js';

export type TokenRecord = Omit<ApiTokenRecord, 'ciphertext' | 'iv' | 'auth_tag'> & {
  ciphertext: Uint8Array; iv: Uint8Array; auth_tag: Uint8Array;
};

export type TokenInput = {
  name: string;
  token: string;
  expiresAt?: string | null;
  selectedServerUuids: string[];
};

function hydrate(record: ApiTokenRecord): TokenRecord {
  return {
    ...record, ciphertext: base64ToBytes(record.ciphertext),
    iv: base64ToBytes(record.iv), auth_tag: base64ToBytes(record.auth_tag),
  };
}

export class TokenService {
  constructor(
    private readonly db: Database,
    private readonly cipher: TokenCipher,
    private readonly upcloud: UpCloudGatewayFactory,
  ) {}

  async validate(token: string) {
    const client = this.upcloud(token);
    const account = await client.getAccount();
    const servers = await client.listServers();
    return { account, servers, fingerprint: this.cipher.fingerprint(token), maskedToken: maskUpCloudToken(token) };
  }

  async create(input: TokenInput) {
    const fingerprint = this.cipher.fingerprint(input.token);
    if (await this.db.read((data) => data.api_tokens.some((row) => row.fingerprint === fingerprint))) {
      throw new AppError(409, 'CONFLICT', 'Token UpCloud ini sudah terdaftar.');
    }
    const validated = await this.validate(input.token);
    this.assertSelection(input.selectedServerUuids, validated.servers);
    const id = randomId();
    const encrypted = this.cipher.encrypt(input.token, id);
    await this.db.withTransaction(({ data }) => {
      if (data.api_tokens.some((row) => row.fingerprint === fingerprint)) {
        throw new AppError(409, 'CONFLICT', 'Token UpCloud ini sudah terdaftar.');
      }
      const now = new Date().toISOString();
      data.api_tokens.push({
        id, name: input.name, ciphertext: bytesToBase64(encrypted.ciphertext),
        iv: bytesToBase64(encrypted.iv), auth_tag: bytesToBase64(encrypted.authTag),
        key_version: 1, fingerprint, masked_token: maskUpCloudToken(input.token), enabled: true,
        validation_status: 'valid', connection_status: 'online', expires_at: input.expiresAt ?? null,
        expires_at_verified: false, last_error_code: null, last_error_message: null,
        last_validated_at: now, last_used_at: now, last_sync_at: now, created_at: now, updated_at: now,
      });
      this.persistDiscoveredList(data, id, validated.servers);
      this.replaceSelection(data, id, input.selectedServerUuids);
    });
    return this.get(id);
  }

  async replace(id: string, input: Omit<TokenInput, 'name'>) {
    await this.requireRecord(id);
    await this.assertNoActiveJob(id);
    const fingerprint = this.cipher.fingerprint(input.token);
    if (await this.db.read((data) => data.api_tokens.some((row) => row.fingerprint === fingerprint && row.id !== id))) {
      throw new AppError(409, 'CONFLICT', 'Token pengganti sudah digunakan oleh grup lain.');
    }
    const validated = await this.validate(input.token);
    this.assertSelection(input.selectedServerUuids, validated.servers);
    const encrypted = this.cipher.encrypt(input.token, id);
    await this.db.withTransaction(({ data }) => {
      const token = data.api_tokens.find((row) => row.id === id);
      if (!token) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
      this.assertNoActiveJobInData(data, id);
      if (data.api_tokens.some((row) => row.fingerprint === fingerprint && row.id !== id)) {
        throw new AppError(409, 'CONFLICT', 'Token pengganti sudah digunakan oleh grup lain.');
      }
      const now = new Date().toISOString();
      Object.assign(token, {
        ciphertext: bytesToBase64(encrypted.ciphertext), iv: bytesToBase64(encrypted.iv),
        auth_tag: bytesToBase64(encrypted.authTag), key_version: 1, fingerprint,
        masked_token: maskUpCloudToken(input.token), expires_at: input.expiresAt ?? null,
        expires_at_verified: false, validation_status: 'valid' as const, connection_status: 'online' as const,
        last_error_code: null, last_error_message: null, last_validated_at: now,
        last_used_at: now, last_sync_at: now, updated_at: now,
      });
      this.persistDiscoveredList(data, id, validated.servers);
      this.replaceSelection(data, id, input.selectedServerUuids);
    });
    return this.get(id);
  }

  async list() {
    return this.db.read((data) => {
      const tokens = [...data.api_tokens].sort((left, right) => right.created_at.localeCompare(left.created_at));
      return tokens.map((token) => {
        const selected = data.token_server_groups
          .filter((group) => group.token_id === token.id)
          .sort((left, right) => left.slot - right.slot)
          .flatMap((group) => {
            const server = data.servers.find((row) => row.uuid === group.server_uuid);
            const membership = data.token_server_memberships.find((row) => row.token_id === token.id && row.server_uuid === group.server_uuid);
            return server && membership ? [{ ...group, title: server.title, state: server.state, active: membership.active }] : [];
          });
        const activeJob = [...data.sync_jobs]
          .filter((job) => job.token_id === token.id && activeJobStatuses.has(job.status))
          .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
        const serverCount = data.token_server_memberships.filter((row) => row.token_id === token.id && row.active).length;
        return this.toDto(token, serverCount, selected, activeJob);
      });
    });
  }

  async get(id: string) {
    const tokens = await this.list();
    const token = tokens.find((item) => item.id === id);
    if (!token) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
    return token;
  }

  async discoveredServers(id: string) {
    return this.db.read((data) => {
      if (!data.api_tokens.some((row) => row.id === id)) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
      return data.token_server_memberships
        .filter((membership) => membership.token_id === id && membership.active)
        .flatMap((membership) => {
          const server = data.servers.find((row) => row.uuid === membership.server_uuid);
          if (!server) return [];
          const group = data.token_server_groups.find((row) => row.token_id === id && row.server_uuid === server.uuid);
          return [{
            uuid: server.uuid, title: server.title, state: server.state, zone: server.zone,
            coreNumber: Number(server.core_number), memoryMib: Number(server.memory_mib),
            selectedSlot: group?.slot ?? null,
          }];
        })
        .sort((left, right) => left.title.toLowerCase().localeCompare(right.title.toLowerCase()) || left.uuid.localeCompare(right.uuid));
    });
  }

  async update(id: string, input: { name: string; expiresAt?: string | null }) {
    await this.db.withTransaction(({ data }) => {
      const token = data.api_tokens.find((row) => row.id === id);
      if (!token) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
      token.name = input.name;
      if (input.expiresAt !== undefined) {
        token.expires_at = input.expiresAt;
        token.expires_at_verified = false;
      }
      token.updated_at = new Date().toISOString();
    });
    return this.get(id);
  }

  async setEnabled(id: string, enabled: boolean) {
    await this.db.withTransaction(({ data }) => {
      const token = data.api_tokens.find((row) => row.id === id);
      if (!token) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
      if (!enabled) this.assertNoActiveJobInData(data, id);
      token.enabled = enabled;
      token.connection_status = enabled ? 'unknown' : 'offline';
      token.updated_at = new Date().toISOString();
    });
    return this.get(id);
  }

  async setSelection(id: string, serverUuids: string[]) {
    if (serverUuids.length > 2 || new Set(serverUuids).size !== serverUuids.length) {
      throw new AppError(400, 'BAD_REQUEST', 'Pilihan grup harus unik dan maksimal dua server.');
    }
    await this.db.withTransaction(({ data }) => {
      if (!data.api_tokens.some((row) => row.id === id)) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
      const selected = new Set(serverUuids);
      const allowed = data.token_server_memberships.filter((row) => row.token_id === id && row.active && selected.has(row.server_uuid)).length;
      if (allowed !== selected.size) {
        throw new AppError(400, 'BAD_REQUEST', 'Server pilihan harus termasuk server aktif yang ditemukan oleh token ini.');
      }
      this.replaceSelection(data, id, serverUuids);
    });
    return this.get(id);
  }

  async remove(id: string, confirmationName: string): Promise<void> {
    await this.db.withTransaction(({ data }) => {
      const token = data.api_tokens.find((row) => row.id === id);
      if (!token) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
      this.assertNoActiveJobInData(data, id);
      if (token.name !== confirmationName) throw new AppError(400, 'BAD_REQUEST', 'Nama konfirmasi tidak sama dengan nama grup token.');
      data.api_tokens = data.api_tokens.filter((row) => row.id !== id);
      data.token_server_memberships = data.token_server_memberships.filter((row) => row.token_id !== id);
      data.token_server_groups = data.token_server_groups.filter((row) => row.token_id !== id);
      for (const job of data.sync_jobs) if (job.token_id === id) job.token_id = null;
    });
  }

  async test(id: string) {
    const token = await this.requireRecord(id);
    try {
      await this.gatewayFor(token).getAccount();
      await this.markSuccess(id, false);
      return this.get(id);
    } catch (error) {
      await this.markError(token, error);
      throw error;
    }
  }

  private assertNoActiveJobInData(data: DatabaseData, id: string): void {
    if (data.sync_jobs.some((job) => job.token_id === id && activeJobStatuses.has(job.status))) {
      throw new AppError(409, 'CONFLICT', 'Token memiliki job aktif. Tunggu hingga selesai sebelum mengganti, menonaktifkan, atau menghapusnya.');
    }
  }

  private async assertNoActiveJob(id: string): Promise<void> {
    await this.db.read((data) => { this.assertNoActiveJobInData(data, id); });
  }

  async requireRecord(id: string): Promise<TokenRecord> {
    const token = await this.db.read((data) => data.api_tokens.find((row) => row.id === id));
    if (!token) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
    return hydrate(token);
  }

  async listEnabled(): Promise<TokenRecord[]> {
    const tokens = await this.db.read((data) => data.api_tokens
      .filter((row) => row.enabled).sort((left, right) => left.created_at.localeCompare(right.created_at)));
    return tokens.map(hydrate);
  }

  async bestForServer(serverUuid: string): Promise<TokenRecord> {
    const token = await this.db.read((data) => {
      const tokenIds = new Set(data.token_server_memberships
        .filter((row) => row.server_uuid === serverUuid && row.active).map((row) => row.token_id));
      return data.api_tokens.filter((row) => row.enabled && tokenIds.has(row.id)).sort((left, right) => {
        const leftUsed = left.last_used_at ? new Date(left.last_used_at).getTime() : 0;
        const rightUsed = right.last_used_at ? new Date(right.last_used_at).getTime() : 0;
        return rightUsed - leftUsed || left.created_at.localeCompare(right.created_at);
      })[0];
    });
    if (!token) throw new AppError(409, 'CONFLICT', 'Tidak ada token aktif yang dapat mengakses server ini.');
    return hydrate(token);
  }

  gatewayFor(token: TokenRecord) {
    if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
      throw new UpCloudApiError(401, 'UPCLOUD_AUTH_FAILED', 'Masa berlaku token telah berakhir. Ganti token atau perbarui metadata masa berlakunya.', 401, 'TOKEN_EXPIRED');
    }
    if (token.key_version !== 1) throw new AppError(500, 'INTERNAL_ERROR', 'Versi kunci enkripsi token tidak dikenali.');
    return this.upcloud(this.cipher.decrypt({ ciphertext: token.ciphertext, iv: token.iv, authTag: token.auth_tag }, token.id));
  }

  async markSuccess(id: string, synced = true): Promise<void> {
    await this.db.withTransaction(({ data }) => {
      const token = data.api_tokens.find((row) => row.id === id);
      if (!token) return;
      const now = new Date().toISOString();
      Object.assign(token, {
        validation_status: 'valid' as const, connection_status: 'online' as const,
        last_error_code: null, last_error_message: null, last_validated_at: now,
        last_used_at: now, updated_at: now,
      });
      if (synced) token.last_sync_at = now;
    });
  }

  async markError(token: TokenRecord, error: unknown): Promise<void> {
    const apiError = error instanceof UpCloudApiError ? error : null;
    const upstreamCode = apiError?.upstreamCode ?? (error instanceof AppError ? error.code : 'CONNECTION_FAILED');
    const expiredLocally = token.expires_at !== null && new Date(token.expires_at).getTime() <= Date.now();
    const expired = expiredLocally || upstreamCode.toUpperCase().includes('EXPIR');
    const authFailed = error instanceof AppError && (error.status === 401 || expired);
    const status = expired ? 'expired' : authFailed ? 'invalid' : token.validation_status;
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Koneksi ke UpCloud gagal.';
    await this.db.withTransaction(({ data }) => {
      const current = data.api_tokens.find((row) => row.id === token.id);
      if (!current) return;
      Object.assign(current, {
        validation_status: status, connection_status: authFailed ? 'offline' as const : 'degraded' as const,
        last_error_code: String(upstreamCode).slice(0, 100), last_error_message: message,
        last_used_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    });
  }

  private persistDiscoveredList(data: DatabaseData, tokenId: string, servers: UpCloudServerSummary[]): void {
    const unique = new Map(servers.map((server) => [server.uuid, server]));
    for (const server of unique.values()) {
      persistServer(data, server);
      upsertMembership(data, tokenId, server.uuid);
    }
    deactivateMissingMemberships(data, tokenId, [...unique.keys()]);
  }

  private replaceSelection(data: DatabaseData, tokenId: string, serverUuids: string[]): void {
    if (serverUuids.length > 2) throw new AppError(400, 'BAD_REQUEST', 'Maksimal dua server dapat dipilih untuk satu grup.');
    data.token_server_groups = data.token_server_groups.filter((row) => row.token_id !== tokenId);
    for (const [index, serverUuid] of serverUuids.entries()) {
      data.token_server_groups.push({
        token_id: tokenId, server_uuid: serverUuid, slot: (index + 1) as 1 | 2,
        created_at: new Date().toISOString(),
      });
    }
  }

  private assertSelection(selection: string[], servers: UpCloudServerSummary[]): void {
    const visible = new Set(servers.map((server) => server.uuid));
    if (selection.length > 2 || new Set(selection).size !== selection.length || selection.some((uuid) => !visible.has(uuid))) {
      throw new AppError(400, 'BAD_REQUEST', 'Pilihan grup harus unik, maksimal dua, dan berisi server yang ditemukan oleh token ini.');
    }
  }

  private toDto(
    token: ApiTokenRecord,
    serverCount: number,
    selected: Array<{ server_uuid: string; title: string; state: string; slot: number; active: boolean }>,
    activeJob?: { id: string; job_type: string; status: string },
  ) {
    return {
      id: token.id, name: token.name, maskedToken: token.masked_token, enabled: token.enabled,
      validationStatus: token.validation_status, connectionStatus: token.connection_status,
      expiresAt: token.expires_at, expiryVerified: token.expires_at_verified,
      lastError: token.last_error_message ? { code: token.last_error_code, message: token.last_error_message } : null,
      lastValidatedAt: token.last_validated_at, lastUsedAt: token.last_used_at, lastSyncAt: token.last_sync_at,
      createdAt: token.created_at, updatedAt: token.updated_at, serverCount,
      activeJob: activeJob ? { id: activeJob.id, type: activeJob.job_type, status: activeJob.status } : null,
      selectedServers: selected.map((server) => ({
        uuid: server.server_uuid, title: server.title, state: server.state,
        slot: Number(server.slot), active: server.active,
      })),
    };
  }
}
