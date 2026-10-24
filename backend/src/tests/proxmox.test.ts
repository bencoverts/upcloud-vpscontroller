import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHarness, withCsrf } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());
const resource = { id: 'resource', vmid: 101, node: 'pve1', type: 'qemu', name: 'billing-vm', status: 'running', cpu: 0.125, mem: 512, maxmem: 2048, disk: 1000, maxdisk: 5000, uptime: 60 };

describe('Proxmox integration', () => {
  it('encrypts API secrets, reads real resource shapes, and verifies task UPID completion', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      expect(init?.headers).toMatchObject({ Authorization: 'PVEAPIToken=panel@pam!automation=0123456789abcdef' });
      if (url.includes('/status/start')) return new Response(JSON.stringify({ data: 'UPID:pve1:00000001:00000001:123:qmstart:101:panel@pam:' }));
      if (url.includes('/tasks/')) return new Response(JSON.stringify({ data: { status: 'stopped', exitstatus: 'OK' } }));
      if (url.includes('/cluster/resources')) return new Response(JSON.stringify({ data: [resource, { ...resource, id: 'empty', vmid: 102, name: 'empty-vm', cpu: null, mem: null, maxmem: null, disk: null, maxdisk: null, uptime: null }, { ...resource, id: 'template', vmid: 103, template: 1 }] }));
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const harness = await createHarness();
    try {
      const created = await withCsrf(harness, harness.agent.post('/api/proxmox/connections')).send({
        name: 'Proxmox production', baseUrl: 'https://pve.example.com:8006', tokenId: 'panel@pam!automation', secret: '0123456789abcdef',
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.data).not.toHaveProperty('secret');
      expect(await harness.db.read((data) => JSON.stringify(data.proxmox_connections).includes('0123456789abcdef'))).toBe(false);
      const resources = await harness.agent.get('/api/proxmox/resources');
      expect(resources.body.data[0]).toMatchObject({ name: 'billing-vm', cpuPercent: 12.5, memoryUsedBytes: 512 });
      expect(resources.body.data).toHaveLength(2);
      expect(resources.body.data[1]).toMatchObject({ cpuPercent: null, memoryUsedBytes: null, diskUsedBytes: null, uptimeSeconds: null });
      const denied = await withCsrf(harness, harness.agent.post(`/api/proxmox/resources/${resources.body.data[0].id}/actions`)).send({ action: 'start' });
      expect(denied.status).toBe(200); // start does not destroy data and needs no confirmation
      expect(denied.body.data).toMatchObject({ status: 'completed', exitstatus: 'OK' });
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/status/start'))).toBe(true);
    } finally { await harness.close(); }
  });

  it('requires confirmation for destructive power actions', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [resource] }))));
    const harness = await createHarness();
    try {
      await withCsrf(harness, harness.agent.post('/api/proxmox/connections')).send({ name: 'PVE', baseUrl: 'https://pve.example.com', tokenId: 'panel@pam!automation', secret: '0123456789abcdef' });
      const resources = await harness.agent.get('/api/proxmox/resources');
      const response = await withCsrf(harness, harness.agent.post(`/api/proxmox/resources/${resources.body.data[0].id}/actions`)).send({ action: 'stop', confirmationName: 'wrong' });
      expect(response.status).toBe(400);
    } finally { await harness.close(); }
  });
});
