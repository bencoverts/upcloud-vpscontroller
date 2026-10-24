import { describe, expect, it } from 'vitest';
import { createHarness, serverFour, waitForJob, withCsrf } from './helpers.js';
const upstreamToken = `ucat_${'K'.repeat(32)}`;
const templateUuid = '01000000-0000-4000-8000-000030240200';

describe('dashboard API keys and billing scopes', () => {
  it('uses hashed scoped bearer keys without cookies or CSRF and revokes them', async () => {
    const harness = await createHarness();
    try {
      const tokenResponse = await withCsrf(harness, harness.agent.post('/api/tokens')).send({ name: 'Billing', token: upstreamToken, selectedServerUuids: [] });
      await waitForJob(harness, tokenResponse.body.data.syncJob.id);
      const created = await withCsrf(harness, harness.agent.post('/api/api-keys')).send({ name: 'Billing production', scopes: ['read', 'servers:deploy'], expiresAt: null });
      expect(created.status).toBe(201);
      const bearer = created.body.data.key as string;
      expect(bearer.startsWith('cnp_')).toBe(true);
      expect(created.body.data.record).not.toHaveProperty('token_hash');
      expect(await harness.db.read((data) => JSON.stringify(data.panel_api_keys).includes(bearer))).toBe(false);
      const catalog = await harness.agent.get(`/api/catalog/${tokenResponse.body.data.id}`).set('authorization', `Bearer ${bearer}`);
      expect(catalog.status).toBe(200);
      const deployment = await harness.agent.post('/api/deployments').set('authorization', `Bearer ${bearer}`).send({
        tokenId: tokenResponse.body.data.id, title: 'API Key VPS', confirmationTitle: 'API Key VPS', hostname: 'api-key.example.com', zone: 'sg-sin1', plan: '2xCPU-4GB',
        templateUuid, storageGib: 50, storageTier: 'maxiops', sshKeys: [`ssh-ed25519 ${'A'.repeat(43)} billing`], passwordDelivery: 'none',
      });
      expect(deployment.status).toBe(202);
      await waitForJob(harness, deployment.body.data.id);
      expect((await harness.agent.get(`/api/servers/${serverFour.uuid}`).set('authorization', `Bearer ${bearer}`)).status).toBe(200);
      const revoked = await withCsrf(harness, harness.agent.delete(`/api/api-keys/${created.body.data.record.id}`)).send({});
      expect(revoked.status).toBe(200);
      expect((await harness.agent.get('/api/servers').set('authorization', `Bearer ${bearer}`)).status).toBe(401);
    } finally { await harness.close(); }
  });

  it('denies writes with a read-only key and prevents key management through an API key', async () => {
    const harness = await createHarness();
    try {
      const created = await withCsrf(harness, harness.agent.post('/api/api-keys')).send({ name: 'Read only', scopes: ['read'], expiresAt: null });
      const bearer = created.body.data.key;
      expect((await harness.agent.get('/api/dashboard').set('authorization', `Bearer ${bearer}`)).status).toBe(200);
      expect((await harness.agent.post('/api/deployments').set('authorization', `Bearer ${bearer}`).send({})).status).toBe(403);
      expect((await harness.agent.post('/api/api-keys').set('authorization', `Bearer ${bearer}`).send({})).status).toBe(403);
    } finally { await harness.close(); }
  });
});
