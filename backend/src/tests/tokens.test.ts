import { describe, expect, it } from 'vitest';
import { createHarness, serverFour, serverOne, serverThree, serverTwo, waitForJob, withCsrf } from './helpers.js';
import { UpCloudApiError } from '../upcloud/client.js';

const tokenA = `ucat_${'A'.repeat(32)}`;
const tokenB = `ucat_${'B'.repeat(32)}`;

describe('multi-token manager and server deduplication', () => {
  it('adds multiple tokens, limits selected groups to two, and deduplicates global UUIDs', async () => {
    const harness = await createHarness();
    try {
      const fakeA = harness.fakes.get(tokenA) ?? null;
      expect(fakeA).toBeNull();
      const validated = await withCsrf(harness, harness.agent.post('/api/tokens/validate')).send({ token: tokenA });
      expect(validated.status).toBe(200);
      expect(validated.body.data.servers).toHaveLength(2);
      harness.fakes.get(tokenA)!.servers = [serverOne, serverTwo, serverThree];
      harness.fakeFor(tokenB).servers = [serverOne, serverFour];

      const first = await withCsrf(harness, harness.agent.post('/api/tokens')).send({
        name: 'CerdasNet VPS Group 01', token: tokenA, selectedServerUuids: [serverOne.uuid, serverTwo.uuid],
      });
      expect(first.status).toBe(201);
      expect(first.text).not.toContain(tokenA);
      await waitForJob(harness, first.body.data.syncJob.id);
      const second = await withCsrf(harness, harness.agent.post('/api/tokens')).send({
        name: 'CerdasNet VPS Group 02', token: tokenB, selectedServerUuids: [serverOne.uuid, serverFour.uuid],
      });
      expect(second.status).toBe(201);
      await waitForJob(harness, second.body.data.syncJob.id);

      const tokens = await harness.agent.get('/api/tokens');
      expect(tokens.body.data).toHaveLength(2);
      expect(tokens.body.data.find((item: any) => item.name === 'CerdasNet VPS Group 01').serverCount).toBe(3);
      expect(tokens.body.data.find((item: any) => item.name === 'CerdasNet VPS Group 02').serverCount).toBe(2);
      expect(tokens.text).not.toContain(tokenA);
      expect(tokens.text).not.toContain(tokenB);
      const discovered = await harness.agent.get(`/api/tokens/${first.body.data.id}/servers`);
      expect(discovered.status).toBe(200);
      expect(discovered.body.data).toHaveLength(3);
      expect(discovered.body.data.find((item: any) => item.uuid === serverOne.uuid).selectedSlot).toBe(1);
      expect(discovered.body.data.find((item: any) => item.uuid === serverThree.uuid).selectedSlot).toBeNull();

      const servers = await harness.agent.get('/api/servers?limit=100');
      expect(servers.body.data.pagination.total).toBe(4);
      const duplicate = servers.body.data.items.find((item: any) => item.uuid === serverOne.uuid);
      expect(duplicate.tokens).toHaveLength(2);
      expect(duplicate.storageGib).toBe(50);
      expect(duplicate.publicIps).toEqual(['192.0.2.10']);
      const dashboard = await harness.agent.get('/api/dashboard');
      expect(dashboard.body.data.totalServers).toBe(4);
      expect(dashboard.body.data.totalCores).toBe(9);
      expect(dashboard.body.data.totalStorageGib).toBe(200);

      const tooMany = await withCsrf(harness, harness.agent.put(`/api/tokens/${first.body.data.id}/selection`)).send({
        selectedServerUuids: [serverOne.uuid, serverTwo.uuid, serverThree.uuid],
      });
      expect(tooMany.status).toBe(400);
      const duplicateCredential = await withCsrf(harness, harness.agent.post('/api/tokens')).send({
        name: 'Duplicate', token: tokenA, selectedServerUuids: [],
      });
      expect(duplicateCredential.status).toBe(409);
    } finally { await harness.close(); }
  });

  it('rejects invalid credentials without persisting or leaking them', async () => {
    const harness = await createHarness();
    try {
      const fake = harness.fakeFor(tokenA);
      fake.getAccount.mockRejectedValueOnce(new UpCloudApiError(401, 'UPCLOUD_AUTH_FAILED', 'Authentication failed', 401, 'AUTHENTICATION_FAILED'));
      const response = await withCsrf(harness, harness.agent.post('/api/tokens')).send({
        name: 'Invalid token', token: tokenA, selectedServerUuids: [],
      });
      expect(response.status).toBe(422);
      expect(response.text).not.toContain(tokenA);
      const stored = await harness.db.query('SELECT id FROM api_tokens');
      expect(stored.rowCount).toBe(0);
    } finally { await harness.close(); }
  });

  it('marks a locally expired token and prevents further UpCloud use', async () => {
    const harness = await createHarness();
    try {
      const created = await withCsrf(harness, harness.agent.post('/api/tokens')).send({
        name: 'Expired token', token: tokenA, expiresAt: '2020-01-01T00:00:00Z', selectedServerUuids: [],
      });
      expect(created.status).toBe(201);
      await waitForJob(harness, created.body.data.syncJob.id, 'failed');
      const tokens = await harness.agent.get('/api/tokens');
      expect(tokens.body.data[0].validationStatus).toBe('expired');
      const calls = harness.fakes.get(tokenA)!.listServers.mock.calls.length;
      const retried = await withCsrf(harness, harness.agent.post(`/api/tokens/${created.body.data.id}/sync`)).send({});
      await waitForJob(harness, retried.body.data.id, 'failed');
      expect(harness.fakes.get(tokenA)!.listServers.mock.calls.length).toBe(calls);
    } finally { await harness.close(); }
  });

  it('stores only authenticated ciphertext and supports confirmed deletion', async () => {
    const harness = await createHarness();
    try {
      const created = await withCsrf(harness, harness.agent.post('/api/tokens')).send({
        name: 'Encrypted token', token: tokenA, selectedServerUuids: [],
      });
      await waitForJob(harness, created.body.data.syncJob.id);
      const stored = await harness.db.query<any>('SELECT ciphertext,iv,auth_tag FROM api_tokens WHERE id=$1', [created.body.data.id]);
      expect(Buffer.from(stored.rows[0].ciphertext).toString('utf8')).not.toContain(tokenA);
      expect(Buffer.from(stored.rows[0].iv).byteLength).toBe(12);
      expect(Buffer.from(stored.rows[0].auth_tag).byteLength).toBe(16);
      const rejected = await withCsrf(harness, harness.agent.delete(`/api/tokens/${created.body.data.id}`)).send({ confirmationName: 'wrong' });
      expect(rejected.status).toBe(400);
      const deleted = await withCsrf(harness, harness.agent.delete(`/api/tokens/${created.body.data.id}`)).send({ confirmationName: 'Encrypted token' });
      expect(deleted.status).toBe(200);
      expect(deleted.body.data.upstreamRevoked).toBe(false);
      expect((await harness.db.query('SELECT id FROM api_tokens')).rowCount).toBe(0);
    } finally { await harness.close(); }
  });
});
