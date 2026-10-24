import type { Database } from '../db/index.js';
import type { AuthContext, PanelUser } from '../auth/service.js';
import { AppError } from '../lib/errors.js';
import { hashOpaqueToken, randomId, randomToken, safeHexEqual } from '../lib/crypto.js';

export const apiScopes = ['read', 'servers:write', 'servers:deploy', 'admin'] as const;
export type ApiScope = typeof apiScopes[number];

export class PanelApiKeyService {
  constructor(private readonly db: Database) {}
  async create(actor: PanelUser, input: { name: string; scopes: string[]; expiresAt: string | null }) {
    if (actor.role !== 'admin' && input.scopes.includes('admin')) throw new AppError(403, 'FORBIDDEN', 'Client tidak dapat membuat API key dengan scope admin.');
    const token = `cnp_${randomToken(32)}`;
    const id = randomId();
    const prefix = token.slice(0, 12);
    await this.db.withTransaction(({ data }) => {
      if (data.panel_api_keys.some((row) => row.name.toLowerCase() === input.name.toLowerCase() && !row.revoked)) throw new AppError(409, 'CONFLICT', 'Nama API key sudah digunakan.');
      data.panel_api_keys.push({
        id, user_id: actor.id, name: input.name, prefix, token_hash: hashOpaqueToken(token), scopes: input.scopes,
        expires_at: input.expiresAt, last_used_at: null, revoked: false, created_at: new Date().toISOString(),
      });
    });
    return { key: token, record: (await this.list(actor)).find((row) => row.id === id) };
  }
  async list(actor: PanelUser) {
    return this.db.read((data) => data.panel_api_keys.filter((row) => row.user_id === actor.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).map((row) => ({
        id: row.id, name: row.name, prefix: `${row.prefix}…`, scopes: row.scopes,
        expiresAt: row.expires_at, lastUsedAt: row.last_used_at, revoked: row.revoked, createdAt: row.created_at,
      })));
  }
  async revoke(actor: PanelUser, id: string) {
    await this.db.withTransaction(({ data }) => {
      const key = data.panel_api_keys.find((row) => row.id === id && row.user_id === actor.id && !row.revoked);
      if (!key) throw new AppError(404, 'NOT_FOUND', 'API key tidak ditemukan atau sudah dicabut.');
      key.revoked = true;
    });
    return { revoked: true };
  }
  async authenticate(token: string): Promise<AuthContext | null> {
    if (!token.startsWith('cnp_') || token.length > 100) return null;
    const hash = hashOpaqueToken(token);
    const found = await this.db.read((data) => {
      const key = data.panel_api_keys.find((row) => !row.revoked && new Date(row.expires_at ?? '2999-01-01').getTime() > Date.now() && safeHexEqual(row.token_hash, hash));
      if (!key || !safeHexEqual(key.token_hash, hash)) return null;
      const user = data.users.find((row) => row.id === key.user_id && !row.disabled);
      return user ? { key, user } : null;
    });
    if (!found) return null;
    if (!found.key.last_used_at || Date.now() - new Date(found.key.last_used_at).getTime() > 300_000) {
      await this.db.withTransaction(({ data }) => {
        const current = data.panel_api_keys.find((row) => row.id === found.key.id);
        if (current) current.last_used_at = new Date().toISOString();
      });
    }
    return {
      sessionId: `api-key:${found.key.id}`, csrfToken: '', expiresAt: new Date(Date.now() + 300_000),
      user: { id: found.user.id, username: found.user.username, role: found.user.role },
      apiKey: { id: found.key.id, scopes: found.key.scopes },
    };
  }
}
