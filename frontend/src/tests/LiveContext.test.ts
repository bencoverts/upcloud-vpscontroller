import { describe, expect, it } from 'vitest';
import { mergeSample } from '../context/LiveContext';
import type { MetricSample } from '../types';

const oldTime = '2026-01-01T00:00:00.000Z';
const newTime = '2026-01-01T00:01:00.000Z';

function sample(overrides: Partial<MetricSample>): MetricSample {
  return {
    sampledAt: oldTime, sourcePeriod: 'combined', cpuPercent: null,
    diskReadBytesPerSecond: null, diskWriteBytesPerSecond: null, networkInBitsPerSecond: null, networkOutBitsPerSecond: null,
    filesystemUsedBytes: null, filesystemTotalBytes: null, memoryUsedBytes: null, memoryTotalBytes: null,
    swapUsedBytes: null, swapTotalBytes: null, osUptimeSeconds: null, fieldSampledAt: {}, rawSummary: {}, ...overrides,
  };
}

describe('realtime metric merging', () => {
  it('preserves other-source values and tracks only the fields actually updated', () => {
    const current = sample({
      cpuPercent: 12.5, memoryUsedBytes: 512, memoryTotalBytes: 1024,
      fieldSampledAt: { cpuPercent: oldTime, memoryUsedBytes: oldTime, memoryTotalBytes: oldTime },
    });
    const incoming = sample({
      sampledAt: newTime, sourcePeriod: 'agent', memoryUsedBytes: 768, memoryTotalBytes: 1024, osUptimeSeconds: 60,
      fieldSampledAt: { memoryUsedBytes: newTime, memoryTotalBytes: newTime, osUptimeSeconds: newTime },
    });
    const merged = mergeSample(current, incoming);
    expect(merged.cpuPercent).toBe(12.5);
    expect(merged.memoryUsedBytes).toBe(768);
    expect(merged.osUptimeSeconds).toBe(60);
    expect(merged.sourcePeriod).toBe('combined');
    expect(merged.sampledAt).toBe(newTime);
    expect(merged.fieldSampledAt).toMatchObject({ cpuPercent: oldTime, memoryUsedBytes: newTime, osUptimeSeconds: newTime });
  });

  it('does not erase guest values when an UpCloud-only sample arrives', () => {
    const current = sample({ memoryUsedBytes: 512, filesystemUsedBytes: 2048, fieldSampledAt: { memoryUsedBytes: oldTime, filesystemUsedBytes: oldTime } });
    const incoming = sample({ sampledAt: newTime, sourcePeriod: 'daily', cpuPercent: 25, fieldSampledAt: { cpuPercent: newTime } });
    const merged = mergeSample(current, incoming);
    expect(merged).toMatchObject({ cpuPercent: 25, memoryUsedBytes: 512, filesystemUsedBytes: 2048, sourcePeriod: 'combined' });
    expect(merged.fieldSampledAt).toMatchObject({ memoryUsedBytes: oldTime, filesystemUsedBytes: oldTime, cpuPercent: newTime });
  });
});
