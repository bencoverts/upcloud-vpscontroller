import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ChevronDown, Clock3, RefreshCw, RotateCcw, Search, User, X } from 'lucide-react';
import { api, queryString } from '../api';
import type { AuditLog, Paged, SyncJob } from '../types';
import { formatDate, relativeTime, shortUuid } from '../utils';
import { useDebouncedValue } from '../hooks';
import { useToast } from '../context/ToastContext';
import { useJobs } from '../context/JobsContext';
import { Badge, Button, Card, CopyButton, EmptyState, ErrorState, inputClass, PageHeader, Pagination, StatusBadge, TableSkeleton } from '../components/ui';

type Kind = 'audit' | 'jobs';
export default function ActivityPage() {
  const [kind, setKind] = useState<Kind>('audit');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ action: '', outcome: '', resourceType: '', resourceId: '', status: '', type: '' });
  const [retrying, setRetrying] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const queryClient = useQueryClient();
  const { push } = useToast();
  const { trackJob } = useJobs();
  const params = { kind, page, limit: 30, search: debouncedSearch, ...(kind === 'audit' ? { action: filters.action, outcome: filters.outcome, resourceType: filters.resourceType, resourceId: filters.resourceId } : { status: filters.status, type: filters.type }) };
  const query = useQuery({ queryKey: ['activity', params], queryFn: () => api.get<Paged<AuditLog | SyncJob>>(`/api/activity${queryString(params)}`), placeholderData: keepPreviousData, refetchInterval: kind === 'jobs' ? 5000 : 15_000 });
  const audits = kind === 'audit' ? query.data?.items as AuditLog[] | undefined : undefined;
  const jobs = kind === 'jobs' ? query.data?.items as SyncJob[] | undefined : undefined;
  const update = (key: keyof typeof filters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const changeKind = (value: Kind) => { setKind(value); setPage(1); };
  const retry = async (job: SyncJob) => {
    setRetrying(job.id);
    try {
      const next = await api.post<SyncJob>(`/api/sync/jobs/${job.id}/retry`, {});
      trackJob(next, 'Retry sinkronisasi');
      await queryClient.invalidateQueries({ queryKey: ['activity'] });
      push('info', 'Job pengganti dibuat', 'Job lama tetap tersimpan untuk audit.');
    } catch (error) { push('error', 'Job tidak dapat diulang', error instanceof Error ? error.message : undefined); }
    finally { setRetrying(''); }
  };
  const filtered = search || Object.values(filters).some(Boolean);
  return <>
    <PageHeader eyebrow="Operational trail" title="Activity Logs" description="Telusuri permintaan pengguna, perubahan konfigurasi, sinkronisasi, dan hasil verifikasi power." actions={<Button variant="outline" loading={query.isFetching && !query.isLoading} onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" />Refresh</Button>} />
    <div className="mb-5 flex w-fit rounded-xl bg-slate-100 p-1 dark:bg-slate-800"><button onClick={() => changeKind('audit')} className={`rounded-lg px-4 py-2 text-xs font-semibold ${kind === 'audit' ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-700 dark:text-teal-400' : 'text-slate-400'}`}>Audit pengguna</button><button onClick={() => changeKind('jobs')} className={`rounded-lg px-4 py-2 text-xs font-semibold ${kind === 'jobs' ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-700 dark:text-teal-400' : 'text-slate-400'}`}>Job & sinkronisasi</button></div>
    <Card className="mb-5 p-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><div className="relative xl:col-span-2"><Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} pl-9`} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={kind === 'audit' ? 'Cari action, resource, username…' : 'Cari job, UUID, atau error…'} /></div>
      {kind === 'audit' ? <><input className={inputClass} value={filters.action} onChange={(event) => update('action', event.target.value)} placeholder="Action exact (mis. token.create)" /><select className={inputClass} value={filters.outcome} onChange={(event) => update('outcome', event.target.value)}><option value="">Semua outcome</option><option value="success">Success</option><option value="failure">Failure</option><option value="accepted">Accepted</option><option value="info">Info</option></select><select className={inputClass} value={filters.resourceType} onChange={(event) => update('resourceType', event.target.value)}><option value="">Semua resource</option><option value="server">Server</option><option value="token">Token</option><option value="sync_job">Sync job</option><option value="user">User</option><option value="system">System</option></select></> : <><select className={inputClass} value={filters.status} onChange={(event) => update('status', event.target.value)}><option value="">Semua status</option><option value="queued">Queued</option><option value="running">Running</option><option value="verifying">Verifying</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option><option value="verification_timeout">Verification timeout</option></select><select className={inputClass} value={filters.type} onChange={(event) => update('type', event.target.value)}><option value="">Semua tipe job</option><option value="token_sync">Token sync</option><option value="server_sync">Server sync</option><option value="server_control">Server control</option></select></>}
    </div>{filtered && <button onClick={() => { setSearch(''); setFilters({ action: '', outcome: '', resourceType: '', resourceId: '', status: '', type: '' }); setPage(1); }} className="mt-3 flex items-center gap-1 text-xs font-medium text-rose-500"><X className="h-3.5 w-3.5" />Reset semua filter</button>}</Card>
    <Card className="overflow-hidden">{query.isLoading ? <TableSkeleton rows={8} /> : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : query.data?.items.length === 0 ? <EmptyState icon={Activity} title="Belum ada aktivitas yang cocok" description="Coba reset filter atau lakukan sinkronisasi untuk membuat job baru." /> : <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {audits?.map((item) => <article key={item.id} className="p-4 sm:px-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 items-start gap-3"><div className="mt-0.5 rounded-xl bg-slate-100 p-2 text-slate-400 dark:bg-slate-800"><Activity className="h-4 w-4" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><code className="text-xs font-bold text-slate-800 dark:text-slate-200">{item.action}</code><StatusBadge status={item.outcome} /></div><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400"><span className="flex items-center gap-1"><User className="h-3 w-3" />{item.username ?? 'system'}</span><span>{item.resourceType}</span>{item.resourceId && <span className="flex items-center gap-1"><code>{shortUuid(item.resourceId)}</code><CopyButton value={item.resourceId} /></span>}</div></div></div><div className="shrink-0 text-left sm:text-right"><p className="text-xs font-medium text-slate-500 dark:text-slate-300">{relativeTime(item.createdAt)}</p><p className="mt-1 text-[10px] text-slate-400">{formatDate(item.createdAt)}</p></div></div>
        {Object.keys(item.details).length > 0 && <details className="mt-3 ml-0 rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-950/50 sm:ml-11"><summary className="flex cursor-pointer items-center gap-1 text-slate-400">Detail audit<ChevronDown className="h-3 w-3" /></summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-5 text-slate-500 dark:text-slate-400">{JSON.stringify(item.details, null, 2)}</pre></details>}
      </article>)}
      {jobs?.map((job) => <article key={job.id} className="p-4 sm:px-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Clock3 className="h-4 w-4 text-slate-400" /><code className="text-xs font-bold text-slate-800 dark:text-slate-200">{job.type}{job.details.action ? ` · ${String(job.details.action)}` : ''}</code><StatusBadge status={job.status} /><Badge>{job.trigger}</Badge></div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400"><span>Job {shortUuid(job.id)}</span><span>Percobaan: {job.attempts}</span>{job.serverUuid && <Link className="text-teal-600 hover:underline dark:text-teal-400" to={`/servers/${job.serverUuid}`}>Server {shortUuid(job.serverUuid)}</Link>}</div>{job.error && <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"><strong>{job.error.code}</strong><p className="mt-1">{job.error.message}</p></div>}</div><div className="shrink-0 sm:text-right"><p className="text-xs font-medium">{relativeTime(job.createdAt)}</p><p className="mt-1 text-[10px] text-slate-400">{formatDate(job.createdAt)}</p>{['failed', 'verification_timeout'].includes(job.status) && job.type !== 'server_control' && <Button className="mt-3" size="sm" variant="outline" loading={retrying === job.id} onClick={() => void retry(job)}><RotateCcw className="h-3.5 w-3.5" />Retry sync</Button>}</div></div>{job.status === 'verifying' && <p className="mt-3 text-xs text-sky-600 dark:text-sky-400">Menunggu dua observasi status target dari UpCloud; belum dinyatakan berhasil.</p>}</article>)}
    </div>}</Card>
    {query.data && <div className="mt-4"><Pagination page={query.data.pagination.page} pages={query.data.pagination.pages} total={query.data.pagination.total} onPage={setPage} /></div>}
  </>;
}
