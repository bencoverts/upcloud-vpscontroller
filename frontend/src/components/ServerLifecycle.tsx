import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, HardDrive, Pencil, RefreshCcw, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { ServerDetail, SyncJob } from '../types';
import { useAuth } from '../context/AuthContext';
import { useJobs } from '../context/JobsContext';
import { useToast } from '../context/ToastContext';
import { Button, ErrorState, Field, inputClass, Modal, Skeleton } from './ui';

type Catalog = {
  templates: Array<{ uuid: string; title: string; sizeGib: number }>;
  plans: Array<{ name: string; coreNumber: number; memoryMib: number; storageGib: number }>;
};
type Mode = 'rebuild' | 'configuration' | 'delete' | null;
export default function ServerLifecycle({ server }: { server: ServerDetail }) {
  const [mode, setMode] = useState<Mode>(null);
  const { user } = useAuth();
  const busy = Boolean(server.activeJob) || server.state === 'maintenance';
  return <>
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => setMode('configuration')}><Pencil className="h-3.5 w-3.5" />Konfigurasi</Button><Button variant="outline" size="sm" disabled={busy || !['started', 'stopped'].includes(server.state)} onClick={() => setMode('rebuild')}><RefreshCcw className="h-3.5 w-3.5" />Change / reset OS</Button>{user?.role === 'admin' && <Button variant="outline" size="sm" className="text-rose-600" disabled={busy || server.state !== 'stopped'} onClick={() => setMode('delete')}><Trash2 className="h-3.5 w-3.5" />Delete</Button>}</div>
    {mode === 'rebuild' && <RebuildModal server={server} onClose={() => setMode(null)} />}
    {mode === 'configuration' && <ConfigurationModal server={server} onClose={() => setMode(null)} />}
    {mode === 'delete' && <DeleteModal server={server} onClose={() => setMode(null)} />}
  </>;
}

