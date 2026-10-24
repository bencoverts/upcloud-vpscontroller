import { describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createHarness, serverFour, serverOne, waitForJob, withCsrf } from './helpers.js';

describe('customer deployment and scoped keys', () => {
  it('assigns only the newly deployed VPS to the customer and forbids admin scope', async () => {
    const harness = await createHarness();
    try {
      const provider = await withCsrf(harness, harness.agent.post('/api/tokens')).send({ name: 'Customer provider', token: `ucat_${'C'.repeat(32)}`, selectedServerUuids: [] });
      await waitForJob(harness, provider.body.data.syncJob.id);
      const createdUser = await withCsrf(harness, harness.agent.post('/api/users')).send({ username: 'customer', password: 'CustomerPassword123' });
      expect(createdUser.status).toBe(201);
      const customer = supertest.agent(harness.app);
      const login = await customer.post('/api/auth/login').send({ username: 'customer', password: 'CustomerPassword123' });
      expect(login.status).toBe(200); const csrf = login.body.data.csrfToken;
      const adminKey = await customer.post('/api/api-keys').set('x-csrf-token', csrf).send({ name: 'Forbidden admin key', scopes: ['admin'], expiresAt: null });
      expect(adminKey.status).toBe(403);
      const deployment = await customer.post('/api/deployments').set('x-csrf-token', csrf).send({
        tokenId: provider.body.data.id, title: 'Customer VPS', confirmationTitle: 'Customer VPS', hostname: 'customer.example.com', zone: 'sg-sin1', plan: '2xCPU-4GB',
        templateUuid: '01000000-0000-4000-8000-000030240200', storageGib: 50, storageTier: 'maxiops', sshKeys: [`ssh-ed25519 ${'A'.repeat(43)} customer`], passwordDelivery: 'none',
      });
      expect(deployment.status).toBe(202); await waitForJob(harness, deployment.body.data.id);
      expect((await customer.get(`/api/sync/jobs/${deployment.body.data.id}`)).status).toBe(200);
      expect((await customer.get(`/api/servers/${serverFour.uuid}`)).status).toBe(200);
      expect((await customer.get(`/api/servers/${serverOne.uuid}`)).status).toBe(404);
      const key = await customer.post('/api/api-keys').set('x-csrf-token', csrf).send({ name: 'Customer automation', scopes: ['read', 'servers:deploy'], expiresAt: null });
      expect(key.status).toBe(201);
      expect((await customer.get(`/api/servers/${serverFour.uuid}`).set('authorization', `Bearer ${key.body.data.key}`)).status).toBe(200);
      expect((await customer.get('/api/users').set('authorization', `Bearer ${key.body.data.key}`)).status).toBe(403);
    } finally { await harness.close(); }
  });
});
