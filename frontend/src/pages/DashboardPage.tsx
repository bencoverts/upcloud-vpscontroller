import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, CheckCircle2, Cpu, HardDrive, KeyRound, MemoryStick, Plus, Server, ShieldAlert, Square, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../api';
import type { Dashboard, ServerList, Token } from '../types';
import { formatDate, formatMemory, formatStorage, relativeTime } from '../utils';
import { useSettings } from '../hooks';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge, TableSkeleton } from '../components/ui';
import ServerTable from '../components/ServerTable';

function StatCard({ label, value, note, icon: Icon, tone = 'teal' }: { label: string; value: string | number; note: string; icon: LucideIcon; tone?: 'teal' | 'blue' | 'amber' | 'red' | 'violet' }) {
  const tones = { teal: 'bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400', blue: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400', red: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400' };
  return <Card className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-slate-400 dark:text-slate-500">{label}</p><p className="mt-2 text-[26px] font-bold tracking-[-0.035em] text-slate-950 dark:text-white">{value}</p><p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">{note}</p></div><div className={`rounded-xl p-2.5 ${tones[tone]}`}><Icon className="h-5 w-5" /></div></div></Card>;
}

export default function DashboardPage() {
  const { data: settings } = useSettings();
  const interval = (settings?.serverPollSeconds ?? 30) * 1000;
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/api/dashboard'), refetchInterval: interval });
  const servers = useQuery({ queryKey: ['servers', 'dashboard'], queryFn: () => api.get<ServerList>('/api/servers?limit=5&sort=lastSynced&order=desc'), refetchInterval: interval });
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => api.get<Token[]>('/api/tokens'), refetchInterval: interval });
  const data = dashboard.data;
  return <>
    <PageHeader eyebrow="Infrastructure overview" title="Selamat datang di CerdasNet" description="Kondisi seluruh VPS dari semua token aktif, disatukan tanpa duplikasi UUID." actions={<><Button variant="outline" onClick={() => { void dashboard.refetch(); void servers.refetch(); void tokens.refetch(); }}>Refresh data</Button><Link to="/tokens"><Button><Plus className="h-4 w-4" />Tambah token</Button></Link></>} />
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400"><span className="flex items-center gap-1.5"><span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />Cache panel aktif</span><span>Pembaruan terakhir: <strong className="font-medium text-slate-500 dark:text-slate-300">{relativeTime(data?.lastUpdatedAt)}</strong></span><span className="hidden sm:inline">{formatDate(data?.lastUpdatedAt)}</span></div>
    {dashboard.error && <ErrorState error={dashboard.error} retry={() => void dashboard.refetch()} />}
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {dashboard.isLoading ? Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-[132px]" />) : data && <>
        <StatCard label="API Token" value={data.tokens.total} note={`${data.tokens.enabled} aktif · ${data.tokens.invalid} tidak valid`} icon={KeyRound} tone="violet" />
        <StatCard label="Total VPS" value={data.totalServers} note={`${data.maintenance} dalam maintenance`} icon={Server} tone="blue" />
        <StatCard label="VPS Aktif" value={data.started} note="Power state started" icon={CheckCircle2} />
        <StatCard label="VPS Berhenti" value={data.stopped} note="Power state stopped" icon={Square} tone="amber" />
        <StatCard label="Total vCPU" value={data.totalCores.toLocaleString('id-ID')} note="Konfigurasi seluruh VPS" icon={Cpu} tone="blue" />
        <StatCard label="Total RAM" value={formatMemory(data.totalMemoryMib)} note="Kapasitas terkonfigurasi" icon={MemoryStick} tone="violet" />
        <StatCard label="Total Storage" value={formatStorage(data.totalStorageGib)} note="Kapasitas, bukan pemakaian filesystem" icon={HardDrive} />
        <StatCard label="Perlu Perhatian" value={data.connectionIssues + data.errorState} note={`${data.connectionIssues} sinkron gagal · ${data.errorState} state error`} icon={ShieldAlert} tone={data.connectionIssues + data.errorState > 0 ? 'red' : 'teal'} />
      </>}
    </div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]">
      <div><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold text-slate-900 dark:text-white">Server terbaru disinkronkan</h2><p className="mt-1 text-xs text-slate-400">Kontrol dikonfirmasi dan diverifikasi via UpCloud.</p></div><Link to="/servers" className="flex items-center gap-1 text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400">Lihat semua<ArrowRight className="h-3.5 w-3.5" /></Link></div>
        {servers.isLoading ? <Card><TableSkeleton rows={4} /></Card> : servers.error ? <Card><ErrorState error={servers.error} retry={() => void servers.refetch()} /></Card> : <ServerTable servers={servers.data?.items ?? []} emptyAction={<Link to="/tokens"><Button size="sm">Tambahkan token pertama</Button></Link>} />}
      </div>
      <Card className="h-fit"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800"><div><h2 className="text-sm font-bold text-slate-900 dark:text-white">Kesehatan token</h2><p className="mt-1 text-[11px] text-slate-400">Status koneksi per grup</p></div><KeyRound className="h-4 w-4 text-slate-400" /></div>
        {tokens.isLoading ? <div className="space-y-3 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : tokens.data?.length ? <div className="divide-y divide-slate-100 dark:divide-slate-800">{tokens.data.slice(0, 5).map((token) => <Link to="/tokens" key={token.id} className="block px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/30"><div className="flex items-start justify-between gap-2"><p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{token.name}</p><StatusBadge status={!token.enabled ? 'unknown' : token.connectionStatus} /></div><div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400"><span>{token.serverCount} VPS</span><span>·</span><span>{relativeTime(token.lastSyncAt)}</span>{token.validationStatus === 'expired' && <Badge tone="red">Kedaluwarsa</Badge>}</div></Link>)}</div> : <EmptyState icon={KeyRound} title="Belum ada token" description="Tambahkan token UpCloud untuk mulai menemukan VPS Anda." action={<Link to="/tokens"><Button size="sm">Kelola token</Button></Link>} />}
        {(data?.connectionIssues ?? 0) > 0 && <div className="m-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-[11px] leading-5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"><TriangleAlert className="h-4 w-4 shrink-0" />Sebagian data mungkin kedaluwarsa. Buka Activity Logs untuk melihat job yang gagal.</div>}
      </Card>
    </div>
    <div className="mt-6 flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50/60 p-4 text-xs leading-5 text-sky-700 dark:border-sky-500/15 dark:bg-sky-500/5 dark:text-sky-300"><Activity className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Interpretasi data:</strong> total RAM dan storage adalah kapasitas konfigurasi dari UpCloud. Status jaringan pada panel menunjukkan konfigurasi yang berhasil dibaca, bukan hasil ping atau health check aplikasi.</p></div>
  </>;
}
