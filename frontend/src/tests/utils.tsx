import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../context/ToastContext';
import { JobsProvider } from '../context/JobsContext';
import type { ServerDetail, SyncJob } from '../types';

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: 0 } } });
}
export function renderWithProviders(ui: ReactNode) {
  const queryClient = createQueryClient();
  const result = render(<QueryClientProvider client={queryClient}><ToastProvider><JobsProvider><MemoryRouter>{ui}</MemoryRouter></JobsProvider></ToastProvider></QueryClientProvider>);
  return { ...result, queryClient };
}
export function serverFixture(overrides: Partial<ServerDetail> = {}): ServerDetail {
  return {
    uuid: '5d6f4a7e-1f2f-4b8d-bf2d-6a25a43d9501', title: 'cerdasnet-prod-01', hostname: 'prod-01',
    state: 'started', zone: 'sg-sin1', coreNumber: 4, memoryMib: 8192, plan: '4xCPU-8GB', osName: 'Ubuntu 24.04',
    storageGib: 80, upcloudCreatedAt: '2026-01-01T00:00:00.000Z', syncStatus: 'ok', lastError: null,
    lastSyncedAt: new Date().toISOString(), detailsSyncedAt: new Date().toISOString(), lastSyncAttemptAt: new Date().toISOString(),
    publicIps: ['203.0.113.10'], privateIps: [], networkConfigurationStatus: 'available', tokens: [], groups: [],
    config: {}, storages: [], networks: [], latestMetrics: null, activeJob: null, ...overrides,
  };
}
export function jobFixture(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    id: 'e8ae52f6-fb75-4a37-a1a2-c0df53d18101', type: 'server_control', status: 'queued', tokenId: 'token-1',
    serverUuid: serverFixture().uuid, requestedBy: 'user-1', trigger: 'manual', attempts: 0, error: null,
    details: { action: 'stop' }, createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
