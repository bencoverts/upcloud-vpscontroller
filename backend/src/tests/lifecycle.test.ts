import { describe, expect, it } from 'vitest';
import { createHarness, serverFour, serverOne, serverTwo, waitForJob, withCsrf } from './helpers.js';

const token = `ucat_${'L'.repeat(32)}`;
const templateUuid = '01000000-0000-4000-8000-000030240200';
async function addToken(harness: any) {
  const response = await withCsrf(harness, harness.agent.post('/api/tokens')).send({ name: 'Lifecycle', token, selectedServerUuids: [] });
  expect(response.status).toBe(201);
  await waitForJob(harness, response.body.data.syncJob.id);
  return response.body.data;
}
const login = { sshKeys: [`ssh-ed25519 ${'A'.repeat(43)} test@panel`], passwordDelivery: 'none' };

describe('OS lifecycle and billing deployment API', () => {
  it('exposes real upstream templates, plans, and zones without fabricated pricing', async () => {
    const harness = await createHarness();
    try {
      const saved = await addToken(harness);
      const response = await harness.agent.get(`/api/catalog/${saved.id}`);
      expect(response.status).toBe(200);
      expect(response.body.data.templates[0]).toMatchObject({ uuid: templateUuid, title: 'Ubuntu Server 24.04 LTS' });
      expect(response.body.data).not.toHaveProperty('pricing');
    } finally { await harness.close(); }
  });

  it('requires stopped state or explicit shutdown, then verifies rebuild and never auto-starts', async () => {
    const harness = await createHarness();
    try {
      await addToken(harness);
      const fake = harness.fakes.get(token)!;
      const rejected = await withCsrf(harness, harness.agent.post(`/api/servers/${serverOne.uuid}/rebuild`)).send({
        mode: 'change_os', templateUuid, detachDisk: `01${serverOne.uuid.slice(2)}`,
        confirmationTitle: serverOne.title, shutdownFirst: false, ...login,
      });
      expect(rejected.status).toBe(409);
      expect(fake.stopServer).not.toHaveBeenCalled();
      expect(fake.rebuildServer).not.toHaveBeenCalled();
      const accepted = await withCsrf(harness, harness.agent.post(`/api/servers/${serverOne.uuid}/rebuild`)).send({
        mode: 'change_os', templateUuid, detachDisk: `01${serverOne.uuid.slice(2)}`,
        confirmationTitle: serverOne.title, shutdownFirst: true, deleteDetachedDisk: false, ...login,
      });
      expect(accepted.status).toBe(202);
      await waitForJob(harness, accepted.body.data.id);
      expect(fake.stopServer).toHaveBeenCalledWith(serverOne.uuid);
      expect(fake.rebuildServer).toHaveBeenCalledWith(serverOne.uuid, expect.objectContaining({ deleteDetachedDisk: false }));
      expect(fake.startServer).not.toHaveBeenCalled();
      expect((await harness.agent.get(`/api/servers/${serverOne.uuid}`)).body.data.state).toBe('stopped');
    } finally { await harness.close(); }
  });

  it('rebuilds an already stopped VPS without another stop and rejects wrong confirmation', async () => {
    const harness = await createHarness();
    try {
      await addToken(harness);
      const fake = harness.fakes.get(token)!;
      const wrong = await withCsrf(harness, harness.agent.post(`/api/servers/${serverTwo.uuid}/rebuild`)).send({
        mode: 'reset_os', templateUuid, detachDisk: `01${serverTwo.uuid.slice(2)}`, confirmationTitle: 'wrong', ...login,
      });
      expect(wrong.status).toBe(400);
      const response = await withCsrf(harness, harness.agent.post(`/api/servers/${serverTwo.uuid}/rebuild`)).send({
        mode: 'reset_os', templateUuid, detachDisk: `01${serverTwo.uuid.slice(2)}`, confirmationTitle: serverTwo.title, ...login,
      });
      expect(response.status).toBe(202);
      await waitForJob(harness, response.body.data.id);
      expect(fake.stopServer).not.toHaveBeenCalled();
      expect(fake.rebuildServer).toHaveBeenCalledTimes(1);
    } finally { await harness.close(); }
  });

  it('deploys a selected OS through the billing-ready asynchronous job API', async () => {
    const harness = await createHarness();
    try {
      const saved = await addToken(harness);
      const response = await withCsrf(harness, harness.agent.post('/api/deployments')).send({
        tokenId: saved.id, title: 'Billing VPS', confirmationTitle: 'Billing VPS', hostname: 'billing.example.com', zone: 'sg-sin1', plan: '2xCPU-4GB',
        templateUuid, storageGib: 50, storageTier: 'maxiops', ...login,
      });
      expect(response.status).toBe(202);
      const job = await waitForJob(harness, response.body.data.id);
      expect(job.serverUuid).toBe(serverFour.uuid);
      const detail = await harness.agent.get(`/api/servers/${serverFour.uuid}`);
      expect(detail.body.data).toMatchObject({ title: 'Billing VPS', osName: 'Ubuntu 24.04' });
      expect(harness.fakes.get(token)!.createServer).toHaveBeenCalledWith(expect.objectContaining({ templateUuid }));
    } finally { await harness.close(); }
  });

  it('verifies plan changes and requires exact confirmation for hard stop', async () => {
    const harness = await createHarness();
    try {
      await addToken(harness);
      const wrong = await withCsrf(harness, harness.agent.patch(`/api/servers/${serverTwo.uuid}/configuration`)).send({ plan: '2xCPU-4GB', confirmationTitle: 'wrong' });
      expect(wrong.status).toBe(400);
      const updated = await withCsrf(harness, harness.agent.patch(`/api/servers/${serverTwo.uuid}/configuration`)).send({ plan: '2xCPU-4GB', timezone: 'UTC', bootOrder: 'disk', nicModel: 'virtio', metadata: true, confirmationTitle: serverTwo.title });
      expect(updated.status).toBe(200); expect(updated.body.data.plan).toBe('2xCPU-4GB');
      expect((await withCsrf(harness, harness.agent.patch(`/api/servers/${serverOne.uuid}/configuration`)).send({ plan: '2xCPU-4GB', confirmationTitle: serverOne.title })).status).toBe(409);
      expect((await withCsrf(harness, harness.agent.post(`/api/servers/${serverOne.uuid}/actions`)).send({ action: 'hard_stop', confirmationTitle: 'wrong' })).status).toBe(400);
      const stopped = await withCsrf(harness, harness.agent.post(`/api/servers/${serverOne.uuid}/actions`)).send({ action: 'hard_stop', confirmationTitle: serverOne.title });
      expect(stopped.status).toBe(202); await waitForJob(harness, stopped.body.data.id);
      expect(harness.fakes.get(token)!.stopServer).toHaveBeenCalledWith(serverOne.uuid, 'hard');
    } finally { await harness.close(); }
  });

  it('deletes only a stopped confirmed VPS and preserves cache when upstream verification fails', async () => {
    const harness = await createHarness();
    try {
      await addToken(harness); const fake = harness.fakes.get(token)!;
      expect((await withCsrf(harness, harness.agent.delete(`/api/servers/${serverOne.uuid}`)).send({ confirmationTitle: serverOne.title, deleteStorages: false })).status).toBe(409);
      fake.deleteServer.mockImplementationOnce(async () => undefined);
      const unverified = await withCsrf(harness, harness.agent.delete(`/api/servers/${serverTwo.uuid}`)).send({ confirmationTitle: serverTwo.title, deleteStorages: false });
      expect(unverified.status).toBe(502); expect((await harness.agent.get(`/api/servers/${serverTwo.uuid}`)).status).toBe(200);
      const removed = await withCsrf(harness, harness.agent.delete(`/api/servers/${serverTwo.uuid}`)).send({ confirmationTitle: serverTwo.title, deleteStorages: false });
      expect(removed.status).toBe(200); expect(removed.body.data.deleted).toBe(true);
      expect((await harness.agent.get(`/api/servers/${serverTwo.uuid}`)).status).toBe(404);
      expect(await harness.db.read((data) => data.server_storage.some((row) => row.server_uuid === serverTwo.uuid))).toBe(false);
    } finally { await harness.close(); }
  });
});