function useCatalog(uuid: string) {
  return useQuery({ queryKey: ['server-catalog', uuid], queryFn: () => api.get<Catalog>(`/api/servers/${uuid}/catalog`), retry: 1 });
}
function RebuildModal({ server, onClose }: { server: ServerDetail; onClose: () => void }) {
  const catalog = useCatalog(server.uuid);
  const [form, setForm] = useState({ mode: 'change_os', templateUuid: '', detachDisk: server.storages.find((item) => item.attached && item.deviceType !== 'cdrom')?.uuid ?? '', deleteDetachedDisk: false, encrypted: false, shutdownFirst: false, passwordDelivery: 'none', sshKeys: '' });
  const [confirmationTitle, setConfirmationTitle] = useState(''); const [submitting, setSubmitting] = useState(false);
  const { trackJob } = useJobs(); const { push } = useToast();
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true);
    try {
      const job = await api.post<SyncJob>(`/api/servers/${server.uuid}/rebuild`, { ...form, confirmationTitle, sshKeys: form.sshKeys.split('\n').map((item) => item.trim()).filter(Boolean) });
      trackJob(job, `${form.mode === 'reset_os' ? 'Reset' : 'Change'} OS ${server.title}`); push('info', 'Rebuild dikirim', 'Panel menunggu maintenance selesai dan status stopped terverifikasi. VPS tidak dinyalakan otomatis.'); onClose();
    } catch (error) { push('error', 'Rebuild tidak dapat dimulai', error instanceof Error ? error.message : undefined); }
    finally { setSubmitting(false); }
  };
  return <Modal wide title="Change / reset OS" description="Operasi destruktif pada boot disk. VPS wajib stopped sebelum UpCloud menerima rebuild." onClose={() => !submitting && onClose()}>
    {catalog.isLoading ? <Skeleton className="h-72" /> : catalog.error ? <ErrorState error={catalog.error} retry={() => void catalog.refetch()} /> : <form onSubmit={submit} className="space-y-5">
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs leading-5 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"><AlertTriangle className="mr-2 inline h-4 w-4" />Boot disk pengganti dibuat dari template. Disk lama dipertahankan secara default; menghapusnya bersifat permanen.</div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Mode"><select className={inputClass} value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}><option value="change_os">Change OS</option><option value="reset_os">Reset OS dari template</option></select></Field><Field label="Template OS" required><select className={inputClass} value={form.templateUuid} onChange={(event) => setForm({ ...form, templateUuid: event.target.value })} required><option value="" disabled>Pilih template</option>{catalog.data?.templates.map((item) => <option key={item.uuid} value={item.uuid}>{item.title} · {item.sizeGib} GiB</option>)}</select></Field>
      <Field label="Disk OS yang diganti" required><select className={inputClass} value={form.detachDisk} onChange={(event) => setForm({ ...form, detachDisk: event.target.value })} required>{server.storages.filter((item) => item.attached && item.deviceType !== 'cdrom').map((item) => <option key={item.uuid} value={item.uuid}>{item.title} · {item.sizeGib} GiB · {item.address}</option>)}</select></Field><Field label="Password delivery"><select className={inputClass} value={form.passwordDelivery} onChange={(event) => setForm({ ...form, passwordDelivery: event.target.value })}><option value="none">None — gunakan SSH key</option><option value="email">Email oleh UpCloud</option></select></Field></div>
      <Field label="SSH public keys" hint="Wajib jika password delivery none."><textarea className={`${inputClass} min-h-24 font-mono text-xs`} value={form.sshKeys} onChange={(event) => setForm({ ...form, sshKeys: event.target.value })} placeholder="ssh-ed25519 AAAAC3..." /></Field>
      <div className="space-y-3 text-xs"><label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={form.shutdownFirst} onChange={(event) => setForm({ ...form, shutdownFirst: event.target.checked })} /><span><strong>Shutdown dahulu jika masih started</strong><span className="mt-1 block text-slate-400">Job menunggu status stopped terverifikasi sebelum rebuild.</span></span></label><label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={form.encrypted} onChange={(event) => setForm({ ...form, encrypted: event.target.checked })} /><span><strong>Encrypt storage baru</strong><span className="mt-1 block text-slate-400">Diteruskan ke operasi rebuild resmi UpCloud.</span></span></label><label className="flex items-start gap-3 rounded-xl border border-rose-200 p-3 dark:border-rose-500/20"><input type="checkbox" className="mt-1" checked={form.deleteDetachedDisk} onChange={(event) => setForm({ ...form, deleteDetachedDisk: event.target.checked })} /><span><strong className="text-rose-600">Hapus disk lama setelah detach</strong><span className="mt-1 block text-slate-400">Data disk lama tidak dapat dipulihkan melalui panel. Biarkan mati untuk mempertahankannya.</span></span></label></div>
      <Field label={`Ketik judul “${server.title}” untuk konfirmasi`} required><input className={inputClass} value={confirmationTitle} onChange={(event) => setConfirmationTitle(event.target.value)} required /></Field>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={submitting} onClick={onClose}>Batal</Button><Button variant="danger" type="submit" loading={submitting} disabled={confirmationTitle !== server.title || !form.templateUuid || !form.detachDisk || (form.passwordDelivery === 'none' && !form.sshKeys.trim()) || (server.state !== 'stopped' && !form.shutdownFirst)}><RefreshCcw className="h-4 w-4" />Rebuild & verifikasi</Button></div>
    </form>}
  </Modal>;
}

