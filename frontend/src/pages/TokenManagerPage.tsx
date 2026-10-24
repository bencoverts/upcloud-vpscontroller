import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Edit3, KeyRound, ListChecks, Plus, Power, RefreshCw, Replace, Server, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { SyncJob, Token } from '../types';
import { formatDate, relativeTime } from '../utils';
import { useToast } from '../context/ToastContext';
import { useJobs } from '../context/JobsContext';
import { Badge, Button, Card, EmptyState, ErrorState, Field, inputClass, Modal, PageHeader, Skeleton, StatusBadge } from '../components/ui';
import { SelectionModal, TokenFormModal } from '../components/TokenForm';

type Dialog = { type: 'add' } | { type: 'replace' | 'edit' | 'delete' | 'selection' | 'disable'; token: Token } | null;

export default function TokenManagerPage() {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busyAction, setBusyAction] = useState('');
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => api.get<Token[]>('/api/tokens'), refetchInterval: 30_000 });
  const { trackJob, isTokenBusy } = useJobs();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tokens'] });
  const testConnection = async (token: Token) => {
    setBusyAction(`${token.id}:test`);
    try {
      await api.post(`/api/tokens/${token.id}/test`, {});
      await refresh();
      push('success', 'Koneksi token valid', `${token.name} berhasil diautentikasi oleh UpCloud.`);
    } catch (error) { await refresh(); push('error', 'Uji koneksi gagal', error instanceof Error ? error.message : undefined); }
    finally { setBusyAction(''); }
  };
  const synchronize = async (token: Token) => {
    setBusyAction(`${token.id}:sync`);
    try {
      const job = await api.post<SyncJob>(`/api/tokens/${token.id}/sync`, {});
      trackJob(job, `Sinkronisasi ${token.name}`);
      push('info', 'Sinkronisasi dimulai', 'Daftar dan detail VPS akan diperbarui tanpa memengaruhi token lain.');
    } catch (error) { push('error', 'Sinkronisasi tidak dapat dimulai', error instanceof Error ? error.message : undefined); }
    finally { setBusyAction(''); }
  };
  const toggleEnabled = async (token: Token) => {
    setBusyAction(`${token.id}:enabled`);
    try {
      await api.patch(`/api/tokens/${token.id}/enabled`, { enabled: !token.enabled });
      await refresh();
      push('success', token.enabled ? 'Token dinonaktifkan' : 'Token diaktifkan', token.enabled ? 'Data cache tetap tersedia; sinkronisasi berikutnya dilewati.' : 'Token siap digunakan untuk sinkronisasi.');
      setDialog(null);
    } catch (error) { push('error', 'Status token tidak dapat diubah', error instanceof Error ? error.message : undefined); }
    finally { setBusyAction(''); }
  };
  const data = tokens.data ?? [];
  return <>
    <PageHeader eyebrow="Credential management" title="API Token Manager" description="Kelola sebanyak token UpCloud yang Anda butuhkan. Nilai token penuh tidak pernah dikirim kembali ke browser setelah disimpan." actions={<Button onClick={() => setDialog({ type: 'add' })}><Plus className="h-4 w-4" />Tambah API token</Button>} />
    <div className="mb-6 grid gap-4 md:grid-cols-3">
      <Card className="p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-violet-50 p-2.5 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400"><KeyRound className="h-5 w-5" /></div><div><p className="text-2xl font-bold text-slate-950 dark:text-white">{data.length}</p><p className="text-xs text-slate-400">Token terdaftar</p></div></div></Card>
      <Card className="p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"><CheckCircle2 className="h-5 w-5" /></div><div><p className="text-2xl font-bold text-slate-950 dark:text-white">{data.filter((token) => token.enabled && token.connectionStatus === 'online').length}</p><p className="text-xs text-slate-400">Koneksi online</p></div></div></Card>
      <Card className="p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-sky-50 p-2.5 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400"><Server className="h-5 w-5" /></div><div><p className="text-2xl font-bold text-slate-950 dark:text-white">{data.reduce((sum, token) => sum + token.serverCount, 0)}</p><p className="text-xs text-slate-400">Relasi token–VPS (sebelum dedup global)</p></div></div></Card>
    </div>
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50/70 p-4 text-xs leading-5 text-sky-800 dark:border-sky-500/15 dark:bg-sky-500/5 dark:text-sky-300"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Pengelompokan bukan pembatasan akses.</strong> Satu token dapat menemukan lebih dari dua VPS. Semua hasil API tetap disinkronkan dan dideduplikasi di dashboard global; maksimal dua hanya untuk pilihan tampilan grup. Cabut token melalui UpCloud Hub jika sudah tidak dipercaya, lalu ganti atau hapus kredensial lokal.</p></div>
    {tokens.isLoading ? <div className="grid gap-5 xl:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[390px]" />)}</div> : tokens.error ? <Card><ErrorState error={tokens.error} retry={() => void tokens.refetch()} /></Card> : data.length === 0 ? <Card><EmptyState icon={KeyRound} title="Belum ada API token" description="Tambahkan bearer token yang dibuat di UpCloud Hub. Backend akan memvalidasi token dan mengambil daftar VPS nyata sebelum konfigurasi disimpan." action={<Button onClick={() => setDialog({ type: 'add' })}><Plus className="h-4 w-4" />Tambahkan token pertama</Button>} /></Card> : <div className="grid items-start gap-5 xl:grid-cols-2">{data.map((token) => {
      const busy = isTokenBusy(token.id) || Boolean(token.activeJob) || busyAction.startsWith(token.id);
      return <Card key={token.id} className="overflow-hidden"><div className="p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-base font-bold text-slate-950 dark:text-white">{token.name}</h2>{!token.enabled && <Badge>Nonaktif</Badge>}</div><code className="mt-2 block text-xs text-slate-400">{token.maskedToken}</code></div><div className="flex shrink-0 gap-2"><StatusBadge status={token.validationStatus} /><StatusBadge status={token.enabled ? token.connectionStatus : 'offline'} /></div></div>
        <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-xs dark:bg-slate-950/50 sm:grid-cols-4"><div><p className="text-slate-400">VPS ditemukan</p><p className="mt-1.5 text-lg font-bold text-slate-900 dark:text-white">{token.serverCount}</p></div><div><p className="text-slate-400">Ditambahkan</p><p className="mt-1.5 font-medium" title={formatDate(token.createdAt)}>{relativeTime(token.createdAt)}</p></div><div><p className="text-slate-400">Sinkron terakhir</p><p className="mt-1.5 font-medium" title={formatDate(token.lastSyncAt)}>{relativeTime(token.lastSyncAt)}</p></div><div><p className="text-slate-400">Masa berlaku</p><p className="mt-1.5 font-medium" title={token.expiryVerified ? 'Terverifikasi' : 'Metadata admin'}>{token.expiresAt ? formatDate(token.expiresAt) : 'Tidak dicatat'}</p></div></div>
        <div className="mt-5"><div className="mb-2.5 flex items-center justify-between"><p className="text-xs font-semibold text-slate-600 dark:text-slate-300">VPS pilihan grup ({token.selectedServers.length}/2)</p><button onClick={() => setDialog({ type: 'selection', token })} className="text-xs font-semibold text-teal-600 hover:underline dark:text-teal-400">Ubah pilihan</button></div>{token.selectedServers.length ? <div className="grid gap-2 sm:grid-cols-2">{token.selectedServers.map((server) => <SelectedServerCard key={server.uuid} server={server} />)}</div> : <button onClick={() => setDialog({ type: 'selection', token })} className="w-full rounded-xl border border-dashed border-slate-300 py-4 text-xs text-slate-400 hover:border-teal-400 hover:text-teal-600 dark:border-slate-700">Pilih maksimal dua VPS untuk grup ini</button>}</div>
        {token.lastError && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"><strong>{token.lastError.code}</strong><p className="mt-1 break-words">{token.lastError.message}</p></div>}
        <p className="mt-4 text-[11px] text-slate-400">Terakhir digunakan panel: {formatDate(token.lastUsedAt)} · Masa berlaku {token.expiryVerified ? 'terverifikasi' : 'metadata admin'}</p>
      </div><div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4 dark:border-slate-800 dark:bg-slate-950/30 sm:px-6">
        <Button variant="outline" size="sm" disabled={busy} loading={busyAction === `${token.id}:test`} onClick={() => void testConnection(token)}><ShieldCheck className="h-3.5 w-3.5" />Uji koneksi</Button>
        <Button variant="outline" size="sm" disabled={busy || !token.enabled} loading={busyAction === `${token.id}:sync`} onClick={() => void synchronize(token)}><RefreshCw className="h-3.5 w-3.5" />Sinkronisasi</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDialog({ type: 'edit', token })}><Edit3 className="h-3.5 w-3.5" />Edit grup</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDialog({ type: 'selection', token })}><ListChecks className="h-3.5 w-3.5" />Pilih VPS</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDialog({ type: 'replace', token })}><Replace className="h-3.5 w-3.5" />Ganti token</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => token.enabled ? setDialog({ type: 'disable', token }) : void toggleEnabled(token)}><Power className="h-3.5 w-3.5" />{token.enabled ? 'Nonaktifkan' : 'Aktifkan'}</Button>
        <Button variant="ghost" size="sm" className="text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" disabled={busy} onClick={() => setDialog({ type: 'delete', token })}><Trash2 className="h-3.5 w-3.5" />Hapus</Button>
      </div></Card>;
    })}</div>}
    {dialog?.type === 'add' && <TokenFormModal onClose={() => setDialog(null)} />}
    {dialog?.type === 'replace' && <TokenFormModal existing={dialog.token} onClose={() => setDialog(null)} />}
    {dialog?.type === 'selection' && <SelectionModal token={dialog.token} onClose={() => setDialog(null)} />}
    {dialog?.type === 'edit' && <EditTokenModal token={dialog.token} onClose={() => setDialog(null)} />}
    {dialog?.type === 'delete' && <DeleteTokenModal token={dialog.token} onClose={() => setDialog(null)} />}
    {dialog?.type === 'disable' && <Modal title="Nonaktifkan token?" description={dialog.token.name} onClose={() => setDialog(null)} footer={<><Button variant="outline" onClick={() => setDialog(null)}>Batal</Button><Button variant="danger" loading={busyAction === `${dialog.token.id}:enabled`} onClick={() => void toggleEnabled(dialog.token)}>Nonaktifkan token</Button></>}><p className="text-sm leading-6 text-slate-600 dark:text-slate-300">Sinkronisasi dan kontrol baru melalui token ini akan ditolak. Token dengan job aktif harus menunggu job selesai sebelum dapat dinonaktifkan. Data cache dan relasi tetap tersimpan; server yang juga ditemukan token lain tetap tersedia.</p></Modal>}
  </>;
}

