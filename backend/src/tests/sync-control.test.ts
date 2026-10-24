import { describe, expect, it } from 'vitest';
import { UpCloudApiError } from '../upcloud/client.js';
import { createHarness, serverOne, serverTwo, waitForJob, withCsrf } from './helpers.js';

const tokenA = `ucat_${'A'.repeat(32)}`;
const tokenB = `ucat_${'B'.repeat(32)}`;

async function addToken(harness: any, token: string, name = 'Token') {
  const response = await withCsrf(harness, harness.agent.post('/api/tokens')).send({ name, token, selectedServerUuids: [] });
  expect(response.status).toBe(201);
  await waitForJob(harness, response.body.data.syncJob.id);
  return response.body.data;
}

describe('synchronization resilience and verified controls', () => {
  it('isolates one token failure from other tokens and recovers with an explicit retry', async () => {
    const harness = await createHarness();
    try {
      const first = await addToken(harness, tokenA, 'Token A');
      const second = await addToken(harness, tokenB, 'Token B');
      const fakeA = harness.fakes.get(tokenA)!;
      fakeA.listServers.mockRejectedValueOnce(new UpCloudApiError(502, 'UPSTREAM_UNAVAILABLE', 'Upstream unavailable'));
      const all = await withCsrf(harness, harness.agent.post('/api/sync/all')).send({});
      expect(all.status).toBe(202);
      const jobA = all.body.data.jobs.find((job: any) => job.tokenId === first.id);
      const jobB = all.body.data.jobs.find((job: any) => job.tokenId === second.id);
      await waitForJob(harness, jobA.id, 'failed');
      await waitForJob(harness, jobB.id);
      expect((await harness.agent.get('/api/servers?limit=100')).body.data.pagination.total).toBe(2);
      const retry = await withCsrf(harness, harness.agent.post(`/api/sync/jobs/${jobA.id}/retry`)).send({});
      expect(retry.status).toBe(202);
      await waitForJob(harness, retry.body.data.id);
    } finally { await harness.close(); }
  });

  it('starts, stops, and restarts through official actions and verifies final state', async () => {
    const harness = await createHarness();
    try {
      await addToken(harness, tokenA);
      const fake = harness.fakes.get(tokenA)!;
      for (const [action, uuid, expectedState] of [
        ['start', serverTwo.uuid, 'started'], ['stop', serverOne.uuid, 'stopped'], ['restart', serverOne.uuid, 'started'],
      ] as const) {
        const response = await withCsrf(harness, harness.agent.post(`/api/servers/${uuid}/actions`)).send({ action });
        expect(response.status).toBe(202);
        await waitForJob(harness, response.body.data.id);
        const detail = await harness.agent.get(`/api/servers/${uuid}`);
        expect(detail.body.data.state).toBe(expectedState);
      }
      expect(fake.startServer).toHaveBeenCalledTimes(1);
      expect(fake.stopServer).toHaveBeenCalledTimes(1);
      expect(fake.restartServer).toHaveBeenCalledTimes(1);
      const audits = await harness.agent.get('/api/activity?resourceType=server&limit=100');
      expect(audits.body.data.items.some((item: any) => item.action === 'server.restart' && item.outcome === 'success')).toBe(true);
    } finally { await harness.close(); }
  });

  it('does not report success before two target-state observations and prevents duplicate active jobs', async () => {
    const harness = await createHarness();
    try {
      await addToken(harness, tokenA);
      const fake = harness.fakes.get(tokenA)!;
      const originalGet = fake.getServer.getMockImplementation()!;
      fake.getServer.mockImplementation(async (uuid: string) => {
        const server = await originalGet(uuid);
        return { ...server, state: 'maintenance' };
      });
      const response = await withCsrf(harness, harness.agent.post(`/api/servers/${serverOne.uuid}/actions`)).send({ action: 'stop' });
      await waitForJob(harness, response.body.data.id, 'verification_timeout');
      expect(fake.stopServer).toHaveBeenCalledTimes(1);
      const retry = await withCsrf(harness, harness.agent.post(`/api/sync/jobs/${response.body.data.id}/retry`)).send({});
      expect(retry.status).toBe(409);
    } finally { await harness.close(); }
  });

  it('exposes scheduled active jobs and rejects power work on the same token until sync completes', async () => {
    const harness = await createHarness();
    let release: (() => void) | undefined;
    try {
      const token = await addToken(harness, tokenA);
      const fake = harness.fakes.get(tokenA)!;
      const discovered = [...fake.servers];
      const pending = new Promise<typeof fake.servers>((resolve) => { release = () => resolve(discovered); });
      fake.listServers.mockImplementationOnce(() => pending);
      const syncResponse = await withCsrf(harness, harness.agent.post('/api/sync/all')).send({});
      const syncJob = syncResponse.body.data.jobs[0];
      let status = syncJob.status;
      for (let attempt = 0; attempt < 100 && status !== 'running'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        status = (await harness.agent.get(`/api/sync/jobs/${syncJob.id}`)).body.data.status;
      }
      expect(status).toBe('running');
      const detail = await harness.agent.get(`/api/servers/${serverOne.uuid}`);
      expect(detail.body.data.activeJob).toMatchObject({ id: syncJob.id, type: 'token_sync' });
      const power = await withCsrf(harness, harness.agent.post(`/api/servers/${serverOne.uuid}/actions`)).send({ action: 'stop' });
      expect(power.status).toBe(409);
      const disable = await withCsrf(harness, harness.agent.patch(`/api/tokens/${token.id}/enabled`)).send({ enabled: false });
      expect(disable.status).toBe(409);
      const deletion = await withCsrf(harness, harness.agent.delete(`/api/tokens/${token.id}`)).send({ confirmationName: token.name });
      expect(deletion.status).toBe(409);
      release?.();
      await waitForJob(harness, syncJob.id);
      expect((await harness.agent.get(`/api/servers/${serverOne.uuid}`)).body.data.activeJob).toBeNull();
    } finally {
      release?.();
      await harness.close();
    }
  });
});