function ConfigurationModal({ server, onClose }: { server: ServerDetail; onClose: () => void }) {
  const catalog = useCatalog(server.uuid); const queryClient = useQueryClient(); const { push } = useToast();
  const [form, setForm] = useState({ plan: server.plan ?? '', timezone: String(server.config.timezone ?? 'UTC'), bootOrder: String(server.config.boot_order ?? 'disk'), nicModel: String(server.config.nic_model ?? 'virtio'), metadata: server.config.metadata === 'yes' || server.config.metadata === true });
  const [confirmationTitle, setConfirmationTitle] = useState(''); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true);
    try { await api.patch(`/api/servers/${server.uuid}/configuration`, { ...form, confirmationTitle }); await queryClient.invalidateQueries({ queryKey: ['server', server.uuid] }); push('success', 'Konfigurasi diverifikasi', 'Perubahan dibaca kembali dari UpCloud dan cache panel diperbarui.'); onClose(); }
    catch (error) { push('error', 'Konfigurasi tidak dapat diubah', error instanceof Error ? error.message : undefined); }
    finally { setSubmitting(false); }
  };
  const planChanged = form.plan !== (server.plan ?? '');
  return <Modal title="Konfigurasi VPS" description="Perubahan plan membutuhkan status stopped dan dapat mengubah biaya/resource." onClose={() => !submitting && onClose()}>
    {catalog.isLoading ? <Skeleton className="h-64" /> : catalog.error ? <ErrorState error={catalog.error} retry={() => void catalog.refetch()} /> : <form onSubmit={submit} className="space-y-4"><Field label="Plan" hint={planChanged && server.state !== 'stopped' ? 'Stop VPS terlebih dahulu untuk mengubah plan.' : 'Plan divalidasi dari katalog UpCloud.'}><select className={inputClass} value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value })}>{catalog.data?.plans.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.coreNumber} vCPU · {item.memoryMib / 1024} GB RAM</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Timezone"><input className={inputClass} value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} maxLength={64} /></Field><Field label="Boot order"><input className={inputClass} value={form.bootOrder} onChange={(event) => setForm({ ...form, bootOrder: event.target.value })} maxLength={100} /></Field><Field label="NIC model"><select className={inputClass} value={form.nicModel} onChange={(event) => setForm({ ...form, nicModel: event.target.value })}><option value="virtio">VirtIO</option><option value="e1000">E1000</option><option value="rtl8139">RTL8139</option></select></Field><label className="flex items-center gap-3 pt-6 text-xs"><input type="checkbox" checked={form.metadata} onChange={(event) => setForm({ ...form, metadata: event.target.checked })} />Metadata service</label></div>
      <Field label={`Ketik judul “${server.title}” untuk konfirmasi`} required><input className={inputClass} value={confirmationTitle} onChange={(event) => setConfirmationTitle(event.target.value)} required /></Field><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Batal</Button><Button type="submit" loading={submitting} disabled={confirmationTitle !== server.title || (planChanged && server.state !== 'stopped')}>Simpan & verifikasi</Button></div></form>}
  </Modal>;
}

function DeleteModal({ server, onClose }: { server: ServerDetail; onClose: () => void }) {
  const [confirmationTitle, setConfirmationTitle] = useState(''); const [deleteStorages, setDeleteStorages] = useState(false); const [submitting, setSubmitting] = useState(false);
  const { push } = useToast(); const navigate = useNavigate(); const queryClient = useQueryClient();
  const remove = async () => {
    setSubmitting(true);
    try { await api.delete(`/api/servers/${server.uuid}`, { confirmationTitle, deleteStorages }); await queryClient.invalidateQueries({ queryKey: ['servers'] }); push('success', 'VPS dihapus dan diverifikasi', deleteStorages ? 'Server dan storage terlampir telah dihapus melalui UpCloud.' : 'Server dihapus; storage tidak diminta untuk dihapus.'); navigate('/servers'); }
    catch (error) { push('error', 'VPS tidak dapat dihapus', error instanceof Error ? error.message : undefined); }
    finally { setSubmitting(false); }
  };
  return <Modal title="Hapus VPS secara permanen?" description="Tindakan ini tidak dapat dibatalkan setelah diverifikasi UpCloud." onClose={() => !submitting && onClose()} footer={<><Button variant="outline" disabled={submitting} onClick={onClose}>Batal</Button><Button variant="danger" loading={submitting} disabled={confirmationTitle !== server.title} onClick={() => void remove()}><Trash2 className="h-4 w-4" />Hapus VPS</Button></>}><div className="rounded-2xl bg-rose-50 p-4 text-xs leading-5 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"><HardDrive className="mr-2 inline h-4 w-4" />VPS harus stopped. Panel membaca daftar upstream setelah delete dan tidak mengklaim sukses jika UUID masih ada.</div><label className="mt-5 flex items-start gap-3 text-xs"><input type="checkbox" className="mt-1" checked={deleteStorages} onChange={(event) => setDeleteStorages(event.target.checked)} /><span><strong>Hapus juga storage terlampir</strong><span className="mt-1 block text-slate-400">Sangat destruktif. Matikan opsi ini bila disk harus dipertahankan.</span></span></label><div className="mt-5"><Field label={`Ketik judul “${server.title}” untuk konfirmasi`} required><input autoFocus className={inputClass} value={confirmationTitle} onChange={(event) => setConfirmationTitle(event.target.value)} /></Field></div></Modal>;
}
