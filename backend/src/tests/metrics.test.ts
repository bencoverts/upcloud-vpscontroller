import { describe, expect, it } from 'vitest';
import { createHarness, serverOne, waitForJob, withCsrf } from './helpers.js';

const tokenA = `ucat_${'A'.repeat(32)}`;

describe('honest UpCloud metrics and local history', () => {
  it('samples canonical CPU, disk, and network values without inventing OS metrics', async () => {
    const harness = await createHarness();
    try {
      const created = await withCsrf(harness, harness.agent.post('/api/tokens')).send({ name: 'Metrics token', token: tokenA, selectedServerUuids: [] });
      await waitForJob(harness, created.body.data.syncJob.id);
      const refreshed = await withCsrf(harness, harness.agent.post(`/api/servers/${serverOne.uuid}/metrics/refresh`)).send({});
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.data.sample.cpuPercent).toBe(12.5);
      expect(refreshed.body.data.sample.diskReadBytesPerSecond).toBe(2 * 1024 * 1024);
      expect(refreshed.body.data.sample.networkInBitsPerSecond).toBe(8_000_000);
      const history = await harness.agent.get(`/api/servers/${serverOne.uuid}/metrics?range=15m`);
      expect(history.body.data.points.length).toBeGreaterThan(0);
      expect(history.body.data.source.upstreamPeriod).toBe('daily');
      expect(history.body.data.availability.memoryUsage.available).toBe(false);
      expect(history.body.data.availability.memoryUsage.source).toBe('agent_required');
      expect(history.body.data.availability.osUptime.available).toBe(false);
      const calls = harness.fakes.get(tokenA)!.getCpuStats.mock.calls.length;
      const cached = await withCsrf(harness, harness.agent.post(`/api/servers/${serverOne.uuid}/metrics/refresh`)).send({});
      expect(cached.body.data.cached).toBe(true);
      expect(harness.fakes.get(tokenA)!.getCpuStats.mock.calls.length).toBe(calls);
    } finally { await harness.close(); }
  });
});
