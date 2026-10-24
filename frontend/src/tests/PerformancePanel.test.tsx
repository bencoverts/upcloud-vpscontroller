import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { api } from '../api';
import PerformancePanel from '../components/PerformancePanel';
import { renderWithProviders, serverFixture } from './utils';

describe('honest monitoring states', () => {
  it('shows unavailable OS metrics and empty history instead of fabricated values', async () => {
    vi.spyOn(api, 'get').mockImplementation(((path: string) => {
      if (path === '/api/settings') return Promise.resolve({ syncIntervalSeconds: 300, serverPollSeconds: 30, metricsRefreshSeconds: 300, metricsRetentionDays: 30 });
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
    expect(screen.getByText('Tidak tersedia melalui API')).toBeInTheDocument();
    expect(screen.getAllByText('Tidak tersedia').length).toBeGreaterThan(4);
    expect(screen.queryByText('25%')).not.toBeInTheDocument();
    expect(screen.getByText('Memuat')).toBeInTheDocument();
  });
});
