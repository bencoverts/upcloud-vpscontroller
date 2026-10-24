import { useState } from 'react';
import { Play, RefreshCw, RotateCw, Square } from 'lucide-react';
import { api } from '../api';
import type { Server, SyncJob } from '../types';
import { useJobs } from '../context/JobsContext';
import { useToast } from '../context/ToastContext';
import { Button, Modal } from './ui';

type Action = 'start' | 'stop' | 'restart';
const actionConfig = {
  start: { label: 'Start', title: 'Start server?', icon: Play, description: 'Server akan dinyalakan melalui endpoint resmi UpCloud. Panel menunggu status started terverifikasi.' },
  stop: { label: 'Stop', title: 'Stop server?', icon: Square, description: 'Soft stop dengan timeout 60 detik akan dikirim. Layanan pada VPS menjadi tidak tersedia. Jika UpCloud belum mencapai stopped, panel menampilkan verification timeout—bukan sukses palsu.' },
  restart: { label: 'Restart', title: 'Restart server?', icon: RotateCw, description: 'Server akan dihentikan sementara lalu dinyalakan kembali menggunakan soft restart. Terjadi downtime selama proses. Status started diverifikasi dua kali setelah operasi.' },
};

export default function ServerActions({ server, compact = false, showSync = false }: { server: Server; compact?: boolean; showSync?: boolean }) {
  const [action, setAction] = useState<Action | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { trackJob, isServerBusy } = useJobs();
  const { push } = useToast();
  const busy = isServerBusy(server.uuid) || Boolean(server.activeJob) || submitting;
  const execute = async () => {
    if (!action) return;
    setSubmitting(true);
    try {
      const job = await api.post<SyncJob>(`/api/servers/${server.uuid}/actions`, { action });
      trackJob(job, `${actionConfig[action].label} ${server.title}`);
      push('info', 'Operasi dikirim ke UpCloud', 'Menunggu hasil dan verifikasi status akhir. Jangan mengulangi tindakan selama job aktif.');
      setAction(null);
    } catch (error) { push('error', 'Operasi tidak dapat dimulai', error instanceof Error ? error.message : undefined); }
    finally { setSubmitting(false); }
  };
  const synchronize = async () => {
    setSubmitting(true);
    try {
      const job = await api.post<SyncJob>(`/api/servers/${server.uuid}/sync`, {});
      trackJob(job, `Sinkronisasi ${server.title}`);
      push('info', 'Sinkronisasi dimulai', 'Konfigurasi dan status terbaru akan diambil dari UpCloud.');
    } catch (error) { push('error', 'Sinkronisasi gagal dimulai', error instanceof Error ? error.message : undefined); }
    finally { setSubmitting(false); }
  };
  const buttons = (Object.keys(actionConfig) as Action[]).map((key) => {
    const config = actionConfig[key];
    const Icon = config.icon;
    const enabled = key === 'start' ? server.state === 'stopped' : server.state === 'started';
    return <Button key={key} variant={key === 'stop' && !compact ? 'danger' : compact ? 'ghost' : 'outline'} size={compact ? 'icon' : 'sm'} disabled={!enabled || busy} onClick={() => setAction(key)} title={`${config.label} ${server.title}`} aria-label={`${config.label} ${server.title}`}><Icon className="h-4 w-4" />{!compact && config.label}</Button>;
  });
  return <>
    <div className="flex items-center gap-1.5">{showSync && <Button variant="outline" size={compact ? 'icon' : 'sm'} loading={submitting && !action} disabled={busy} onClick={synchronize}><RefreshCw className="h-4 w-4" />{!compact && 'Sinkronisasi'}</Button>}{buttons}</div>
    {action && <Modal title={actionConfig[action].title} description="Operasi berdampak pada ketersediaan server." onClose={() => !submitting && setAction(null)} footer={<><Button variant="outline" disabled={submitting} onClick={() => setAction(null)}>Batal</Button><Button variant={action === 'stop' ? 'danger' : 'primary'} loading={submitting} onClick={execute}>Ya, {actionConfig[action].label.toLowerCase()} server</Button></>}>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950"><p className="font-semibold text-slate-900 dark:text-white">{server.title}</p><code className="mt-1 block break-all text-xs text-slate-500 dark:text-slate-400">{server.uuid}</code></div>
      <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">{actionConfig[action].description}</p>
      <p className="mt-3 text-xs leading-5 text-amber-600 dark:text-amber-400">Pastikan Anda memiliki otorisasi untuk mengelola VPS ini. Operasi hanya dikirim sekali dan tidak di-retry otomatis.</p>
    </Modal>}
  </>;
}
