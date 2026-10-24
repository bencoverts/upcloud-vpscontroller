import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { api } from '../api';
import PerformancePanel from '../components/PerformancePanel';
import type { MetricSample } from '../types';
import { renderWithProviders, serverFixture } from './utils';

vi.mock('../components/AgentPanel', () => ({ default: () => null }));

const settings = { syncIntervalSeconds: 300, serverPollSeconds: 30, metricsRefreshSeconds: 300, metricsRetentionDays: 30 };

describe('honest monitoring states', () => {
  it('shows unavailable OS metrics and empty history instead of fabricated values', async () => {
    vi.spyOn(api, 'get').mockImplementation(((path: string) => {
      if (path === '/api/settings') return Promise.resolve(settings);
      if (path.includes('/metrics?')) return Promise.resolve({
        range: '1h', points: [], latest: null, downsampled: false, downsamplingStrategy: null,
        source: { type: 'panel_samples', upstreamPeriod: 'daily', timestampMeaning: 'retrieval', note: 'Tidak ada backfill.' },
        availability: {},
      });
      return Promise.reject(new Error(`Unexpected ${path}`));
    }) as typeof api.get);
    vi.spyOn(api, 'post').mockImplementation((() => new Promise(() => {})) as typeof api.post);
    renderWithProviders(<PerformancePanel server={serverFixture()} />);
    expect(await screen.findByText('Belum ada riwayat CPU')).toBeInTheDocument();
    expect(screen.getAllByText(/Tidak tersedia melalui API/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tidak tersedia').length).toBeGreaterThan(4);
    expect(screen.queryByText('25%')).not.toBeInTheDocument();
    expect(screen.getByText('Memuat')).toBeInTheDocument();
  });

  it('renders actual guest-agent RAM, swap, filesystem, and uptime samples', async () => {
    const sampledAt = new Date().toISOString();
    const sample: MetricSample = {
      sampledAt, sourcePeriod: 'combined', cpuPercent: null,
      diskReadBytesPerSecond: null, diskWriteBytesPerSecond: null, networkInBitsPerSecond: null, networkOutBitsPerSecond: null,
      memoryUsedBytes: 512, memoryTotalBytes: 1024, swapUsedBytes: 128, swapTotalBytes: 256,
      filesystemUsedBytes: 2048, filesystemTotalBytes: 4096, osUptimeSeconds: 90061,
      fieldSampledAt: { memoryUsedBytes: sampledAt, swapUsedBytes: sampledAt, filesystemUsedBytes: sampledAt, osUptimeSeconds: sampledAt },
      rawSummary: { source: 'test-fixture' },
    };
    vi.spyOn(api, 'get').mockImplementation(((path: string) => {
      if (path === '/api/settings') return Promise.resolve(settings);
      if (path.includes('/metrics?')) return Promise.resolve({
        range: '1h', points: [sample], latest: sample, downsampled: false, downsamplingStrategy: null,
        source: { type: 'panel_samples', upstreamPeriod: 'daily', timestampMeaning: 'retrieval', note: 'Sampel aktual.' }, availability: {},
      });
      return Promise.reject(new Error(`Unexpected ${path}`));
    }) as typeof api.get);
    vi.spyOn(api, 'post').mockImplementation((() => new Promise(() => {})) as typeof api.post);
    renderWithProviders(<PerformancePanel server={serverFixture({ latestMetrics: sample })} />);
    expect(await screen.findByText('512 B / 1 KiB')).toBeInTheDocument();
    expect(screen.getByText('128 B / 256 B')).toBeInTheDocument();
    expect(screen.getByText('2 KiB / 4 KiB')).toBeInTheDocument();
    expect(screen.getByText('1 hari 1 jam')).toBeInTheDocument();
    expect((await screen.findAllByText('Guest agent')).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Tidak tersedia melalui API · agent OS diperlukan')).not.toBeInTheDocument();
  });
});
