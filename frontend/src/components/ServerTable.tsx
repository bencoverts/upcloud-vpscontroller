import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Cpu, HardDrive, MapPin, Network, Server as ServerIcon } from 'lucide-react';
import type { Server } from '../types';
import { formatMemory, formatStorage, relativeTime, shortUuid } from '../utils';
import { Badge, Card, CopyButton, EmptyState, StatusBadge } from './ui';
import ServerActions from './ServerActions';

function Groups({ server }: { server: Server }) {
  if (server.tokens.length === 0) return <span className="text-xs text-slate-400">Tidak ada grup</span>;
  return <div className="flex max-w-[220px] flex-wrap gap-1">{server.tokens.slice(0, 2).map((token) => <Badge key={token.id} tone={token.selectedSlot !== null ? 'green' : 'slate'}>{token.name}{token.selectedSlot !== null && ` · P${token.selectedSlot}`}</Badge>)}{server.tokens.length > 2 && <Badge>+{server.tokens.length - 2}</Badge>}</div>;
}
function Ips({ server }: { server: Server }) {
  const primary = server.publicIps[0] ?? server.privateIps[0];
  if (!primary) return <span className="text-xs text-slate-400">Belum tersedia</span>;
  return <div><div className="flex items-center gap-1"><code className="text-xs text-slate-700 dark:text-slate-300">{primary}</code><CopyButton value={primary} label="Salin IP" /></div><p className="mt-1 text-[11px] text-slate-400">{server.publicIps.length} publik · {server.privateIps.length} privat</p></div>;
}
function Specs({ server }: { server: Server }) {
  return <div className="text-xs whitespace-nowrap"><p className="font-semibold text-slate-700 dark:text-slate-200">{server.coreNumber} vCPU · {formatMemory(server.memoryMib)}</p><p className="mt-1 text-slate-400">{formatStorage(server.storageGib)} storage</p></div>;
}

export default function ServerTable({ servers, emptyAction }: { servers: Server[]; emptyAction?: ReactNode }) {
  if (servers.length === 0) return <Card><EmptyState icon={ServerIcon} title="Tidak ada VPS yang cocok" description="Tambahkan API token dan sinkronisasi, atau ubah filter pencarian untuk melihat server lain." action={emptyAction} /></Card>;
  return <>
    <Card className="hidden overflow-hidden md:block">
      <div className="scrollbar-thin overflow-x-auto"><table className="w-full min-w-[1120px] border-collapse text-left"><thead><tr className="border-b border-slate-100 bg-slate-50/60 text-[10px] font-bold tracking-[0.1em] text-slate-400 uppercase dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-500"><th className="px-5 py-3.5">Server</th><th className="px-4 py-3.5">Status & zona</th><th className="px-4 py-3.5">Token / grup</th><th className="px-4 py-3.5">Spesifikasi</th><th className="px-4 py-3.5">IP address</th><th className="px-4 py-3.5">Sinkronisasi</th><th className="px-5 py-3.5 text-right">Kontrol</th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{servers.map((server) => <tr key={server.uuid} className="group hover:bg-slate-50/70 dark:hover:bg-slate-800/25">
          <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"><ServerIcon className="h-4 w-4" /></div><div className="min-w-0"><Link to={`/servers/${server.uuid}`} className="block max-w-[220px] truncate text-sm font-semibold text-slate-900 hover:text-teal-600 dark:text-white dark:hover:text-teal-400">{server.title}</Link><div className="mt-1 flex items-center gap-1"><code className="text-[10px] text-slate-400">{shortUuid(server.uuid)}</code><CopyButton value={server.uuid} label="Salin UUID" /></div>{server.osName && <p className="mt-1 max-w-[200px] truncate text-[10px] text-slate-400">{server.osName}</p>}</div></div></td>
          <td className="px-4 py-4"><StatusBadge status={server.state} /><div className="mt-2 flex items-center gap-1 text-xs text-slate-400"><MapPin className="h-3 w-3" />{server.zone ?? 'Zona tidak diketahui'}</div></td>
          <td className="px-4 py-4"><Groups server={server} /></td><td className="px-4 py-4"><Specs server={server} /></td><td className="px-4 py-4"><Ips server={server} /></td>
          <td className="px-4 py-4"><StatusBadge status={server.syncStatus} /><p className="mt-2 text-[11px] whitespace-nowrap text-slate-400" title={server.lastSyncedAt ?? undefined}>{relativeTime(server.lastSyncedAt)}</p>{server.lastError && <p className="mt-1 max-w-[150px] truncate text-[10px] text-amber-500" title={server.lastError}>{server.lastError}</p>}</td>
          <td className="px-5 py-4"><div className="flex items-center justify-end gap-1"><ServerActions server={server} compact /><Link to={`/servers/${server.uuid}`} className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-teal-600 dark:hover:bg-slate-800" aria-label={`Buka ${server.title}`} title="Buka detail"><ArrowUpRight className="h-4 w-4" /></Link></div></td>
        </tr>)}</tbody></table></div>
    </Card>
    <div className="space-y-3 md:hidden">{servers.map((server) => <Card key={server.uuid} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link to={`/servers/${server.uuid}`} className="block truncate font-semibold text-slate-900 dark:text-white">{server.title}</Link><code className="mt-1 block text-[10px] text-slate-400">{shortUuid(server.uuid)}</code></div><StatusBadge status={server.state} /></div>
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-950/60"><div><span className="text-slate-400">Spesifikasi</span><p className="mt-1 font-medium">{server.coreNumber} vCPU · {formatMemory(server.memoryMib)}</p></div><div><span className="text-slate-400">Storage</span><p className="mt-1 font-medium">{formatStorage(server.storageGib)}</p></div><div><span className="text-slate-400">Zona</span><p className="mt-1 font-medium">{server.zone ?? '—'}</p></div><div><span className="text-slate-400">Sinkron</span><p className="mt-1 font-medium">{relativeTime(server.lastSyncedAt)}</p></div></div>
      <div className="mt-3 flex items-center justify-between gap-2"><div className="min-w-0"><Groups server={server} /></div><ServerActions server={server} compact /></div><Link to={`/servers/${server.uuid}`} className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">Detail & monitoring<ArrowUpRight className="h-3.5 w-3.5" /></Link>
    </Card>)}</div>
  </>;
}

export function ServerMiniSummary({ server }: { server: Server }) {
  return <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"><span className="flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5 text-slate-400" />{server.coreNumber} vCPU</span><span className="flex items-center gap-1.5"><HardDrive className="h-3.5 w-3.5 text-slate-400" />{formatStorage(server.storageGib)}</span><span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-400" />{server.zone}</span><span className="flex items-center gap-1.5"><Network className="h-3.5 w-3.5 text-slate-400" />{server.publicIps.length + server.privateIps.length} IP</span></div>;
}
