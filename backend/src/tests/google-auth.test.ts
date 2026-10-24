import { describe, expect, it, vi } from 'vitest';
import { createHarness } from './helpers.js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

describe('Google OIDC', () => {
  it('uses PKCE, one-time state, JWKS, nonce, and an existing verified account email', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey); jwk.kid = 'unit-test'; jwk.alg = 'RS256'; jwk.use = 'sig';
    let nonce = '';
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        const idToken = await new SignJWT({ email: 'admin@example.com', email_verified: true, nonce })
          .setProtectedHeader({ alg: 'RS256', kid: 'unit-test' }).setIssuer('https://accounts.google.com')
          .setAudience('google-client-id').setSubject('google-subject-1').setIssuedAt().setExpirationTime('5m').sign(privateKey);
        return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') return new Response(JSON.stringify({ keys: [jwk] }));
      throw new Error(`Unexpected Google URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const harness = await createHarness({ googleClientId: 'google-client-id', googleClientSecret: 'google-secret' });
    try {
      await harness.db.withTransaction(({ data }) => { data.users[0]!.email = 'admin@example.com'; });
      const begin = await harness.agent.get('/api/auth/google');
      expect(begin.status).toBe(302);
      const target = new URL(begin.headers.location);
      expect(target.searchParams.get('code_challenge_method')).toBe('S256');
      expect(target.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/google/callback');
      nonce = await harness.db.read((data) => data.oauth_states[0]!.nonce);
      const callback = await harness.agent.get(`/api/auth/google/callback?state=${encodeURIComponent(target.searchParams.get('state')!)}&code=unit-code`);
      expect(callback.status).toBe(302);
      expect((await harness.agent.get('/api/auth/me')).status).toBe(200);
      expect(await harness.db.read((data) => data.oauth_states)).toHaveLength(0);
      expect(await harness.db.read((data) => data.oauth_identities[0])).toMatchObject({ provider: 'google', subject: 'google-subject-1' });
    } finally { vi.unstubAllGlobals(); await harness.close(); }
  });
});
