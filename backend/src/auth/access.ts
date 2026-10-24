import type { Database } from '../db/index.js';
import type { DatabaseData } from '../db/types.js';
import { AppError } from '../lib/errors.js';
import type { PanelUser } from './service.js';

export function isAdmin(user: PanelUser): boolean {
  return user.role === 'admin';
}

export function accessExpiresAt(data: DatabaseData, user: PanelUser, serverUuid: string): string | null | undefined {
  if (isAdmin(user)) return null;
  return data.client_server_access.find((row) => row.user_id === user.id && row.server_uuid === serverUuid)?.expires_at;
}

export function hasServerAccess(data: DatabaseData, user: PanelUser, serverUuid: string): boolean {
  if (isAdmin(user)) return data.servers.some((row) => row.uuid === serverUuid);
  const access = data.client_server_access.find((row) => row.user_id === user.id && row.server_uuid === serverUuid);
  return Boolean(access && (!access.expires_at || new Date(access.expires_at).getTime() > Date.now()));
}

export async function requireServerAccess(db: Database, user: PanelUser, serverUuid: string): Promise<void> {
  const allowed = await db.read((data) => hasServerAccess(data, user, serverUuid)
    && data.token_server_memberships.some((row) => row.server_uuid === serverUuid && row.active));
  if (!allowed) throw new AppError(404, 'NOT_FOUND', 'Server tidak ditemukan atau akses client telah berakhir.');
}

export function requireAdmin(user: PanelUser): void {
  if (!isAdmin(user)) throw new AppError(403, 'FORBIDDEN', 'Hanya admin yang dapat mengakses resource ini.');
}
