import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import type { AgentStatus } from '../types';
import { formatDate, relativeTime } from '../utils';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, CopyButton, Field, inputClass, Modal } from './ui';

export default function AgentPanel({ serverUuid }: { serverUuid: string }) {
  const { user } = useAuth();
  const { push } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ['agent', serverUuid], queryFn: () => api.get<AgentStatus>(`/api/servers/${serverUuid}/agent`),
    enabled: user?.role === 'admin', retry: 0,
  });
  const rotate = useMutation({
    mutationFn: () => api.post<{ token: string; note: string }>(`/api/servers/${serverUuid}/agent/rotate`, {}),
    onSuccess: async (result) => { setToken(result.token); setConfirming(false); await status.refetch(); },
    onError: (error) => push('error', 'Rotasi agent gagal', error.message),
  });
  if (user?.role !== 'admin') return null;
  const command = token ? `PANEL_URL=${JSON.stringify(window.location.origin)} AGENT_TOKEN=${JSON.stringify(token)} SERVER_UUID=${serverUuid} node cerdasnet-agent.mjs` : '';
  return <>
    <Card className="mt-5 p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="rounded-xl bg-violet-50 p-2 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400"><Bot className="h-5 w-5" /></div><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">Guest OS agent</h3>{status.data?.configured ? <Badge tone="green">Terkonfigurasi</Badge> : <Badge>Belum ada token</Badge>}</div><p className="mt-1 text-xs leading-5 text-slate-400">Diperlukan untuk filesystem, RAM/swap usage, dan uptime aktual. Terakhir mengirim: {status.data?.lastSeenAt ? `${relativeTime(status.data.lastSeenAt)} · ${formatDate(status.data.lastSeenAt)}` : 'belum pernah'}.</p></div></div><Button variant="outline" size="sm" loading={rotate.isPending} onClick={() => setConfirming(true)}><RefreshCw className="h-3.5 w-3.5" />{status.data?.configured ? 'Rotasi token agent' : 'Buat token agent'}</Button></div>
      {token && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><p className="text-xs leading-5 text-amber-800 dark:text-amber-300">Token hanya tampil sekali. Salin sekarang dan simpan sebagai secret di VPS; jangan kirim melalui chat atau commit ke Git.</p></div><div className="mt-3 flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-white p-2 text-xs dark:bg-slate-950">{token}</code><CopyButton value={token} label="Salin agent token" /></div><Field label="Contoh menjalankan scripts/guest-agent.mjs di VPS"><div className="flex items-start gap-2"><textarea readOnly className={`${inputClass} min-h-24 font-mono text-[11px]`} value={command} /><CopyButton value={command} label="Salin perintah agent" /></div></Field></div>}
    </Card>
    {confirming && <Modal title={status.data?.configured ? 'Rotasi token agent?' : 'Buat token agent?'} description="Token lama akan berhenti berlaku. Tidak ada operasi power pada VPS." onClose={() => !rotate.isPending && setConfirming(false)} footer={<><Button variant="outline" onClick={() => setConfirming(false)}>Batal</Button><Button loading={rotate.isPending} onClick={() => rotate.mutate()}><KeyRound className="h-4 w-4" />Ya, buat token baru</Button></>}><p className="text-sm leading-6 text-slate-500">Agent hanya dapat mengirim metrik untuk UUID <code>{serverUuid}</code>. Token ini tidak memberikan akses ke UpCloud maupun panel admin.</p></Modal>}
  </>;
}
