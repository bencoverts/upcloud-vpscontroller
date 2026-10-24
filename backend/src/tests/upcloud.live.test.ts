import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UpCloudClient } from '../upcloud/client.js';

const enabled = process.env.UPCLOUD_LIVE_TEST === 'true';
const powerAllowed = process.env.UPCLOUD_TEST_ENVIRONMENT === 'nonproduction'
  && process.env.UPCLOUD_ALLOW_POWER_TEST === 'I_AUTHORIZE_NONPRODUCTION_POWER_TEST';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function liveClient(): UpCloudClient {
  if (process.env.UPCLOUD_TEST_ENVIRONMENT !== 'nonproduction') {
    throw new Error('Set UPCLOUD_TEST_ENVIRONMENT=nonproduction to explicitly authorize every live test, including read-only requests.');
  }
  const token = process.env.UPCLOUD_TEST_TOKEN;
  if (!token) throw new Error('Set UPCLOUD_TEST_TOKEN only in the secure shell environment for this opt-in test.');
  return new UpCloudClient(token, { timeoutMs: 20_000, retryBaseMs: 500 });
}
function authorizedUuid(): string {
  return z.string().uuid().parse(process.env.UPCLOUD_TEST_SERVER_UUID, {
    error: 'UPCLOUD_TEST_SERVER_UUID is required and must be an explicitly authorized nonproduction VPS.',
  });
}
async function waitForState(client: UpCloudClient, uuid: string, expected: string): Promise<void> {
  let consecutive = 0;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const current = await client.getServer(uuid);
    consecutive = current.state === expected ? consecutive + 1 : 0;
    if (consecutive >= 2) return;
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for two ${expected} observations on the authorized test VPS.`);
}

describe.skipIf(!enabled)('explicitly authorized UpCloud live contract', () => {
  it('validates the account and reads real server/statistics schemas without mutation', async () => {
    const client = liveClient();
    await expect(client.getAccount()).resolves.toBeTypeOf('object');
    const servers = await client.listServers();
    expect(Array.isArray(servers)).toBe(true);
    const uuid = process.env.UPCLOUD_TEST_SERVER_UUID;
    if (uuid) {
      const authorized = z.string().uuid().parse(uuid);
      const detail = await client.getServer(authorized);
      expect(detail.uuid).toBe(authorized);
      const [cpu, disk, network] = await Promise.all([
        client.getCpuStats(authorized), client.getDiskStats(authorized), client.getNetworkStats(authorized),
      ]);
      for (const stats of [cpu, disk, network]) {
        expect(stats.period).toBe('daily');
        expect(Array.isArray(stats.variables)).toBe(true);
      }
    }
  }, 120_000);

  it.skipIf(!powerAllowed)('runs power operations only on the explicitly authorized nonproduction VPS and restores its initial state', async () => {
    const client = liveClient();
    const uuid = authorizedUuid();
    const initial = await client.getServer(uuid);
    if (!['started', 'stopped'].includes(initial.state)) {
      throw new Error(`Refusing power test while authorized VPS is in ${initial.state}; use started or stopped nonproduction VPS.`);
    }
    try {
      if (initial.state === 'started') {
        await client.restartServer(uuid);
        await waitForState(client, uuid, 'started');
        await client.stopServer(uuid);
        await waitForState(client, uuid, 'stopped');
        await client.startServer(uuid);
        await waitForState(client, uuid, 'started');
      } else {
        await client.startServer(uuid);
        await waitForState(client, uuid, 'started');
        await client.stopServer(uuid);
        await waitForState(client, uuid, 'stopped');
      }
    } finally {
      const current = await client.getServer(uuid);
      if (initial.state === 'started' && current.state === 'stopped') {
        await client.startServer(uuid);
        await waitForState(client, uuid, 'started');
      } else if (initial.state === 'stopped' && current.state === 'started') {
        await client.stopServer(uuid);
        await waitForState(client, uuid, 'stopped');
      }
    }
  }, 240_000);
});
