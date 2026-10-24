import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Clock3, Cpu, HardDrive, Info, MemoryStick, Network, RefreshCw, Server, Wifi } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import type { MetricHistory, MetricSample, ServerDetail } from '../types';
import { cx, formatBytes, formatMemory, formatRate, formatStorage, formatUptime, isStale, relativeTime } from '../utils';
import { useSettings } from '../hooks';
import { useLiveStatus } from '../context/LiveContext';
import { useToast } from '../context/ToastContext';
import AgentPanel from './AgentPanel';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, StatusBadge } from './ui';

type Range = '15m' | '1h' | '6h' | '24h' | '7d';
const ranges: Array<{ id: Range; label: string }> = [{ id: '15m', label: '15 menit' }, { id: '1h', label: '1 jam' }, { id: '6h', label: '6 jam' }, { id: '24h', label: '24 jam' }, { id: '7d', label: '7 hari' }];
const chartTooltip = { backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px', color: '#e2e8f0', fontSize: '12px' };

function MetricCard({ label, value, note, icon: Icon, unavailable = false }: { label: string; value: string; note: string; icon: LucideIcon; unavailable?: boolean }) {
  return <Card className="p-4"><div className="flex items-start gap-3"><div className={cx('rounded-xl p-2', unavailable ? 'bg-slate-100 text-slate-400 dark:bg-slate-800' : 'bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400')}><Icon className="h-4 w-4" /></div><div className="min-w-0"><p className="text-[11px] font-medium text-slate-400">{label}</p><p className={cx('mt-1 truncate text-lg font-bold tracking-tight', unavailable ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white')} title={value}>{value}</p><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400" title={note}>{note}</p></div></div></Card>;
}

function ChartEmpty({ label }: { label: string }) {
  return <EmptyState icon={Activity} title={`Belum ada riwayat ${label}`} description="Titik grafik muncul setelah panel mengumpulkan sampel nyata. UpCloud tidak menyediakan backfill deret waktu untuk rentang ini melalui endpoint yang digunakan." />;
}
function timeLabel(value: string, range: Range) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('id-ID', range === '7d' ? { day: '2-digit', month: 'short' } : { hour: '2-digit', minute: '2-digit' }).format(date);
}

function CpuChart({ points, range }: { points: MetricSample[]; range: Range }) {
  const data = points.filter((point) => point.cpuPercent !== null);
  if (data.length === 0) return <ChartEmpty label="CPU" />;
  return <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}><defs><linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14b8a6" stopOpacity={0.3} /><stop offset="100%" stopColor="#14b8a6" stopOpacity={0.015} /></linearGradient></defs><CartesianGrid stroke="#94a3b8" strokeOpacity={0.13} vertical={false} /><XAxis dataKey="sampledAt" tickFormatter={(value) => timeLabel(value, range)} tickLine={false} axisLine={false} minTickGap={36} /><YAxis tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} domain={[0, 'auto']} /><Tooltip contentStyle={chartTooltip} labelFormatter={(value) => new Date(String(value)).toLocaleString('id-ID')} formatter={(value) => [`${Number(value).toFixed(2)}%`, 'CPU usage']} /><Area type="monotone" dataKey="cpuPercent" stroke="#14b8a6" strokeWidth={2.2} fill="url(#cpuFill)" connectNulls={false} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>;
}
function IoChart({ points, range, kind }: { points: MetricSample[]; range: Range; kind: 'disk' | 'network' }) {
  const first = kind === 'disk' ? 'diskReadBytesPerSecond' : 'networkInBitsPerSecond';
  const second = kind === 'disk' ? 'diskWriteBytesPerSecond' : 'networkOutBitsPerSecond';
  const data = points.filter((point) => point[first] !== null || point[second] !== null);
  if (data.length === 0) return <ChartEmpty label={kind === 'disk' ? 'disk' : 'jaringan'} />;
  const rateKind = kind === 'disk' ? 'bytes' : 'bits';
  return <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}><CartesianGrid stroke="#94a3b8" strokeOpacity={0.13} vertical={false} /><XAxis dataKey="sampledAt" tickFormatter={(value) => timeLabel(value, range)} tickLine={false} axisLine={false} minTickGap={36} /><YAxis tickFormatter={(value) => formatRate(value, rateKind)} tickLine={false} axisLine={false} width={72} /><Tooltip contentStyle={chartTooltip} labelFormatter={(value) => new Date(String(value)).toLocaleString('id-ID')} formatter={(value, name) => [formatRate(Number(value), rateKind), name === first ? (kind === 'disk' ? 'Read' : 'Inbound') : (kind === 'disk' ? 'Write' : 'Outbound')]} /><Line type="monotone" dataKey={first} name={first} stroke="#0ea5e9" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} /><Line type="monotone" dataKey={second} name={second} stroke="#8b5cf6" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>;
}

