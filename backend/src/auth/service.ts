import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { hashOpaqueToken, randomHex, randomToken } from '../lib/crypto.js';
import { consumeDummyPasswordCheck, hashPassword, verifyPassword } from '../lib/password.js';

export type PanelUser = { id: string; username: string; role: 'admin' | 'viewer' };
export type AuthContext = {
  sessionId: string;
  user: PanelUser;
  csrfToken: string;
  expiresAt: Date;
};

export class AuthService {
  constructor(private readonly db: Database, private readonly config: AppConfig) {}

  async login(username: string, password: string, metadata: { ipAddress?: string; userAgent?: string }) {
    const result = await this.db.query<PanelUser & { password_hash: string; disabled: boolean }>(
      'SELECT id,username,role,password_hash,disabled FROM users WHERE lower(username)=lower($1)', [username]);
    const user = result.rows[0];
    if (!user) {
      await consumeDummyPasswordCheck(password);
      throw new AppError(401, 'UNAUTHENTICATED', 'Username atau password tidak sesuai.');
    }
    const valid = await verifyPassword(user.password_hash, password);
    if (!valid || user.disabled) throw new AppError(401, 'UNAUTHENTICATED', 'Username atau password tidak sesuai.');
    const sessionToken = randomToken();
    const csrfToken = randomHex();
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 60 * 60 * 1000);
    await this.db.query(
      `INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at,ip_address,user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [sessionId, user.id, hashOpaqueToken(sessionToken), csrfToken, expiresAt,
        metadata.ipAddress?.slice(0, 100) ?? null, metadata.userAgent?.slice(0, 300) ?? null]);
    return {
      sessionToken, expiresAt,
      auth: { sessionId, user: { id: user.id, username: user.username, role: user.role }, csrfToken, expiresAt } satisfies AuthContext,
    };
  }

  async authenticate(sessionToken: string): Promise<AuthContext | null> {
    const result = await this.db.query<AuthContext & { token_hash?: string }>(
      `SELECT s.id AS "sessionId",s.csrf_token AS "csrfToken",s.expires_at AS "expiresAt",
        u.id AS "userId",u.username,u.role
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now() AND u.disabled=FALSE`, [hashOpaqueToken(sessionToken)]);
    const row = result.rows[0] as any;
    if (!row) return null;
    await this.db.query("UPDATE sessions SET last_seen_at=now() WHERE id=$1 AND last_seen_at<now()-interval '5 minutes'", [row.sessionId]);
    return {
      sessionId: row.sessionId, csrfToken: row.csrfToken, expiresAt: row.expiresAt,
      user: { id: row.userId, username: row.username, role: row.role },
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE id=$1', [sessionId]);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const result = await this.db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1 AND disabled=FALSE', [userId]);
    if (!result.rows[0] || !await verifyPassword(result.rows[0].password_hash, currentPassword)) {
      throw new AppError(403, 'FORBIDDEN', 'Password saat ini tidak sesuai.');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.db.withTransaction(async (query) => {
      await query.query('UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1', [userId, passwordHash]);
      await query.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
    });
  }
}

export async function bootstrapAdmin(db: Database, username: string, password: string): Promise<PanelUser> {
  const existing = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    throw new AppError(409, 'CONFLICT', 'Bootstrap ditolak: user sudah ada. Gunakan prosedur reset password yang disengaja.');
  }
  const user: PanelUser = { id: randomUUID(), username, role: 'admin' };
  const passwordHash = await hashPassword(password);
  await db.query('INSERT INTO users(id,username,password_hash,role) VALUES ($1,$2,$3,$4)', [user.id, username, passwordHash, user.role]);
  return user;
}
