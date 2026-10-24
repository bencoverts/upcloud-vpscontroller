import { randomId } from '../lib/crypto.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { hashOpaqueToken, randomHex, randomToken } from '../lib/crypto.js';
import { consumeDummyPasswordCheck, hashPassword, verifyPassword } from '../lib/password.js';

export type PanelUser = { id: string; username: string; role: 'admin' | 'client' };
export type AuthContext = {
  sessionId: string;
  user: PanelUser;
  csrfToken: string;
  expiresAt: Date;
};

export class AuthService {
  constructor(private readonly db: Database, private readonly config: AppConfig) {}

  async login(username: string, password: string, metadata: { ipAddress?: string; userAgent?: string }) {
    const user = await this.db.read((data) => data.users.find((row) => row.username.toLowerCase() === username.toLowerCase()));
    if (!user) {
      await consumeDummyPasswordCheck(password);
      throw new AppError(401, 'UNAUTHENTICATED', 'Username atau password tidak sesuai.');
    }
    const valid = await verifyPassword(user.password_hash, password);
    if (!valid || user.disabled) throw new AppError(401, 'UNAUTHENTICATED', 'Username atau password tidak sesuai.');
    const sessionToken = randomToken();
    const csrfToken = randomHex();
    const sessionId = randomId();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 60 * 60 * 1000);
    const now = new Date().toISOString();
    await this.db.withTransaction(({ data }) => {
      data.sessions.push({
        id: sessionId, user_id: user.id, token_hash: hashOpaqueToken(sessionToken), csrf_token: csrfToken,
        expires_at: expiresAt.toISOString(), last_seen_at: now, created_at: now,
        ip_address: metadata.ipAddress?.slice(0, 100) ?? null, user_agent: metadata.userAgent?.slice(0, 300) ?? null,
      });
    });
    return {
      sessionToken, expiresAt,
      auth: { sessionId, user: { id: user.id, username: user.username, role: user.role }, csrfToken, expiresAt } satisfies AuthContext,
    };
  }

  async authenticate(sessionToken: string): Promise<AuthContext | null> {
    const tokenHash = hashOpaqueToken(sessionToken);
    const result = await this.db.read((data) => {
      const session = data.sessions.find((row) => row.token_hash === tokenHash && new Date(row.expires_at).getTime() > Date.now());
      if (!session) return null;
      const user = data.users.find((row) => row.id === session.user_id && !row.disabled);
      return session && user ? { session, user } : null;
    });
    if (!result) return null;
    const { session, user } = result;
    if (Date.now() - new Date(session.last_seen_at).getTime() >= 5 * 60_000) {
      const now = new Date().toISOString();
      await this.db.withTransaction(({ data }) => {
        const current = data.sessions.find((row) => row.id === session.id);
        if (current && new Date(current.last_seen_at).getTime() < Date.now() - 5 * 60_000) current.last_seen_at = now;
      });
    }
    return {
      sessionId: session.id, csrfToken: session.csrf_token, expiresAt: new Date(session.expires_at),
      user: { id: user.id, username: user.username, role: user.role },
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.withTransaction(({ data }) => {
      data.sessions = data.sessions.filter((row) => row.id !== sessionId);
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.db.read((data) => data.users.find((row) => row.id === userId && !row.disabled));
    if (!user || !await verifyPassword(user.password_hash, currentPassword)) {
      throw new AppError(403, 'FORBIDDEN', 'Password saat ini tidak sesuai.');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.db.withTransaction(({ data }) => {
      const current = data.users.find((row) => row.id === userId);
      if (!current) throw new AppError(404, 'NOT_FOUND', 'User tidak ditemukan.');
      current.password_hash = passwordHash;
      current.updated_at = new Date().toISOString();
      data.sessions = data.sessions.filter((row) => row.user_id !== userId);
    });
  }
}

export async function bootstrapAdmin(db: Database, username: string, password: string): Promise<PanelUser> {
  const user: PanelUser = { id: randomId(), username, role: 'admin' };
  const passwordHash = await hashPassword(password);
  await db.withTransaction(({ data }) => {
    if (data.users.length > 0) {
      throw new AppError(409, 'CONFLICT', 'Bootstrap ditolak: user sudah ada. Gunakan prosedur reset password yang disengaja.');
    }
    const now = new Date().toISOString();
    data.users.push({
      id: user.id, username: user.username, password_hash: passwordHash, role: user.role,
      disabled: false, created_at: now, updated_at: now,
    });
  });
  return user;
}