function GuestUsageChart({ points, range, kind }: { points: MetricSample[]; range: Range; kind: 'memory' | 'filesystem' }) {
  const first = kind === 'memory' ? 'memoryUsedBytes' : 'filesystemUsedBytes';
  const second = kind === 'memory' ? 'swapUsedBytes' : 'filesystemTotalBytes';
  const data = points.filter((point) => point[first] !== null || point[second] !== null);
  if (data.length === 0) return <ChartEmpty label={kind === 'memory' ? 'RAM/swap dari agent' : 'filesystem dari agent'} />;
  return <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}><CartesianGrid stroke="#94a3b8" strokeOpacity={0.13} vertical={false} /><XAxis dataKey="sampledAt" tickFormatter={(value) => timeLabel(value, range)} tickLine={false} axisLine={false} minTickGap={36} /><YAxis tickFormatter={(value) => formatBytes(Number(value))} tickLine={false} axisLine={false} width={82} /><Tooltip contentStyle={chartTooltip} labelFormatter={(value) => new Date(String(value)).toLocaleString('id-ID')} formatter={(value, name) => [formatBytes(Number(value)), name === first ? (kind === 'memory' ? 'RAM terpakai' : 'Filesystem terpakai') : (kind === 'memory' ? 'Swap terpakai' : 'Total filesystem')]} /><Line type="monotone" dataKey={first} name={first} stroke="#14b8a6" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} /><Line type="monotone" dataKey={second} name={second} stroke="#8b5cf6" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>;
}

