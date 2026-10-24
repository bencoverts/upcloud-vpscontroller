import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Server as ServerIcon } from 'lucide-react';
import { api } from '../api';
import type { Server, ServerDetail, ServerList } from '../types';
import { useSettings } from '../hooks';
import { Card, EmptyState, ErrorState, inputClass, PageHeader, Skeleton, StatusBadge } from '../components/ui';
import PerformancePanel from '../components/PerformancePanel';

async function allServers(): Promise<Server[]> {
  const first = await api.get<ServerList>('/api/servers?limit=100&sort=title&order=asc');
  if (first.pagination.pages <= 1) return first.items;
  const rest = await Promise.all(Array.from({ length: first.pagination.pages - 1 }, (_, index) => api.get<ServerList>(`/api/servers?limit=100&sort=title&order=asc&page=${index + 2}`)));
  return [first, ...rest].flatMap((result) => result.items);
}

export default function MonitoringPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: settings } = useSettings();
  const servers = useQuery({ queryKey: ['servers', 'monitoring'], queryFn: allServers, refetchInterval: (settings?.serverPollSeconds ?? 30) * 1000 });
  const selected = searchParams.get('server') ?? servers.data?.[0]?.uuid ?? '';
  const detail = useQuery({ queryKey: ['server', selected], queryFn: () => api.get<ServerDetail>(`/api/servers/${selected}`), enabled: Boolean(selected), refetchInterval: (settings?.serverPollSeconds ?? 30) * 1000 });
  return <>
    <PageHeader eyebrow="Honest infrastructure metrics" title="Monitoring" description="Statistik CPU, disk, dan jaringan berasal dari UpCloud. Metrik guest OS yang tidak tersedia ditandai dengan jelas." />
    <Card className="mb-6 p-4"><div className="flex flex-col gap-4 md:flex-row md:items-end"><div className="flex-1"><label htmlFor="monitor-server" className="mb-2 block text-xs font-semibold text-slate-600 dark:text-slate-300">Pilih VPS</label><select id="monitor-server" className={inputClass} value={selected} disabled={servers.isLoading || !servers.data?.length} onChange={(event) => setSearchParams({ server: event.target.value })}>{servers.data?.map((server) => <option value={server.uuid} key={server.uuid}>{server.title} · {server.zone} · {server.state}</option>)}</select></div>{detail.data && <div className="flex flex-wrap items-center gap-2 pb-1"><StatusBadge status={detail.data.state} /><StatusBadge status={detail.data.syncStatus} /><span className="text-xs text-slate-400">{detail.data.coreNumber} vCPU · {detail.data.zone}</span></div>}</div></Card>
    {servers.isLoading ? <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-96" /></div> : servers.error ? <Card><ErrorState error={servers.error} retry={() => void servers.refetch()} /></Card> : !servers.data?.length ? <Card><EmptyState icon={ServerIcon} title="Belum ada VPS untuk dipantau" description="Tambahkan token dan selesaikan sinkronisasi untuk menemukan server." /></Card> : detail.isLoading ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div> : detail.error ? <Card><ErrorState error={detail.error} retry={() => void detail.refetch()} /></Card> : detail.data ? <PerformancePanel key={detail.data.uuid} server={detail.data} /> : <Card><EmptyState icon={Activity} title="Pilih VPS" description="Pilih server pada daftar untuk melihat statistik yang tersedia." /></Card>}
  </>;
}
