import type { Database } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { randomId } from '../lib/crypto.js';
import { hashPassword } from '../lib/password.js';
import type { PanelEvents } from '../lib/events.js';

export type ClientAccessInput = { serverUuid: string; expiresAt: string | null };

export class UserService {
  constructor(private readonly db: Database, private readonly events: PanelEvents) {}

  async listClients() {
    return this.db.read((data) => data.users
      .filter((user) => user.role === 'client')
      .sort((left, right) => left.username.localeCompare(right.username))
      .map((user) => ({
        id: user.id, username: user.username, email: user.email, role: user.role, disabled: user.disabled,
        createdAt: user.created_at, updatedAt: user.updated_at,
        access: data.client_server_access.filter((row) => row.user_id === user.id).map((row) => {
          const server = data.servers.find((item) => item.uuid === row.server_uuid);
          return {
            serverUuid: row.server_uuid, title: server?.title ?? 'Server tidak tersedia',
            hostname: server?.hostname ?? null, state: server?.state ?? 'unknown',
            expiresAt: row.expires_at,
            expired: Boolean(row.expires_at && new Date(row.expires_at).getTime() <= Date.now()),
            createdAt: row.created_at, updatedAt: row.updated_at,
          };
        }).sort((left, right) => left.title.localeCompare(right.title)),
      })));
  }

  async createClient(input: { username: string; password: string; email?: string | null }) {
    const id = randomId();
    const passwordHash = await hashPassword(input.password);
    await this.db.withTransaction(({ data }) => {
      if (input.email && data.users.some((user) => user.email?.toLowerCase() === input.email!.toLowerCase())) throw new AppError(409, 'CONFLICT', 'Email sudah digunakan akun lain.');
      if (data.users.some((user) => user.username.toLowerCase() === input.username.toLowerCase())) {
        throw new AppError(409, 'CONFLICT', 'Username sudah digunakan.');
      }
      const now = new Date().toISOString();
      data.users.push({
        id, username: input.username, email: input.email ?? null, display_name: null, password_hash: passwordHash, role: 'client', disabled: false,
        created_at: now, updated_at: now,
      });
    });
    this.events.publish({ type: 'client', payload: { id } });
    return (await this.listClients()).find((user) => user.id === id)!;
  }

  async updateClient(id: string, input: { password?: string; disabled?: boolean; email?: string | null }) {
    const passwordHash = input.password ? await hashPassword(input.password) : null;
    await this.db.withTransaction(({ data }) => {
      const user = data.users.find((row) => row.id === id && row.role === 'client');
      if (!user) throw new AppError(404, 'NOT_FOUND', 'Akun client tidak ditemukan.');
      if (input.email && data.users.some((row) => row.id !== id && row.email?.toLowerCase() === input.email!.toLowerCase())) throw new AppError(409, 'CONFLICT', 'Email sudah digunakan akun lain.');
      if (passwordHash) user.password_hash = passwordHash;
      if (input.disabled !== undefined) user.disabled = input.disabled;
      if (input.email !== undefined) user.email = input.email;
      user.updated_at = new Date().toISOString();
      if (passwordHash || input.disabled === true) data.sessions = data.sessions.filter((session) => session.user_id !== id);
    });
    this.events.publish({ type: 'client', payload: { id } });
    return (await this.listClients()).find((user) => user.id === id)!;
  }

  async replaceAccess(id: string, assignments: ClientAccessInput[]) {
    await this.db.withTransaction(({ data }) => {
      const user = data.users.find((row) => row.id === id && row.role === 'client');
      if (!user) throw new AppError(404, 'NOT_FOUND', 'Akun client tidak ditemukan.');
      const unique = new Set(assignments.map((item) => item.serverUuid));
      if (unique.size !== assignments.length) throw new AppError(400, 'BAD_REQUEST', 'VPS tidak boleh diduplikasi.');
      for (const uuid of unique) {
        if (!data.servers.some((server) => server.uuid === uuid)
          || !data.token_server_memberships.some((row) => row.server_uuid === uuid && row.active)) {
          throw new AppError(400, 'BAD_REQUEST', 'Assignment berisi VPS yang tidak tersedia.');
        }
      }
      const previous = new Map(data.client_server_access.filter((row) => row.user_id === id).map((row) => [row.server_uuid, row]));
      const now = new Date().toISOString();
      data.client_server_access = data.client_server_access.filter((row) => row.user_id !== id);
      for (const assignment of assignments) {
        data.client_server_access.push({
          user_id: id, server_uuid: assignment.serverUuid, expires_at: assignment.expiresAt,
          created_at: previous.get(assignment.serverUuid)?.created_at ?? now, updated_at: now,
        });
      }
    });
    this.events.publish({ type: 'access', payload: { userId: id } });
    return (await this.listClients()).find((user) => user.id === id)!;
  }
}
