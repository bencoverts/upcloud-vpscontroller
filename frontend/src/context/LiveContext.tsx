import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import type { MetricHistory, MetricSample, ServerDetail, SyncJob } from '../types';

type LiveStatus = 'connecting' | 'live' | 'disconnected';
type Connection = { userId: string | null; status: LiveStatus };
type LiveMessage = { type: string; payload: Record<string, any> };
const LiveContext = createContext<LiveStatus>('disconnected');

export function mergeSample(current: MetricSample | null, incoming: MetricSample): MetricSample {
  if (!current) return incoming;
  const merged = { ...current, sampledAt: incoming.sampledAt, sourcePeriod: 'combined' } as MetricSample;
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined && !['rawSummary', 'fieldSampledAt', 'sourcePeriod'].includes(key)) Object.assign(merged, { [key]: value });
  }
  merged.fieldSampledAt = { ...current.fieldSampledAt, ...incoming.fieldSampledAt };
  merged.rawSummary = { ...current.rawSummary, ...incoming.rawSummary, note: 'Combined latest actual values from UpCloud and guest agent.' };
  return merged;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<Connection>({ userId: null, status: 'disconnected' });
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let retryMs = 1000;
    let disposed = false;
    const invalidateFleet = () => {
      for (const key of ['servers', 'server', 'dashboard', 'activity']) void queryClient.invalidateQueries({ queryKey: [key] });
    };
    const connect = () => {
      if (disposed) return;
      setConnection({ userId, status: 'connecting' });
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/api/events`);
      socket.onmessage = (message) => {
        let event: LiveMessage;
        try { event = JSON.parse(String(message.data)); } catch { return; }
        if (event.type === 'ready') {
          retryMs = 1000;
          setConnection({ userId, status: 'live' });
          return;
        }
        if (event.type === 'metric') {
          const uuid = String(event.payload.uuid);
          const sample = event.payload.sample as MetricSample;
          queryClient.setQueryData<ServerDetail>(['server', uuid], (current) => current ? {
            ...current,
            latestMetrics: mergeSample(current.latestMetrics, sample),
          } : current);
          const histories = queryClient.getQueryCache().findAll({ queryKey: ['metrics', uuid] });
          for (const query of histories) {
            queryClient.setQueryData<MetricHistory>(query.queryKey, (current) => {
              if (!current) return current;
              const points = [...current.points.filter((point) => !(point.sampledAt === sample.sampledAt && point.sourcePeriod === sample.sourcePeriod)), sample]
                .sort((left, right) => left.sampledAt.localeCompare(right.sampledAt));
              return { ...current, points, latest: mergeSample(current.latest, sample) };
            });
          }
          return;
        }
        if (event.type === 'job') {
          window.dispatchEvent(new CustomEvent<SyncJob>('cerdasnet:job', { detail: event.payload as SyncJob }));
        }
        if (event.type === 'proxmox') { void queryClient.invalidateQueries({ queryKey: ['proxmox-resources'] }); void queryClient.invalidateQueries({ queryKey: ['proxmox-connections'] }); }
        if (event.type === 'token') void queryClient.invalidateQueries({ queryKey: ['tokens'] });
        if (event.type === 'client' || event.type === 'access') void queryClient.invalidateQueries({ queryKey: ['users'] });
        invalidateFleet();
      };
      socket.onclose = () => {
        if (disposed) return;
        setConnection({ userId, status: 'disconnected' });
        reconnectTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(15_000, retryMs * 2);
      };
      socket.onerror = () => { socket?.close(); };
    };
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [userId, queryClient]);
  const status: LiveStatus = !userId ? 'disconnected' : connection.userId !== userId ? 'connecting' : connection.status;
  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>;
}
export function useLiveStatus() { return useContext(LiveContext); }
export function useLiveLabel() {
  return useMemo(() => ({ connecting: 'Menghubungkan', live: 'WebSocket live', disconnected: 'Koneksi terputus' }), []);
}