function SelectedServerCard({ server }: { server: Token['selectedServers'][number] }) {
  const content = <><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">P{server.slot} · {server.title}</span><StatusBadge status={server.active ? server.state : 'not_found'} /></div><code className="mt-1.5 block truncate text-[10px] text-slate-400">{server.uuid}</code></>;
  const className = 'rounded-xl border border-slate-200 p-3 dark:border-slate-700';
  if (!server.active) return <div className={className} title="Server tidak lagi aktif pada token ini">{content}</div>;
  return <Link to={`/servers/${server.uuid}`} className={`${className} hover:border-teal-300 dark:hover:border-teal-500/40`}>{content}</Link>;
}

function EditTokenModal({ token, onClose }: { token: Token; onClose: () => void }) {
  const [name, setName] = useState(token.name);
  const [expiry, setExpiry] = useState(() => {
    if (!token.expiresAt) return '';
    const date = new Date(token.expiresAt);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { push } = useToast();
  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/tokens/${token.id}`, { name: name.trim(), expiresAt: expiry ? new Date(expiry).toISOString() : null });
      await queryClient.invalidateQueries({ queryKey: ['tokens'] });
      push('success', 'Grup token diperbarui'); onClose();
    } catch (error) { push('error', 'Grup tidak dapat disimpan', error instanceof Error ? error.message : undefined); }
    finally { setSaving(false); }
  };
  return <Modal title="Edit grup token" description="Nama dan masa berlaku lokal tidak mengubah token atau hak akses UpCloud." onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button loading={saving} disabled={!name.trim()} onClick={save}>Simpan perubahan</Button></>}><div className="space-y-4"><Field label="Nama token" required><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus /></Field><Field label="Masa berlaku menurut UpCloud Hub" hint="Metadata admin, bukan klaim terverifikasi dari bearer token. Kosongkan jika tidak dicatat."><input type="datetime-local" className={inputClass} value={expiry} onChange={(event) => setExpiry(event.target.value)} /></Field></div></Modal>;
}

function DeleteTokenModal({ token, onClose }: { token: Token; onClose: () => void }) {
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();
  const { push } = useToast();
  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`/api/tokens/${token.id}`, { confirmationName: confirmation });
      await queryClient.invalidateQueries();
      push('success', 'Kredensial lokal dihapus', 'Token tidak dicabut di UpCloud. Cabut melalui UpCloud Hub bila diperlukan.');
      onClose();
    } catch (error) { push('error', 'Token tidak dapat dihapus', error instanceof Error ? error.message : undefined); }
    finally { setDeleting(false); }
  };
  return <Modal title="Hapus API token?" description="Tindakan ini menghapus ciphertext kredensial dan relasi token dari panel." onClose={() => !deleting && onClose()} footer={<><Button variant="outline" disabled={deleting} onClick={onClose}>Batal</Button><Button variant="danger" loading={deleting} disabled={confirmation !== token.name} onClick={remove}>Hapus permanen dari panel</Button></>}><div className="rounded-xl bg-rose-50 p-3 text-xs leading-5 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">Server yang hanya ditemukan token ini akan hilang dari dashboard aktif. Server yang masih terkait token lain tetap tersedia. Operasi ini tidak mencabut token di UpCloud.</div><div className="mt-4"><Field label={`Ketik "${token.name}" untuk konfirmasi`} required><input className={inputClass} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></Field></div></Modal>;
}
