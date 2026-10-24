import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { createHarness, serverOne, serverTwo, waitForJob, withCsrf } from './helpers.js';
import type { Harness } from './helpers.js';

const token = `ucat_${'C'.repeat(32)}`;
const password = 'ClientPassword123!';

async function addServer(harness: Harness) {
  const response = await withCsrf(harness, harness.agent.post('/api/tokens')).send({ name: 'Client token', token, selectedServerUuids: [] });
  expect(response.status).toBe(201);
  await waitForJob(harness, response.body.data.syncJob.id);
}

async function createClient(harness: Harness, username = 'client') {
  const response = await withCsrf(harness, harness.agent.post('/api/users')).send({ username, password });
  expect(response.status).toBe(201);
  return response.body.data;
}

async function setAccess(harness: Harness, userId: string, expiresAt: string | null) {
  const response = await withCsrf(harness, harness.agent.put(`/api/users/${userId}/access`)).send({
    access: [{ serverUuid: serverOne.uuid, expiresAt }],
  });
  expect(response.status).toBe(200);
}

async function loginClient(harness: Harness, username = 'client') {
  const agent = supertest.agent(harness.app);
  const login = await agent.post('/api/auth/login').send({ username, password });
  expect(login.status).toBe(200);
  expect(login.body.data.user.role).toBe('client');
  return { agent, csrf: login.body.data.csrfToken as string, user: login.body.data.user };
}

