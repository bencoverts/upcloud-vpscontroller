import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import supertest from 'supertest';
import { vi } from 'vitest';
import type { AppConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { createApplication } from '../app.js';
import { bootstrapAdmin } from '../auth/service.js';
import type { UpCloudGateway, UpCloudServerDetails, UpCloudServerSummary, UpCloudStatsSummary } from '../upcloud/types.js';

export const testConfig: AppConfig = {
  nodeEnv: 'test', port: 0, appOrigin: 'http://localhost', tokenEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
  databasePath: path.join(tmpdir(), 'cerdasnet-test-placeholder.json'), cookieSecure: false, trustProxy: 0,
  logLevel: 'fatal', sessionTtlHours: 12, upcloudTimeoutMs: 1000, upcloudRetryBaseMs: 1, upcloudDetailsCacheSeconds: 0,
  syncIntervalSeconds: 300, serverPollSeconds: 5, metricsRefreshSeconds: 60, metricsRetentionDays: 30,
  controlVerifyTimeoutMs: 500, controlVerifyIntervalMs: 2, autoSyncOnBoot: false,
};

export const serverOne: UpCloudServerSummary = {
  uuid: '00111111-1111-4111-8111-111111111111', title: 'CerdasNet Production 01', hostname: 'prod-01.example.com',
  state: 'started', zone: 'sg-sin1', coreNumber: 2, memoryMib: 4096, plan: '2xCPU-4GB',
};
export const serverTwo: UpCloudServerSummary = {
  uuid: '00222222-2222-4222-8222-222222222222', title: 'CerdasNet Production 02', hostname: 'prod-02.example.com',
  state: 'stopped', zone: 'fi-hel1', coreNumber: 1, memoryMib: 2048, plan: '1xCPU-2GB',
};
export const serverThree: UpCloudServerSummary = {
  uuid: '00333333-3333-4333-8333-333333333333', title: 'CerdasNet Utility', hostname: 'utility.example.com',
  state: 'maintenance', zone: 'sg-sin1', coreNumber: 4, memoryMib: 8192, plan: 'custom',
};
export const serverFour: UpCloudServerSummary = {
  uuid: '00444444-4444-4444-8444-444444444444', title: 'CerdasNet Backup', hostname: 'backup.example.com',
  state: 'error', zone: 'de-fra1', coreNumber: 2, memoryMib: 4096, plan: 'custom',
};

export function detailsFor(summary: UpCloudServerSummary): UpCloudServerDetails {
  return {
    ...summary, osName: 'Ubuntu 24.04', upcloudCreatedAt: new Date('2026-01-01T00:00:00Z'),
    config: { uuid: summary.uuid, title: summary.title, state: summary.state, timezone: 'UTC' },
    storages: [{
      uuid: `01${summary.uuid.slice(2)}`, title: `Disk ${summary.title}`, sizeGib: 50, tier: 'maxiops',
      deviceType: 'disk', address: 'virtio:0', bootDisk: true, partOfPlan: true,
      labels: [{ key: '_os_brand_name', value: 'Ubuntu' }, { key: '_os_brand_version', value: '24.04' }],
    }],
    networks: [{
      index: 1, networkUuid: '03000000-0000-4000-8000-000000000000', type: 'public', macAddress: 'de:ff:ff:ff:00:01',
      bootable: false, sourceIpFiltering: true,
      ipAddresses: [{ address: '192.0.2.10', family: 'IPv4', access: 'public', floating: false }],
    }, {
      index: 2, networkUuid: '03000000-0000-4000-8045-000000000000', type: 'utility', macAddress: 'de:ff:ff:ff:00:02',
      bootable: false, sourceIpFiltering: true,
      ipAddresses: [{ address: '10.0.0.10', family: 'IPv4', access: 'utility', floating: false }],
    }],
  };
}

function stats(variables: UpCloudStatsSummary['variables']): UpCloudStatsSummary { return { period: 'daily', variables }; }

export class FakeUpCloud implements UpCloudGateway {
  servers: UpCloudServerSummary[] = [serverOne, serverTwo];
  details = new Map<string, UpCloudServerDetails>();
  getAccount = vi.fn(async () => ({ username: 'cerdasnet-test' }));
  listServers = vi.fn(async () => this.servers);
  getServer = vi.fn(async (uuid: string) => {
    const summary = this.servers.find((server) => server.uuid === uuid);
    if (!summary) throw new Error('Server not found in fake');
    const detail = this.details.get(uuid) ?? detailsFor(summary);
    this.details.set(uuid, detail);
    return detail;
  });
  getCpuStats = vi.fn(async (_uuid: string, _period: any = 'daily') => stats([
    { title: 'CPU usage %', current: '12.5 %', average: '10 %', maximum: '80 %', total: '50 seconds' },
  ]));
  getDiskStats = vi.fn(async (_uuid: string, _period: any = 'daily') => stats([
    { title: 'Read', current: '2 MiBps', average: '1 MiBps', maximum: '4 MiBps', total: '1 GiB' },
    { title: 'Write', current: '1 MiBps', average: '0.5 MiBps', maximum: '3 MiBps', total: '512 MiB' },
  ]));
  getNetworkStats = vi.fn(async (_uuid: string, _period: any = 'daily') => stats([
    { title: 'In', current: '8 Mbps', average: '4 Mbps', maximum: '20 Mbps', total: '1 GiB' },
    { title: 'Out', current: '2 Mbps', average: '1 Mbps', maximum: '10 Mbps', total: '512 MiB' },
  ]));
  startServer = vi.fn(async (uuid: string) => this.changeState(uuid, 'started'));
  stopServer = vi.fn(async (uuid: string) => this.changeState(uuid, 'stopped'));
  restartServer = vi.fn(async (uuid: string) => this.changeState(uuid, 'started'));

  private changeState(uuid: string, state: string) {
    const summary = this.servers.find((server) => server.uuid === uuid)!;
    summary.state = state;
    const detail = detailsFor(summary);
    this.details.set(uuid, detail);
    return detail;
  }
}

export async function createHarness(configOverrides: Partial<AppConfig> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cerdasnet-json-test-'));
  const config = { ...testConfig, ...configOverrides, databasePath: path.join(directory, 'database.json') };
  const db = await createDatabase(config);
  try {
    const fakes = new Map<string, FakeUpCloud>();
    const factory = (token: string) => {
      if (!fakes.has(token)) fakes.set(token, new FakeUpCloud());
      return fakes.get(token)!;
    };
    const application = createApplication({ config, db, upcloudFactory: factory });
    const user = await bootstrapAdmin(db, 'admin', 'TestPassword123!');
    const agent = supertest.agent(application.app);
    const loginResponse = await agent.post('/api/auth/login').send({ username: 'admin', password: 'TestPassword123!' });
    if (loginResponse.status !== 200) throw new Error(`Test login failed: ${JSON.stringify(loginResponse.body)}`);
    return {
      ...application, db, fakes, fakeFor: factory, user, agent, directory,
      csrf: loginResponse.body.data.csrfToken as string,
      close: async () => { await db.close(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) {
    await db.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

export async function waitForJob(harness: Harness, id: string, expected = 'succeeded') {
  let job: any;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await harness.agent.get(`/api/sync/jobs/${id}`);
    job = response.body.data;
    if (['succeeded', 'failed', 'verification_timeout'].includes(job?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (job?.status !== expected) throw new Error(`Job ${id} expected ${expected}, got ${JSON.stringify(job)}`);
  return job;
}

export function withCsrf(harness: Harness, request: supertest.Test) {
  return request.set('x-csrf-token', harness.csrf);
}
