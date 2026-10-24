import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Filter, Plus, RefreshCw, Search, X } from 'lucide-react';
import { api, queryString } from '../api';
import type { ServerList, Token } from '../types';
import { useDebouncedValue, useSettings } from '../hooks';
import { useAuth } from '../context/AuthContext';
import { Button, Card, ErrorState, inputClass, PageHeader, Pagination, TableSkeleton } from '../components/ui';
import ServerTable from '../components/ServerTable';

const initialFilters = { state: '', zone: '', tokenId: '', syncStatus: '', sort: 'title', order: 'asc', limit: 20 };
export default function ServersPage() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search);
  const { data: settings } = useSettings();
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => api.get<Token[]>('/api/tokens'), enabled: admin });
  const params = { search: debouncedSearch, ...filters, page };
  const servers = useQuery({
    queryKey: ['servers', params], queryFn: () => api.get<ServerList>(`/api/servers${queryString(params)}`),
    placeholderData: keepPreviousData, refetchInterval: (settings?.serverPollSeconds ?? 30) * 1000,
  });
  const update = (key: keyof typeof initialFilters, value: string | number) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const filtered = search || Object.entries(filters).some(([key, value]) => !['sort', 'order', 'limit'].includes(key) && value !== initialFilters[key as keyof typeof initialFilters]);
  return <>
    <PageHeader eyebrow="Compute fleet" title="VPS Servers" description={admin ? 'Cari, filter, dan kelola seluruh server unik yang ditemukan oleh token Anda.' : 'Cari, filter, dan kelola VPS yang ditugaskan ke akun Anda.'} actions={<><Button variant="outline" loading={servers.isFetching && !servers.isLoading} onClick={() => void servers.refetch()}><RefreshCw className="h-4 w-4" />Refresh</Button>{admin && <Link to="/tokens"><Button><Plus className="h-4 w-4" />Tambah token</Button></Link>}</>} />
    <Card className="mb-5 p-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.5fr)_repeat(4,minmax(130px,0.7fr))]">
      <div className="relative"><Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} pl-9`} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Nama, UUID, zona, atau IP…" aria-label="Cari VPS" /></div>
      <select className={inputClass} value={filters.state} onChange={(event) => update('state', event.target.value)} aria-label="Filter status"><option value="">Semua status</option><option value="started">Aktif</option><option value="stopped">Berhenti</option><option value="maintenance">Maintenance</option><option value="error">Bermasalah</option></select>
      <select className={inputClass} value={filters.zone} onChange={(event) => update('zone', event.target.value)} aria-label="Filter lokasi"><option value="">Semua lokasi</option>{servers.data?.filters.zones.map((zone) => <option key={zone}>{zone}</option>)}</select>
      {admin && <select className={inputClass} value={filters.tokenId} onChange={(event) => update('tokenId', event.target.value)} aria-label="Filter token"><option value="">Semua token</option>{tokens.data?.map((token) => <option value={token.id} key={token.id}>{token.name}</option>)}</select>}
      <select className={inputClass} value={filters.syncStatus} onChange={(event) => update('syncStatus', event.target.value)} aria-label="Filter sinkronisasi"><option value="">Semua sinkronisasi</option><option value="ok">Tersinkron</option><option value="degraded">Sebagian</option><option value="error">Gagal</option><option value="not_found">Tidak ditemukan</option></select>
    </div><div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-slate-800"><Filter className="h-3.5 w-3.5 text-slate-400" /><span className="text-[11px] text-slate-400">Urutkan</span><select className="rounded-lg border-0 bg-transparent py-1 text-xs font-medium text-slate-600 focus:outline-none dark:text-slate-300" value={filters.sort} onChange={(event) => update('sort', event.target.value)}><option value="title">Nama</option><option value="state">Status</option><option value="zone">Zona</option><option value="cores">vCPU</option><option value="memory">RAM</option><option value="storage">Storage</option><option value="lastSynced">Sinkron terakhir</option></select><select className="rounded-lg border-0 bg-transparent py-1 text-xs font-medium text-slate-600 focus:outline-none dark:text-slate-300" value={filters.order} onChange={(event) => update('order', event.target.value)}><option value="asc">Naik</option><option value="desc">Turun</option></select><select className="rounded-lg border-0 bg-transparent py-1 text-xs font-medium text-slate-600 focus:outline-none dark:text-slate-300" value={filters.limit} onChange={(event) => update('limit', Number(event.target.value))}><option value={10}>10 / halaman</option><option value={20}>20 / halaman</option><option value={50}>50 / halaman</option><option value={100}>100 / halaman</option></select>{filtered && <button className="ml-auto flex items-center gap-1 text-xs font-medium text-rose-500" onClick={() => { setFilters(initialFilters); setSearch(''); setPage(1); }}><X className="h-3.5 w-3.5" />Reset filter</button>}</div></Card>
    {servers.isLoading ? <Card><TableSkeleton rows={7} /></Card> : servers.error ? <Card><ErrorState error={servers.error} retry={() => void servers.refetch()} /></Card> : <><ServerTable servers={servers.data?.items ?? []} /><div className="mt-4"><Card><Pagination page={servers.data?.pagination.page ?? 1} pages={servers.data?.pagination.pages ?? 1} total={servers.data?.pagination.total ?? 0} onPage={setPage} /></Card></div></>}
  </>;
}