describe('client assignment expiry and guest agent security', () => {
  it('scopes client reads and control, and expiry never powers off the VPS', async () => {
    const harness = await createHarness();
    try {
      await addServer(harness);
      const user = await createClient(harness);
      await setAccess(harness, user.id, new Date(Date.now() + 60_000).toISOString());
      const client = await loginClient(harness);
      const csrf = (request: supertest.Test) => request.set('x-csrf-token', client.csrf);

      const list = await client.agent.get('/api/servers?limit=100');
      expect(list.status).toBe(200);
      expect(list.body.data.items.map((server: any) => server.uuid)).toEqual([serverOne.uuid]);
      expect((await client.agent.get(`/api/servers/${serverOne.uuid}`)).status).toBe(200);
      expect((await client.agent.get(`/api/servers/${serverTwo.uuid}`)).status).toBe(404);
      expect((await client.agent.get('/api/users')).status).toBe(403);
      expect((await client.agent.get('/api/backup')).status).toBe(403);
      expect((await client.agent.get(`/api/servers/${serverOne.uuid}/agent`)).status).toBe(403);

      const sync = await csrf(client.agent.post(`/api/servers/${serverOne.uuid}/sync`)).send({});
      expect(sync.status).toBe(202);
      await waitForJob(harness, sync.body.data.id);

      await setAccess(harness, user.id, new Date(Date.now() - 1000).toISOString());
      const fake = harness.fakes.get(token)!;
      fake.stopServer.mockClear();
      expect((await client.agent.get('/api/servers?limit=100')).body.data.pagination.total).toBe(0);
      expect((await client.agent.get(`/api/servers/${serverOne.uuid}`)).status).toBe(404);
      expect((await client.agent.get(`/api/servers/${serverOne.uuid}/metrics`)).status).toBe(404);
      expect((await csrf(client.agent.post(`/api/servers/${serverOne.uuid}/sync`)).send({})).status).toBe(404);
      expect((await csrf(client.agent.post(`/api/servers/${serverOne.uuid}/actions`)).send({ action: 'stop' })).status).toBe(404);
      expect((await csrf(client.agent.patch(`/api/servers/${serverOne.uuid}/identity`)).send({ title: 'Denied', hostname: 'denied.example.com' })).status).toBe(404);
      expect(fake.stopServer).not.toHaveBeenCalled();
      expect(fake.servers.find((server) => server.uuid === serverOne.uuid)?.state).toBe('started');
      expect((await harness.agent.get(`/api/servers/${serverOne.uuid}`)).body.data.state).toBe('started');
    } finally { await harness.close(); }
  });

  it('renames through upstream, persists the returned identity, audits it, and blocks duplicate submissions', async () => {
    const harness = await createHarness();
    try {
      await addServer(harness);
      const fake = harness.fakes.get(token)!;
      let release: (() => void) | undefined;
      let started = false;
      let markStarted: () => void;
      const upstreamStarted = new Promise<void>((resolve) => { markStarted = resolve; });
      const upstreamGate = new Promise<void>((resolve) => { release = resolve; });
      const original = fake.updateServer.getMockImplementation()!;
      fake.updateServer.mockImplementationOnce(async (uuid, identity) => {
        started = true;
        markStarted();
        await upstreamGate;
        return original(uuid, identity);
      });
      const identity = { title: 'Renamed production', hostname: 'renamed.example.com' };
      const first = withCsrf(harness, harness.agent.patch(`/api/servers/${serverOne.uuid}/identity`)).send(identity).then((response) => response);
      await upstreamStarted;
      expect(started).toBe(true);
      const duplicate = await withCsrf(harness, harness.agent.patch(`/api/servers/${serverOne.uuid}/identity`)).send(identity);
      expect(duplicate.status).toBe(409);
      release?.();
      const completed = await first;
      expect(completed.status).toBe(200);
      expect(completed.body.data).toMatchObject(identity);
      expect(fake.updateServer).toHaveBeenCalledWith(serverOne.uuid, identity);
      const persisted = await harness.agent.get(`/api/servers/${serverOne.uuid}`);
      expect(persisted.body.data).toMatchObject(identity);
      const audit = await harness.agent.get('/api/activity?action=server.identity_update');
      expect(audit.body.data.items[0]).toMatchObject({ outcome: 'success', resourceId: serverOne.uuid });
    } finally { await harness.close(); }
  });

  it('does not persist a failed rename or claim upstream success', async () => {
    const harness = await createHarness();
    try {
      await addServer(harness);
      const fake = harness.fakes.get(token)!;
      fake.updateServer.mockRejectedValueOnce(new Error('Upstream rejected modification'));
      const response = await withCsrf(harness, harness.agent.patch(`/api/servers/${serverOne.uuid}/identity`)).send({ title: 'Not accepted', hostname: 'not-accepted.example.com' });
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      const detail = await harness.agent.get(`/api/servers/${serverOne.uuid}`);
      expect(detail.body.data.title).toBe(serverOne.title);
      expect(detail.body.data.hostname).toBe(serverOne.hostname);
    } finally { await harness.close(); }
  });

  it('rotates a one-time agent credential and accepts only genuine scoped guest samples', async () => {
    const harness = await createHarness();
    try {
      await addServer(harness);
      const rotated = await withCsrf(harness, harness.agent.post(`/api/servers/${serverOne.uuid}/agent/rotate`)).send({});
      expect(rotated.status).toBe(201);
      const agentToken = rotated.body.data.token as string;
      expect(agentToken).toMatch(/^cna_/);
      const status = await harness.agent.get(`/api/servers/${serverOne.uuid}/agent`);
      expect(status.body.data).toMatchObject({ configured: true, lastSeenAt: null });
      expect(JSON.stringify(status.body)).not.toContain(agentToken);
      const stored = await harness.db.read((data) => data.server_agents[0]);
      expect(stored.token_hash).not.toContain(agentToken);

      const sample = {
        serverUuid: serverOne.uuid, filesystemUsedBytes: 20, filesystemTotalBytes: 100, filesystemCount: 2,
        memoryUsedBytes: 30, memoryTotalBytes: 100, swapUsedBytes: 2, swapTotalBytes: 10, osUptimeSeconds: 1234,
      };
      expect((await supertest(harness.app).post('/api/agent/v1/metrics').set('Authorization', 'Bearer wrong').send(sample)).status).toBe(401);
      expect((await supertest(harness.app).post('/api/agent/v1/metrics').set('Authorization', `Bearer ${agentToken}`).send({ ...sample, serverUuid: serverTwo.uuid })).status).toBe(401);
      const accepted = await supertest(harness.app).post('/api/agent/v1/metrics').set('Authorization', `Bearer ${agentToken}`).send(sample);
      expect(accepted.status).toBe(202);
      const detail = await harness.agent.get(`/api/servers/${serverOne.uuid}`);
      expect(detail.body.data.latestMetrics.sourcePeriod).toBe('combined');
      expect(detail.body.data.latestMetrics.fieldSampledAt.filesystemUsedBytes).toBeTruthy();
      expect(detail.body.data.latestMetrics).toMatchObject({ filesystemUsedBytes: 20, memoryUsedBytes: 30, osUptimeSeconds: 1234 });
      const history = await harness.agent.get(`/api/servers/${serverOne.uuid}/metrics?range=1h`);
      expect(history.body.data.availability.filesystemUsage).toMatchObject({ available: true, source: 'guest_agent' });
      expect((await harness.agent.get(`/api/servers/${serverOne.uuid}/agent`)).body.data.lastSeenAt).toBeTruthy();
    } finally { await harness.close(); }
  });

  it('downloads an admin JSON backup without live sessions and rejects clients', async () => {
    const harness = await createHarness();
    try {
      const response = await harness.agent.get('/api/backup').buffer(true).parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toContain('attachment;');
      const backup = JSON.parse(response.body.toString('utf8'));
      expect(backup.schemaVersion).toBe(2);
      expect(backup.sessions).toEqual([]);
      expect(backup.users.some((user: any) => user.username === 'admin')).toBe(true);
    } finally { await harness.close(); }
  });
});
