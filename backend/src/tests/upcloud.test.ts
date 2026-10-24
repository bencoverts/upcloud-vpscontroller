import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TokenCipher } from '../lib/crypto.js';
import { UpCloudClient } from '../upcloud/client.js';
import { normalizeServerDetails, parseMetricValue } from '../upcloud/normalize.js';
import { serverOne, serverTwo } from './helpers.js';

describe('UpCloud contract, retry, and token encryption', () => {
  it('uses AES-256-GCM with AAD and detects tampering', () => {
    const cipher = new TokenCipher(Buffer.alloc(32, 11).toString('base64'));
    const id = randomUUID();
    const encrypted = cipher.encrypt('ucat_secret_value', id);
    expect(cipher.decrypt(encrypted, id)).toBe('ucat_secret_value');
    encrypted.ciphertext[0] = encrypted.ciphertext[0]! ^ 1;
    expect(() => cipher.decrypt(encrypted, id)).toThrow();
    expect(() => cipher.decrypt(encrypted, randomUUID())).toThrow();
  });

  it('parses documented units without conflating bits and bytes', () => {
    expect(parseMetricValue('12.5 %', 'cpu')).toBe(12.5);
    expect(parseMetricValue('2 MiBps', 'disk')).toBe(2 * 1024 * 1024);
    expect(parseMetricValue('8 Mbps', 'network')).toBe(8_000_000);
    expect(parseMetricValue('8 MBps', 'network')).toBe(64_000_000);
    expect(parseMetricValue('not available', 'cpu')).toBeNull();
  });

  it('removes remote-access secrets from stored configuration', () => {
    const parsed = normalizeServerDetails({ server: {
      ...serverOne, core_number: '2', memory_amount: '4096', created: 1_700_000_000,
      remote_access_password: 'do-not-store', vnc_password: 'do-not-store', password: 'do-not-store',
      storage_devices: { storage_device: [] }, ip_addresses: { ip_address: [] },
    } });
    expect(JSON.stringify(parsed.config)).not.toContain('do-not-store');
    expect(parsed.upcloudCreatedAt?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('discovers every server with conservative pagination batches and correct offsets', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      uuid: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      title: `Server ${index}`,
      hostname: `server-${index}.example.com`,
      state: 'started',
      zone: 'sg-sin1',
      core_number: '2',
      memory_amount: '4096',
      plan: '2xCPU-4GB',
    }));
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ servers: { server: firstPage } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ servers: { server: [{
        uuid: serverTwo.uuid,
        title: serverTwo.title,
        hostname: serverTwo.hostname,
        state: serverTwo.state,
        zone: serverTwo.zone,
        core_number: String(serverTwo.coreNumber),
        memory_amount: String(serverTwo.memoryMib),
        plan: serverTwo.plan,
      }] } }), { status: 200 }));
    const client = new UpCloudClient('secret', { timeoutMs: 1000, retryBaseMs: 1, fetchImpl: fetchMock, baseUrl: 'https://unit.test/1.3' });

    const servers = await client.listServers();

    expect(servers).toHaveLength(101);
    expect(servers.at(-1)?.uuid).toBe(serverTwo.uuid);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://unit.test/1.3/server?limit=100&offset=0',
      'https://unit.test/1.3/server?limit=100&offset=100',
    ]);
  });

  it('retries GET on 429 with Retry-After but never retries power operations', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { error_code: 'RATE_LIMIT' } }), { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { error_code: 'RATE_LIMIT' } }), { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ account: { username: 'ok' } }), { status: 200 }));
    const client = new UpCloudClient('secret', { timeoutMs: 1000, retryBaseMs: 1, fetchImpl: fetchMock, baseUrl: 'https://unit.test/1.3' });
    expect(await client.getAccount()).toEqual({ username: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { error_code: 'RATE_LIMIT' } }), { status: 429 }));
    await expect(client.startServer(serverOne.uuid)).rejects.toMatchObject({ code: 'UPCLOUD_RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