export default function PerformancePanel({ server }: { server: ServerDetail }) {
  const [range, setRange] = useState<Range>('1h');
  const { data: settings } = useSettings();
  const queryClient = useQueryClient();
  const liveConnection = useLiveStatus();
  const { push } = useToast();
  const refreshSeconds = settings?.metricsRefreshSeconds ?? 60;
  const refresh = useQuery({
    queryKey: ['metric-refresh', server.uuid],
    queryFn: () => api.post<{ sample: MetricSample; cached: boolean; partial: boolean }>(`/api/servers/${server.uuid}/metrics/refresh`, {}),
    refetchInterval: refreshSeconds * 1000, retry: 0, staleTime: (refreshSeconds - 1) * 1000,
  });
  const history = useQuery({ queryKey: ['metrics', server.uuid, range], queryFn: () => api.get<MetricHistory>(`/api/servers/${server.uuid}/metrics?range=${range}`), refetchInterval: 15_000 });
  useEffect(() => {
    if (refresh.data) void queryClient.invalidateQueries({ queryKey: ['metrics', server.uuid] });
  }, [refresh.data, refresh.dataUpdatedAt, queryClient, server.uuid]);
  const manual = useMutation({
    mutationFn: () => api.post(`/api/servers/${server.uuid}/metrics/refresh`, { force: true }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['metrics', server.uuid] }); void refresh.refetch(); },
    onError: (error) => push('error', 'Refresh metrik gagal', error.message),
  });
  const latest = history.data?.latest ?? refresh.data?.sample ?? server.latestMetrics;
  const stale = isStale(latest?.fieldSampledAt?.cpuPercent ?? latest?.sampledAt, refreshSeconds * 2);
  const status = refresh.isLoading ? { label: 'Memuat', tone: 'blue' as const }
    : refresh.error || manual.error ? { label: 'Sinkronisasi gagal', tone: 'red' as const }
      : liveConnection === 'disconnected' ? { label: 'Koneksi terputus', tone: 'red' as const }
        : stale ? { label: 'Data kedaluwarsa', tone: 'amber' as const } : { label: 'Live', tone: 'green' as const };
  const unavailableReason = 'Tidak tersedia melalui API · agent OS diperlukan';
  const chartData = useMemo(() => history.data?.points ?? [], [history.data]);
  return <div>
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-2"><Badge tone={status.tone}><span className={cx('h-1.5 w-1.5 rounded-full bg-current', status.label === 'Live' && 'live-dot')} />{status.label}</Badge><StatusBadge status={server.state} /><span className="text-xs text-slate-400">Sampel terakhir: {relativeTime(latest?.sampledAt)}</span><span className="text-[10px] text-slate-400">· polling {refreshSeconds}s</span></div><Button variant="outline" size="sm" loading={manual.isPending || refresh.isFetching} onClick={() => manual.mutate()}><RefreshCw className="h-3.5 w-3.5" />Refresh metrik</Button></div>
    {refresh.error && <ErrorState error={refresh.error} retry={() => void refresh.refetch()} />}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="CPU usage" value={latest?.cpuPercent !== null && latest?.cpuPercent !== undefined ? `${latest.cpuPercent.toFixed(2)}%` : 'Tidak tersedia'} note={`${server.coreNumber} vCPU terkonfigurasi · UpCloud stats`} icon={Cpu} unavailable={latest?.cpuPercent === null || latest?.cpuPercent === undefined} />
      <MetricCard label="RAM terpakai / total" value={latest?.memoryUsedBytes != null ? `${formatBytes(latest.memoryUsedBytes)} / ${formatBytes(latest.memoryTotalBytes)}` : 'Tidak tersedia'} note={latest?.memoryUsedBytes != null ? `Guest agent · ${relativeTime(latest.fieldSampledAt?.memoryUsedBytes ?? latest.sampledAt)} · ${formatMemory(server.memoryMib)} terkonfigurasi` : `${formatMemory(server.memoryMib)} terkonfigurasi · ${unavailableReason}`} icon={MemoryStick} unavailable={latest?.memoryUsedBytes == null} />
      <MetricCard label="Swap terpakai" value={latest?.swapUsedBytes != null ? `${formatBytes(latest.swapUsedBytes)} / ${formatBytes(latest.swapTotalBytes)}` : 'Tidak tersedia'} note={latest?.swapUsedBytes != null ? `Guest agent · ${relativeTime(latest.fieldSampledAt?.swapUsedBytes ?? latest.sampledAt)}` : unavailableReason} icon={MemoryStick} unavailable={latest?.swapUsedBytes == null} />
      <MetricCard label="Total disk terpakai" value={latest?.filesystemUsedBytes != null ? `${formatBytes(latest.filesystemUsedBytes)} / ${formatBytes(latest.filesystemTotalBytes)}` : 'Tidak tersedia'} note={latest?.filesystemUsedBytes != null ? `Guest agent · ${relativeTime(latest.fieldSampledAt?.filesystemUsedBytes ?? latest.sampledAt)} · ${formatStorage(server.storageGib)} kapasitas block storage` : `${formatStorage(server.storageGib)} kapasitas block storage · agent OS diperlukan`} icon={HardDrive} unavailable={latest?.filesystemUsedBytes == null} />
      <MetricCard label="Disk read" value={formatRate(latest?.diskReadBytesPerSecond, 'bytes')} note="Aktivitas hypervisor · bukan filesystem usage" icon={HardDrive} unavailable={latest?.diskReadBytesPerSecond === null || latest?.diskReadBytesPerSecond === undefined} />
      <MetricCard label="Disk write" value={formatRate(latest?.diskWriteBytesPerSecond, 'bytes')} note="Aktivitas hypervisor · UpCloud daily summary" icon={HardDrive} unavailable={latest?.diskWriteBytesPerSecond === null || latest?.diskWriteBytesPerSecond === undefined} />
      <MetricCard label="Network inbound" value={formatRate(latest?.networkInBitsPerSecond, 'bits')} note="Agregat interface · UpCloud stats" icon={Network} unavailable={latest?.networkInBitsPerSecond === null || latest?.networkInBitsPerSecond === undefined} />
      <MetricCard label="Network outbound" value={formatRate(latest?.networkOutBitsPerSecond, 'bits')} note="Agregat interface · UpCloud stats" icon={Wifi} unavailable={latest?.networkOutBitsPerSecond === null || latest?.networkOutBitsPerSecond === undefined} />
      <MetricCard label="IP address" value={server.publicIps[0] ?? server.privateIps[0] ?? 'Tidak tersedia'} note={`${server.publicIps.length} publik · ${server.privateIps.length} privat/utility`} icon={Server} unavailable={server.publicIps.length + server.privateIps.length === 0} />
      <MetricCard label="Uptime OS" value={formatUptime(latest?.osUptimeSeconds)} note={latest?.osUptimeSeconds != null ? `Guest agent · ${relativeTime(latest.fieldSampledAt?.osUptimeSeconds ?? latest.sampledAt)} · berbeda dari power state` : 'Power state bukan uptime · agent OS diperlukan'} icon={Clock3} unavailable={latest?.osUptimeSeconds == null} />
      <MetricCard label="Power state" value={server.state} note="Status resmi dari UpCloud API" icon={Activity} />
      <MetricCard label="Timestamp sampel" value={latest ? relativeTime(latest.sampledAt) : 'Belum ada'} note="Waktu panel menerima data, bukan uptime server" icon={Clock3} unavailable={!latest} />
    </div>
    <div className="my-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">Riwayat statistik</h3><p className="mt-1 text-xs text-slate-400">Sampel lokal dari UpCloud daily summary · tanpa backfill/interpolasi</p></div><div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">{ranges.map((item) => <button key={item.id} onClick={() => setRange(item.id)} className={cx('rounded-lg px-3 py-1.5 text-xs font-semibold', range === item.id ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-700 dark:text-teal-400' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white')}>{item.label}</button>)}</div></div>
    {history.isLoading ? <div className="grid gap-5 xl:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div> : history.error ? <ErrorState error={history.error} retry={() => void history.refetch()} /> : <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">CPU utilization</h3><p className="mt-1 text-[11px] text-slate-400">Persentase dari endpoint /stats/cpu/daily</p></div><Badge tone="green">UpCloud API</Badge></div><CpuChart points={chartData} range={range} /></Card>
      <Card className="p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">Memory & swap</h3><p className="mt-1 text-[11px] text-slate-400">Metrik guest OS tidak diekspos API</p></div><Badge tone={chartData.some((point) => point.memoryUsedBytes != null) ? 'green' : 'slate'}>{chartData.some((point) => point.memoryUsedBytes != null) ? 'Guest agent' : 'Agent diperlukan'}</Badge></div><GuestUsageChart points={chartData} range={range} kind="memory" /></Card>
      <Card className="p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">Disk activity</h3><div className="mt-2 flex gap-3 text-[11px]"><span className="flex items-center gap-1.5 text-sky-500"><span className="h-2 w-2 rounded-full bg-current" />Read</span><span className="flex items-center gap-1.5 text-violet-500"><span className="h-2 w-2 rounded-full bg-current" />Write</span></div></div><Badge tone="blue">Bytes / second</Badge></div><IoChart points={chartData} range={range} kind="disk" /></Card>
      <Card className="p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">Total disk terpakai</h3><p className="mt-1 text-[11px] text-slate-400">Pemakaian filesystem aktual dari guest agent</p></div><Badge tone={chartData.some((point) => point.filesystemUsedBytes != null) ? 'green' : 'slate'}>{chartData.some((point) => point.filesystemUsedBytes != null) ? 'Guest agent' : 'Agent diperlukan'}</Badge></div><GuestUsageChart points={chartData} range={range} kind="filesystem" /></Card>
      <Card className="p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">Network traffic</h3><div className="mt-2 flex gap-3 text-[11px]"><span className="flex items-center gap-1.5 text-sky-500"><span className="h-2 w-2 rounded-full bg-current" />Inbound</span><span className="flex items-center gap-1.5 text-violet-500"><span className="h-2 w-2 rounded-full bg-current" />Outbound</span></div></div><Badge tone="violet">Bits / second</Badge></div><IoChart points={chartData} range={range} kind="network" /></Card>
    </div>}
    <AgentPanel serverUuid={server.uuid} />
    <div className="mt-5 flex items-start gap-2 rounded-xl bg-slate-100 p-3 text-[11px] leading-5 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /><p>{history.data?.source.note ?? 'Riwayat hanya berasal dari sampel API yang berhasil.'} {history.data?.downsampled && 'Untuk keterbacaan, satu sampel aktual terakhir per bucket ditampilkan; tidak ada nilai baru yang dibuat.'}</p></div>
  </div>;
}
