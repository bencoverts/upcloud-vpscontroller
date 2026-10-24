import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sha256 } from '@noble/hashes/sha2.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import type { AuthService } from './service.js';
import { AppError } from '../lib/errors.js';
import { bytesToBase64, hashOpaqueToken, randomId, randomToken, safeHexEqual } from '../lib/crypto.js';

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export class GoogleAuthService {
  constructor(private readonly db: Database, private readonly config: AppConfig, private readonly auth: AuthService, private readonly fetchImpl: typeof fetch = globalThis.fetch) {}
  get enabled() { return Boolean(this.config.googleClientId && this.config.googleClientSecret); }
  status() { return { enabled: this.enabled, accountLinking: 'verified_existing_email' }; }
  async begin() {
    if (!this.enabled) throw new AppError(404, 'GOOGLE_NOT_CONFIGURED', 'Google Auth belum dikonfigurasi.');
    const id = randomId(); const state = randomToken(32); const verifier = randomToken(48); const nonce = randomToken(24);
    const now = new Date();
    await this.db.withTransaction(({ data }) => {
      data.oauth_states = data.oauth_states.filter((row) => new Date(row.expires_at).getTime() > Date.now());
      data.oauth_states.push({ id, state_hash: hashOpaqueToken(state), verifier, nonce, expires_at: new Date(Date.now() + 600_000).toISOString(), created_at: now.toISOString() });
    });
    const challenge = bytesToBase64(sha256(new TextEncoder().encode(verifier))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.config.googleClientId!, redirect_uri: `${this.config.appOrigin}/api/auth/google/callback`,
      response_type: 'code', scope: 'openid email profile', state, code_challenge: challenge,
      code_challenge_method: 'S256', nonce, prompt: 'select_account',
    }).toString();
    return { stateId: id, state, url: url.toString() };
  }
  async callback(input: { stateId: string; state: string; code: string; ipAddress?: string; userAgent?: string }) {
    if (!this.enabled) throw new AppError(404, 'GOOGLE_NOT_CONFIGURED', 'Google Auth belum dikonfigurasi.');
    const pending = await this.db.withTransaction(({ data }) => {
      const row = data.oauth_states.find((item) => item.id === input.stateId && new Date(item.expires_at).getTime() > Date.now());
      if (!row || !safeHexEqual(row.state_hash, hashOpaqueToken(input.state))) throw new AppError(403, 'OAUTH_STATE_INVALID', 'State Google Auth tidak valid atau kedaluwarsa.');
      data.oauth_states = data.oauth_states.filter((item) => item.id !== row.id);
      return row;
    });
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: this.config.googleClientId!, client_secret: this.config.googleClientSecret!,
          code: input.code, code_verifier: pending.verifier, grant_type: 'authorization_code',
          redirect_uri: `${this.config.appOrigin}/api/auth/google/callback`,
        }), signal: controller.signal, redirect: 'error',
      });
      const tokens = await response.json() as any;
      if (!response.ok || typeof tokens.id_token !== 'string') throw new AppError(403, 'GOOGLE_AUTH_FAILED', 'Penukaran kode Google tidak berhasil.');
      const { payload } = await jwtVerify(tokens.id_token, googleJwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: this.config.googleClientId,
      });
      if (payload.nonce !== pending.nonce || !payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true) {
        throw new AppError(403, 'GOOGLE_AUTH_FAILED', 'Identitas Google tidak memiliki email terverifikasi/nonce valid.');
      }
      const email = payload.email.toLowerCase();
      const userId = await this.db.withTransaction(({ data }) => {
        const identity = data.oauth_identities.find((row) => row.provider === 'google' && row.subject === payload.sub);
        const user = identity ? data.users.find((row) => row.id === identity.user_id && !row.disabled)
          : data.users.find((row) => row.email?.toLowerCase() === email && !row.disabled);
        if (!user) throw new AppError(403, 'ACCOUNT_NOT_LINKED', 'Email Google belum terhubung ke akun panel. Admin harus menambahkan email tersebut terlebih dahulu.');
        const now = new Date().toISOString();
        if (identity) { identity.email = email; identity.updated_at = now; }
        else data.oauth_identities.push({ id: randomId(), user_id: user.id, provider: 'google', subject: payload.sub!, email, created_at: now, updated_at: now });
        if (!user.email) user.email = email;
        return user.id;
      });
      return this.auth.createSessionForUser(userId, input);
    } finally { clearTimeout(timer); }
  }
}
