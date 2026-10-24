import { randomUUID } from 'node:crypto';
import type { Database, Queryable } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { TokenCipher, maskUpCloudToken } from '../lib/crypto.js';
import type { UpCloudGatewayFactory } from '../upcloud/factory.js';
import { UpCloudApiError } from '../upcloud/client.js';
import type { UpCloudServerSummary } from '../upcloud/types.js';
import { deactivateMissingMemberships, persistServer, upsertMembership } from '../servers/catalog.js';

export type TokenRecord = {
  id: string; name: string; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; key_version: number;
  fingerprint: string; masked_token: string; enabled: boolean; validation_status: string;
  connection_status: string; expires_at: Date | null; expires_at_verified: boolean;
  last_error_code: string | null; last_error_message: string | null; last_validated_at: Date | null;
  last_used_at: Date | null; last_sync_at: Date | null; created_at: Date; updated_at: Date;
};

export type TokenInput = {
  name: string;
  token: string;
  expiresAt?: string | null;
  selectedServerUuids: string[];
};

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
    const duplicate = await this.db.query<{ id: string }>('SELECT id FROM api_tokens WHERE fingerprint=$1', [fingerprint]);
    if (duplicate.rows[0]) throw new AppError(409, 'CONFLICT', 'Token UpCloud ini sudah terdaftar.');
    const validated = await this.validate(input.token);
    this.assertSelection(input.selectedServerUuids, validated.servers);
    const id = randomUUID();
    const encrypted = this.cipher.encrypt(input.token, id);
    await this.db.withTransaction(async (query) => {
      await query.query(
        `INSERT INTO api_tokens(
          id,name,ciphertext,iv,auth_tag,key_version,fingerprint,masked_token,enabled,
          validation_status,connection_status,expires_at,expires_at_verified,
          last_validated_at,last_used_at,last_sync_at
        ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,TRUE,'valid','online',$8,FALSE,now(),now(),now())`,
        [id, input.name, encrypted.ciphertext, encrypted.iv, encrypted.authTag, fingerprint,
          maskUpCloudToken(input.token), input.expiresAt ?? null],
      );
      await this.persistDiscoveredList(query, id, validated.servers);
      await this.replaceSelection(query, id, input.selectedServerUuids);
    });
    return this.get(id);
  }

  async replace(id: string, input: Omit<TokenInput, 'name'>) {
    await this.requireRecord(id);
    await this.assertNoActiveJob(id);
    const fingerprint = this.cipher.fingerprint(input.token);
    const duplicate = await this.db.query<{ id: string }>('SELECT id FROM api_tokens WHERE fingerprint=$1 AND id<>$2', [fingerprint, id]);
    if (duplicate.rows[0]) throw new AppError(409, 'CONFLICT', 'Token pengganti sudah digunakan oleh grup lain.');
    const validated = await this.validate(input.token);
    this.assertSelection(input.selectedServerUuids, validated.servers);
    const encrypted = this.cipher.encrypt(input.token, id);
    await this.db.withTransaction(async (query) => {
      await query.query(
        `UPDATE api_tokens SET ciphertext=$2,iv=$3,auth_tag=$4,key_version=1,fingerprint=$5,
          masked_token=$6,expires_at=$7,expires_at_verified=FALSE,validation_status='valid',
          connection_status='online',last_error_code=NULL,last_error_message=NULL,
          last_validated_at=now(),last_used_at=now(),last_sync_at=now(),updated_at=now() WHERE id=$1`,
        [id, encrypted.ciphertext, encrypted.iv, encrypted.authTag, fingerprint,
          maskUpCloudToken(input.token), input.expiresAt ?? null],
      );
      await this.persistDiscoveredList(query, id, validated.servers);
      await this.replaceSelection(query, id, input.selectedServerUuids);
    });
    return this.get(id);
  }

  async list() {
    const tokens = await this.db.query<any>(
      `SELECT t.id,t.name,t.masked_token,t.enabled,t.validation_status,t.connection_status,
        t.expires_at,t.expires_at_verified,t.last_error_code,t.last_error_message,
        t.last_validated_at,t.last_used_at,t.last_sync_at,t.created_at,t.updated_at,
        (SELECT COUNT(*)::text FROM token_server_memberships m WHERE m.token_id=t.id AND m.active=TRUE) AS server_count
       FROM api_tokens t ORDER BY t.created_at DESC`);
    const selected = await this.db.query<any>(
      `SELECT g.token_id,g.server_uuid,g.slot,s.title,s.state,m.active
       FROM token_server_groups g JOIN servers s ON s.uuid=g.server_uuid
       JOIN token_server_memberships m ON m.token_id=g.token_id AND m.server_uuid=g.server_uuid
       ORDER BY g.token_id,g.slot`);
    const activeJobs = await this.db.query<any>(`SELECT id,token_id,job_type,status FROM sync_jobs
      WHERE token_id IS NOT NULL AND status IN ('queued','running','verifying') ORDER BY created_at DESC`);
    return tokens.rows.map((token) => this.toDto(
      token,
      selected.rows.filter((server) => server.token_id === token.id),
      activeJobs.rows.find((job) => job.token_id === token.id),
    ));
  }

  async get(id: string) {
    const tokens = await this.list();
    const token = tokens.find((item) => item.id === id);
    if (!token) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
    return token;
  }

  async discoveredServers(id: string) {
    await this.requireRecord(id);
    const result = await this.db.query<any>(
      `SELECT s.uuid,s.title,s.state,s.zone,s.core_number,s.memory_mib,g.slot
       FROM token_server_memberships m JOIN servers s ON s.uuid=m.server_uuid
       LEFT JOIN token_server_groups g ON g.token_id=m.token_id AND g.server_uuid=m.server_uuid
       WHERE m.token_id=$1 AND m.active=TRUE ORDER BY lower(s.title),s.uuid`, [id]);
    return result.rows.map((server) => ({
      uuid: server.uuid, title: server.title, state: server.state, zone: server.zone,
      coreNumber: Number(server.core_number), memoryMib: Number(server.memory_mib),
      selectedSlot: server.slot === null ? null : Number(server.slot),
    }));
  }

  async update(id: string, input: { name: string; expiresAt?: string | null }) {
    await this.requireRecord(id);
    const hasExpiry = input.expiresAt !== undefined;
    const result = await this.db.query(
      `UPDATE api_tokens SET name=$2,expires_at=CASE WHEN $3 THEN $4 ELSE expires_at END,
        expires_at_verified=CASE WHEN $3 THEN FALSE ELSE expires_at_verified END,updated_at=now()
       WHERE id=$1`, [id, input.name, hasExpiry, input.expiresAt ?? null]);
    if (!result.rowCount) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
    return this.get(id);
  }

  async setEnabled(id: string, enabled: boolean) {
    if (!enabled) await this.assertNoActiveJob(id);
    const result = await this.db.query(
      `UPDATE api_tokens SET enabled=$2,connection_status=CASE WHEN $2 THEN 'unknown' ELSE 'offline' END,
        updated_at=now() WHERE id=$1`, [id, enabled]);
    if (!result.rowCount) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
    return this.get(id);
  }

  async setSelection(id: string, serverUuids: string[]) {
    await this.requireRecord(id);
    if (serverUuids.length > 0) {
      const placeholders = serverUuids.map((_, index) => `$${index + 2}`).join(',');
      const allowed = await this.db.query<{ server_uuid: string }>(
        `SELECT server_uuid FROM token_server_memberships WHERE token_id=$1 AND active=TRUE AND server_uuid IN (${placeholders})`,
        [id, ...serverUuids]);
      if (allowed.rowCount !== new Set(serverUuids).size) {
        throw new AppError(400, 'BAD_REQUEST', 'Server pilihan harus termasuk server aktif yang ditemukan oleh token ini.');
      }
    }
    await this.db.withTransaction((query) => this.replaceSelection(query, id, serverUuids));
    return this.get(id);
  }

  async remove(id: string, confirmationName: string): Promise<void> {
    const token = await this.requireRecord(id);
    await this.assertNoActiveJob(id);
    if (token.name !== confirmationName) {
      throw new AppError(400, 'BAD_REQUEST', 'Nama konfirmasi tidak sama dengan nama grup token.');
    }
    await this.db.query('DELETE FROM api_tokens WHERE id=$1', [id]);
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

  private async assertNoActiveJob(id: string): Promise<void> {
    const active = await this.db.query(
      "SELECT id FROM sync_jobs WHERE token_id=$1 AND status IN ('queued','running','verifying') LIMIT 1", [id]);
    if (active.rowCount) throw new AppError(409, 'CONFLICT', 'Token memiliki job aktif. Tunggu hingga selesai sebelum mengganti, menonaktifkan, atau menghapusnya.');
  }

  async requireRecord(id: string): Promise<TokenRecord> {
    const result = await this.db.query<TokenRecord>('SELECT * FROM api_tokens WHERE id=$1', [id]);
    const token = result.rows[0];
    if (!token) throw new AppError(404, 'NOT_FOUND', 'Grup API token tidak ditemukan.');
    return token;
  }

  async listEnabled(): Promise<TokenRecord[]> {
    const result = await this.db.query<TokenRecord>('SELECT * FROM api_tokens WHERE enabled=TRUE ORDER BY created_at');
    return result.rows;
  }

  async bestForServer(serverUuid: string): Promise<TokenRecord> {
    const result = await this.db.query<TokenRecord>(
      `SELECT t.* FROM api_tokens t JOIN token_server_memberships m ON m.token_id=t.id
       WHERE m.server_uuid=$1 AND m.active=TRUE AND t.enabled=TRUE
       ORDER BY t.last_used_at DESC NULLS LAST,t.created_at LIMIT 1`, [serverUuid]);
    const token = result.rows[0];
    if (!token) throw new AppError(409, 'CONFLICT', 'Tidak ada token aktif yang dapat mengakses server ini.');
    return token;
  }

  gatewayFor(token: TokenRecord) {
    if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
      throw new UpCloudApiError(401, 'UPCLOUD_AUTH_FAILED', 'Masa berlaku token telah berakhir. Ganti token atau perbarui metadata masa berlakunya.', 401, 'TOKEN_EXPIRED');
    }
    if (token.key_version !== 1) throw new AppError(500, 'INTERNAL_ERROR', 'Versi kunci enkripsi token tidak dikenali.');
    return this.upcloud(this.cipher.decrypt({ ciphertext: token.ciphertext, iv: token.iv, authTag: token.auth_tag }, token.id));
  }

  async markSuccess(id: string, synced = true): Promise<void> {
    await this.db.query(
      `UPDATE api_tokens SET validation_status='valid',connection_status='online',last_error_code=NULL,
        last_error_message=NULL,last_validated_at=now(),last_used_at=now(),
        last_sync_at=CASE WHEN $2 THEN now() ELSE last_sync_at END,updated_at=now() WHERE id=$1`, [id, synced]);
  }

  async markError(token: TokenRecord, error: unknown): Promise<void> {
    const apiError = error instanceof UpCloudApiError ? error : null;
    const upstreamCode = apiError?.upstreamCode ?? (error instanceof AppError ? error.code : 'CONNECTION_FAILED');
    const expiredLocally = token.expires_at !== null && new Date(token.expires_at).getTime() <= Date.now();
    const expired = expiredLocally || upstreamCode.toUpperCase().includes('EXPIR');
    const authFailed = error instanceof AppError && (error.status === 401 || expired);
    const status = expired ? 'expired' : authFailed ? 'invalid' : token.validation_status;
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Koneksi ke UpCloud gagal.';
    await this.db.query(
      `UPDATE api_tokens SET validation_status=$2,connection_status=$3,last_error_code=$4,
        last_error_message=$5,last_used_at=now(),updated_at=now() WHERE id=$1`,
      [token.id, status, authFailed ? 'offline' : 'degraded', String(upstreamCode).slice(0, 100), message]);
  }

  private async persistDiscoveredList(query: Queryable, tokenId: string, servers: UpCloudServerSummary[]): Promise<void> {
    const unique = new Map(servers.map((server) => [server.uuid, server]));
    for (const server of unique.values()) {
      await persistServer(query, server);
      await upsertMembership(query, tokenId, server.uuid);
    }
    await deactivateMissingMemberships(query, tokenId, [...unique.keys()]);
  }

  private async replaceSelection(query: Queryable, tokenId: string, serverUuids: string[]): Promise<void> {
    await query.query('DELETE FROM token_server_groups WHERE token_id=$1', [tokenId]);
    for (const [index, serverUuid] of serverUuids.entries()) {
      await query.query('INSERT INTO token_server_groups(token_id,server_uuid,slot) VALUES ($1,$2,$3)', [tokenId, serverUuid, index + 1]);
    }
  }

  private assertSelection(selection: string[], servers: UpCloudServerSummary[]): void {
    const visible = new Set(servers.map((server) => server.uuid));
    if (selection.some((uuid) => !visible.has(uuid))) {
      throw new AppError(400, 'BAD_REQUEST', 'Pilihan grup berisi server yang tidak ditemukan oleh token ini.');
    }
  }

  private toDto(token: any, selected: any[], activeJob?: any) {
    return {
      id: token.id, name: token.name, maskedToken: token.masked_token, enabled: token.enabled,
      validationStatus: token.validation_status, connectionStatus: token.connection_status,
      expiresAt: token.expires_at, expiryVerified: token.expires_at_verified,
      lastError: token.last_error_message ? { code: token.last_error_code, message: token.last_error_message } : null,
      lastValidatedAt: token.last_validated_at, lastUsedAt: token.last_used_at, lastSyncAt: token.last_sync_at,
      createdAt: token.created_at, updatedAt: token.updated_at, serverCount: Number(token.server_count),
      activeJob: activeJob ? { id: activeJob.id, type: activeJob.job_type, status: activeJob.status } : null,
      selectedServers: selected.map((server) => ({
        uuid: server.server_uuid, title: server.title, state: server.state,
        slot: Number(server.slot), active: server.active,
      })),
    };
  }
}
