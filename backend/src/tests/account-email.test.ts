import { describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createHarness, withCsrf } from './helpers.js';

describe('existing-account email management for Google OIDC', () => {
  it('enforces case-insensitive uniqueness and lets a client manage only their current email', async () => {
    const harness = await createHarness();
    try {
      const created = await withCsrf(harness, harness.agent.post('/api/users')).send({
        username: 'customer', password: 'CustomerPassword123!', email: 'Customer@Example.com', serverAccess: [],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.data.email).toBe('Customer@Example.com');

      const duplicate = await withCsrf(harness, harness.agent.post('/api/users')).send({
        username: 'other-customer', password: 'CustomerPassword123!', email: 'customer@example.COM', serverAccess: [],
      });
      expect(duplicate.status).toBe(409);

      const client = supertest.agent(harness.app);
      const login = await client.post('/api/auth/login').send({ username: 'customer', password: 'CustomerPassword123!' });
      expect(login.status).toBe(200);
      const csrf = login.body.data.csrfToken as string;
      const current = await client.get('/api/auth/email');
      expect(current.body.data).toEqual({ email: 'Customer@Example.com' });

      const invalid = await client.patch('/api/auth/email').set('x-csrf-token', csrf).send({ email: 'not-an-email' });
      expect(invalid.status).toBe(400);
      const updated = await client.patch('/api/auth/email').set('x-csrf-token', csrf).send({ email: 'new-address@example.com' });
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body.data).toEqual({ email: 'new-address@example.com' });

      const adminConflict = await withCsrf(harness, harness.agent.patch('/api/auth/email')).send({ email: 'NEW-ADDRESS@example.com' });
      expect(adminConflict.status).toBe(409);
      const cleared = await client.patch('/api/auth/email').set('x-csrf-token', csrf).send({ email: null });
      expect(cleared.body.data).toEqual({ email: null });

      const forbidden = await client.patch(`/api/users/${harness.user.id}`).set('x-csrf-token', csrf).send({ email: 'admin-takeover@example.com' });
      expect(forbidden.status).toBe(403);
      expect(await harness.db.read((data) => data.audit_logs.some((row) => row.action === 'auth.email_update' && row.user_id === created.body.data.id))).toBe(true);
    } finally { await harness.close(); }
  });
});
