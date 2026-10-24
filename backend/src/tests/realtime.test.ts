import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import supertest from 'supertest';
import WebSocket from 'ws';
import { describe, expect, it } from 'vitest';
import { attachRealtimeServer } from '../realtime.js';
import { createHarness, serverOne, serverTwo, waitForJob, withCsrf } from './helpers.js';

const token = `ucat_${'D'.repeat(32)}`;

function opened(url: string, cookie: string, origin = 'http://localhost'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket ready timeout')); }, 3000);
    socket.once('error', reject);
    socket.on('message', (message) => {
      const event = JSON.parse(message.toString());
      if (event.type === 'ready') {
        clearTimeout(timeout);
        socket.off('error', reject);
        resolve(socket);
      }
    });
  });
}

function rejected(url: string, cookie: string, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
    socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
    socket.once('open', () => reject(new Error('Cross-origin WebSocket unexpectedly opened')));
    socket.once('error', () => undefined);
    setTimeout(() => { socket.terminate(); reject(new Error('WebSocket rejection timeout')); }, 3000).unref();
  });
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 100));

describe('authenticated scoped WebSocket delivery', () => {
  it('delivers only assigned, unexpired server events to a client and rejects foreign origins', async () => {
    const harness = await createHarness();
    const server = createServer(harness.app);
    const realtime = attachRealtimeServer(server, harness.services);
    let socket: WebSocket | undefined;
    try {
      const added = await withCsrf(harness, harness.agent.post('/api/tokens')).send({ name: 'Realtime', token, selectedServerUuids: [] });
      await waitForJob(harness, added.body.data.syncJob.id);
      const created = await withCsrf(harness, harness.agent.post('/api/users')).send({ username: 'realtime-client', password: 'ClientPassword123!' });
      const userId = created.body.data.id;
      await withCsrf(harness, harness.agent.put(`/api/users/${userId}/access`)).send({ access: [{ serverUuid: serverOne.uuid, expiresAt: null }] });
      const login = await supertest(harness.app).post('/api/auth/login').send({ username: 'realtime-client', password: 'ClientPassword123!' });
      const cookie = login.headers['set-cookie'][0].split(';')[0];
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as AddressInfo).port;
      const url = `ws://127.0.0.1:${port}/api/events`;
      expect(await rejected(url, cookie, 'https://attacker.example.test')).toBe(403);
      socket = await opened(url, cookie);
      const received: any[] = [];
      socket.on('message', (message) => received.push(JSON.parse(message.toString())));

      harness.services.events.publish({ type: 'server', payload: { uuid: serverOne.uuid } });
      harness.services.events.publish({ type: 'server', payload: { uuid: serverTwo.uuid } });
      harness.services.events.publish({ type: 'job', payload: { id: 'own-job', serverUuid: serverOne.uuid, requestedBy: userId } });
      harness.services.events.publish({ type: 'job', payload: { id: 'foreign-job', serverUuid: serverOne.uuid, requestedBy: harness.user.id } });
      await pause();
      expect(received.some((event) => event.type === 'server' && event.payload.uuid === serverOne.uuid)).toBe(true);
      expect(received.some((event) => event.payload.uuid === serverTwo.uuid)).toBe(false);
      expect(received.some((event) => event.payload.id === 'own-job')).toBe(true);
      expect(received.some((event) => event.payload.id === 'foreign-job')).toBe(false);

      received.length = 0;
      await withCsrf(harness, harness.agent.put(`/api/users/${userId}/access`)).send({
        access: [{ serverUuid: serverOne.uuid, expiresAt: new Date(Date.now() - 1000).toISOString() }],
      });
      received.length = 0;
      harness.services.events.publish({ type: 'server', payload: { uuid: serverOne.uuid } });
      harness.services.events.publish({ type: 'metric', payload: { uuid: serverOne.uuid, sample: { cpuPercent: 50 } } });
      await pause();
      expect(received.some((event) => ['server', 'metric'].includes(event.type))).toBe(false);

      const sse = await supertest(harness.app).get('/api/events').set('Cookie', cookie);
      expect(sse.status).toBe(426);
      expect(sse.body.error.code).toBe('WEBSOCKET_REQUIRED');

      const revoked = new Promise<number>((resolve, reject) => {
        socket!.once('close', (code) => resolve(code));
        setTimeout(() => reject(new Error('Revoked WebSocket did not close')), 3000).unref();
      });
      const disabled = await withCsrf(harness, harness.agent.patch(`/api/users/${userId}`)).send({ disabled: true });
      expect(disabled.status).toBe(200);
      expect(await revoked).toBe(4001);
    } finally {
      socket?.terminate();
      realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await harness.close();
    }
  });
});
