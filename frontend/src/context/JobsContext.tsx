import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { SyncJob } from '../types';
import { useToast } from './ToastContext';

type JobsContextValue = {
  jobs: SyncJob[]; activeCount: number; trackJob: (job: SyncJob, label?: string) => void;
  isServerBusy: (uuid: string) => boolean; isTokenBusy: (id: string) => boolean;
};
const JobsContext = createContext<JobsContextValue | null>(null);
const activeStatuses = new Set(['queued', 'running', 'verifying']);
const jobLabels = new Map<string, string>();

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, SyncJob>>({});
  const notified = useRef(new Set<string>());
  const queryClient = useQueryClient();
  const { push } = useToast();
  const trackJob = useCallback((job: SyncJob, label = 'Operasi') => {
    jobLabels.set(job.id, label);
    setJobs((current) => ({ ...current, [job.id]: job }));
  }, []);
  const finish = useCallback((job: SyncJob) => {
    if (notified.current.has(job.id)) return;
    notified.current.add(job.id);
    const label = jobLabels.get(job.id) ?? 'Operasi';
    if (job.status === 'succeeded') push('success', `${label} terverifikasi`, 'Status akhir telah dikonfirmasi melalui API.');
    else if (job.status === 'verification_timeout') push('warning', `${label} belum terverifikasi`, job.error?.message);
    else push('error', `${label} gagal`, job.error?.message);
    void queryClient.invalidateQueries();
    window.setTimeout(() => setJobs((current) => {
      const next = { ...current };
      delete next[job.id];
      jobLabels.delete(job.id);
      notified.current.delete(job.id);
      return next;
    }), 10_000);
  }, [push, queryClient]);

  useEffect(() => {
    const receive = (event: Event) => {
      const job = (event as CustomEvent<SyncJob>).detail;
      if (!job?.id) return;
      setJobs((current) => ({ ...current, [job.id]: job }));
      if (!activeStatuses.has(job.status)) finish(job);
    };
    window.addEventListener('cerdasnet:job', receive);
    return () => window.removeEventListener('cerdasnet:job', receive);
  }, [finish]);

  useEffect(() => {
    const active = Object.values(jobs).filter((job) => activeStatuses.has(job.status));
    if (active.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      await Promise.all(active.map(async (job) => {
        try {
          const updated = await api.get<SyncJob>(`/api/sync/jobs/${job.id}`);
          if (cancelled) return;
          setJobs((current) => ({ ...current, [updated.id]: updated }));
          if (!activeStatuses.has(updated.status)) finish(updated);
        } catch { /* WebSocket/render will surface backend connection state; retry next interval. */ }
      }));
    };
    const timer = window.setInterval(poll, 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [jobs, finish]);

  const value = useMemo<JobsContextValue>(() => {
    const list = Object.values(jobs);
    return {
      jobs: list, activeCount: list.filter((job) => activeStatuses.has(job.status)).length,
      trackJob,
      isServerBusy: (uuid) => list.some((job) => job.serverUuid === uuid && activeStatuses.has(job.status)),
      isTokenBusy: (id) => list.some((job) => job.tokenId === id && activeStatuses.has(job.status)),
    };
  }, [jobs, trackJob]);
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}
export function useJobs() {
  const context = useContext(JobsContext);
  if (!context) throw new Error('useJobs must be used within JobsProvider');
  return context;
}
