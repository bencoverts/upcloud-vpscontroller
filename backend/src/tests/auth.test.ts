import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { createHarness } from './helpers.js';
import { hashPassword } from '../lib/password.js';

describe('panel authentication and authorization', () => {
  it('requires a session, protects mutations with CSRF, and logs out', async () => {
    const harness = await createHarness();
    try {
      const anonymous = supertest.agent(harness.app);
      expect((await anonymous.get('/api/tokens')).status).toBe(401);
      const wrong = await anonymous.post('/api/auth/login').send({ username: 'admin', password: 'wrong-password' });
      expect(wrong.status).toBe(401);
      expect(wrong.text).not.toContain('wrong-password');
      const login = await anonymous.post('/api/auth/login').send({ username: 'admin', password: 'TestPassword123!' });
      expect(login.status).toBe(200);
      expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
      expect(login.headers['set-cookie'][0]).toContain('SameSite=Lax');
      const csrf = login.body.data.csrfToken;
      expect((await anonymous.post('/api/sync/all').send({})).status).toBe(403);
      expect((await anonymous.post('/api/sync/all').set('x-csrf-token', csrf).send({})).status).toBe(202);
      expect((await anonymous.post('/api/auth/logout').set('x-csrf-token', csrf).send({})).status).toBe(200);
      expect((await anonymous.get('/api/auth/me')).status).toBe(401);
      expect((await harness.agent.get('/api/auth/me')).status).toBe(200);
    } finally { await harness.close(); }
  });

  it('accepts a same-origin request through a proxy and rejects a cross-site origin', async () => {
    const harness = await createHarness({ trustProxy: 1 });
    try {
      const anonymous = supertest.agent(harness.app);
      const login = await anonymous.post('/api/auth/login')
        .set('Host', '3100-preview.example.test')
        .set('X-Forwarded-Proto', 'https')
        .set('Origin', 'https://3100-preview.example.test')
        .set('Sec-Fetch-Site', 'same-origin')
        .send({ username: 'admin', password: 'TestPassword123!' });
      expect(login.status).toBe(200);

      const rejected = await anonymous.post('/api/auth/login')
        .set('Host', '3100-preview.example.test')
        .set('X-Forwarded-Proto', 'https')
        .set('Origin', 'https://attacker.example.test')
        .set('Sec-Fetch-Site', 'same-origin')
        .send({ username: 'admin', password: 'TestPassword123!' });
      expect(rejected.status).toBe(403);
      expect(rejected.body.error.code).toBe('CSRF_INVALID');
    } finally { await harness.close(); }
  });

  it('allows viewers to read but rejects all viewer mutations', async () => {
    const harness = await createHarness();
    try {
      const passwordHash = await hashPassword('ViewerPassword123!');
      await harness.db.withTransaction(({ data }) => {
        const now = new Date().toISOString();
        data.users.push({
          id: randomUUID(), username: 'viewer', password_hash: passwordHash, role: 'viewer',
          disabled: false, created_at: now, updated_at: now,
        });
      });
      const viewer = supertest.agent(harness.app);
      const login = await viewer.post('/api/auth/login').send({ username: 'viewer', password: 'ViewerPassword123!' });
      expect(login.status).toBe(200);
      expect((await viewer.get('/api/dashboard')).status).toBe(200);
      const changed = await viewer.patch('/api/settings').set('x-csrf-token', login.body.data.csrfToken).send({
        syncIntervalSeconds: 300, serverPollSeconds: 30, metricsRefreshSeconds: 60, metricsRetentionDays: 30,
      });
      expect(changed.status).toBe(403);
    } finally { await harness.close(); }
  });

  it('changes the admin password and revokes existing sessions', async () => {
    const harness = await createHarness();
    try {
      const changed = await harness.agent.patch('/api/auth/password')
        .set('x-csrf-token', harness.csrf)
        .send({ currentPassword: 'TestPassword123!', newPassword: 'NewStrongPassword456' });
      expect(changed.status).toBe(200);
      expect(changed.body.data.loginRequired).toBe(true);
      expect((await harness.agent.get('/api/auth/me')).status).toBe(401);
      const oldLogin = await harness.agent.post('/api/auth/login').send({ username: 'admin', password: 'TestPassword123!' });
      expect(oldLogin.status).toBe(401);
      const newLogin = await harness.agent.post('/api/auth/login').send({ username: 'admin', password: 'NewStrongPassword456' });
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.data.user.username).toBe('admin');
    } finally { await harness.close(); }
  });

  it('rate limits repeated login attempts', async () => {
    const harness = await createHarness();
    try {
      const client = supertest.agent(harness.app);
      let lastStatus = 0;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await client.post('/api/auth/login').send({ username: 'admin', password: 'incorrect-password' });
        lastStatus = response.status;
        if (lastStatus === 429) break;
      }
      expect(lastStatus).toBe(429);
    } finally { await harness.close(); }
  });
});
