import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Cloud, HardDrive, Info, PlusCircle, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import type { SyncJob } from '../types';
import { useJobs } from '../context/JobsContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, ErrorState, Field, inputClass, Modal, PageHeader, Skeleton } from '../components/ui';

type Catalog = {
  token: { id: string; name: string };
  templates: Array<{ uuid: string; title: string; sizeGib: number; zone: string | null }>;
  plans: Array<{ name: string; coreNumber: number; memoryMib: number; storageGib: number; storageTier: string | null }>;
  zones: Array<{ id: string; description: string; public: boolean }>;
};
const initial = { title: '', hostname: '', zone: '', plan: '', templateUuid: '', storageGib: 10, storageTier: 'maxiops', sshKeys: '', passwordDelivery: 'none' };

export default function DeployPage() {
  const [tokenId, setTokenId] = useState('');
  const [form, setForm] = useState(initial);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmationTitle, setConfirmationTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const targets = useQuery({ queryKey: ['deployment-targets'], queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>('/api/targets') });
  const selectedTokenId = tokenId || targets.data?.items[0]?.id || '';
  const catalog = useQuery({ queryKey: ['deployment-catalog', selectedTokenId], queryFn: () => api.get<Catalog>(`/api/catalog/${selectedTokenId}`), enabled: Boolean(selectedTokenId), retry: 1 });
  const { trackJob } = useJobs(); const { push } = useToast(); const navigate = useNavigate();
  const set = (key: keyof typeof initial, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  const templateUuid = form.templateUuid || catalog.data?.templates[0]?.uuid || '';
  const planName = form.plan || catalog.data?.plans[0]?.name || '';
  const zoneName = form.zone || (catalog.data?.zones.find((item) => item.public) ?? catalog.data?.zones[0])?.id || '';
  const selectedTemplate = catalog.data?.templates.find((item) => item.uuid === templateUuid);
  const selectedPlan = catalog.data?.plans.find((item) => item.name === planName);
  const storageGib = Math.max(Number(form.storageGib), selectedTemplate?.sizeGib ?? 1, selectedPlan?.storageGib ?? 1);
  const openConfirmation = (event: FormEvent) => {
    event.preventDefault();
    const minimum = Math.max(selectedTemplate?.sizeGib ?? 1, selectedPlan?.storageGib ?? 1);
    if (storageGib < minimum) { push('error', 'Storage terlalu kecil', `Minimum ${minimum} GiB untuk template dan plan ini.`); return; }
    if (form.passwordDelivery === 'none' && !form.sshKeys.trim()) { push('error', 'SSH key diperlukan', 'Tambahkan public key atau pilih password delivery email.'); return; }
    setConfirmationTitle(''); setConfirmOpen(true);
  };
  const deploy = async () => {
    setSubmitting(true);
    try {
      const job = await api.post<SyncJob>('/api/deployments', {
        ...form, tokenId: selectedTokenId, templateUuid, plan: planName, zone: zoneName, storageGib, confirmationTitle,
        sshKeys: form.sshKeys.split('\n').map((item) => item.trim()).filter(Boolean),
      });
      trackJob(job, `Deploy ${form.title}`); setConfirmOpen(false); setForm(initial);
      push('info', 'Deployment diterima', 'UpCloud sedang memproses VPS. Panel akan memverifikasi hasil provisioning sebelum menyatakan berhasil.');
      navigate('/servers');
    } catch (error) { push('error', 'Deployment tidak dapat dimulai', error instanceof Error ? error.message : undefined); }
    finally { setSubmitting(false); }
  };
  return <>
    <PageHeader eyebrow="Backend-controlled provisioning" title="Deploy VPS" description="Pilih OS, plan, dan zona dari katalog UpCloud aktual. Kredensial provider tidak pernah dikirim ke browser." />
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_340px]">
      <Card className="overflow-hidden"><div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6"><PlusCircle className="h-5 w-5 text-teal-500" /><div><h2 className="text-sm font-bold">Konfigurasi server baru</h2><p className="mt-1 text-xs text-slate-400">Semua pilihan divalidasi ulang oleh backend sebelum job dibuat.</p></div></div>
        {targets.isLoading ? <div className="p-6"><Skeleton className="h-80" /></div> : targets.error ? <ErrorState error={targets.error} retry={() => void targets.refetch()} /> : targets.data?.items.length === 0 ? <p className="p-6 text-sm text-slate-400">Belum ada koneksi provider aktif. Admin perlu menambahkan API token UpCloud.</p> : <form onSubmit={openConfirmation} className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
          <Field label="Koneksi provider" required><select className={inputClass} value={selectedTokenId} onChange={(event) => { setTokenId(event.target.value); setForm((current) => ({ ...current, templateUuid: '', plan: '', zone: '' })); }}>{targets.data?.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <div className="hidden sm:block" />
          <Field label="Nama VPS" required><input className={inputClass} value={form.title} onChange={(event) => set('title', event.target.value)} maxLength={255} required placeholder="Production web" /></Field>
          <Field label="Hostname" hint="Lowercase, format DNS valid." required><input className={inputClass} value={form.hostname} onChange={(event) => set('hostname', event.target.value.toLowerCase())} pattern="(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" required placeholder="web-01.example.com" /></Field>
          {catalog.isLoading ? <div className="sm:col-span-2"><Skeleton className="h-44" /></div> : catalog.error ? <div className="sm:col-span-2"><ErrorState error={catalog.error} retry={() => void catalog.refetch()} /></div> : <>
            <Field label="Sistem operasi / template" required><select className={inputClass} value={templateUuid} onChange={(event) => set('templateUuid', event.target.value)} required>{catalog.data?.templates.map((item) => <option key={item.uuid} value={item.uuid}>{item.title} · {item.sizeGib} GiB</option>)}</select></Field>
            <Field label="Plan" required><select className={inputClass} value={planName} onChange={(event) => { const plan = catalog.data?.plans.find((item) => item.name === event.target.value); set('plan', event.target.value); if (plan) set('storageGib', Math.max(Number(form.storageGib), plan.storageGib, selectedTemplate?.sizeGib ?? 1)); }} required>{catalog.data?.plans.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.coreNumber} vCPU · {item.memoryMib / 1024} GB RAM</option>)}</select></Field>
            <Field label="Zona" required><select className={inputClass} value={zoneName} onChange={(event) => set('zone', event.target.value)} required>{catalog.data?.zones.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.description}</option>)}</select></Field>
            <Field label="Storage tier" required><select className={inputClass} value={form.storageTier} onChange={(event) => set('storageTier', event.target.value)}><option value="maxiops">MaxIOPS</option><option value="standard">Standard</option><option value="hdd">HDD</option></select></Field>
            <Field label="Ukuran storage (GiB)" hint={`Minimum ${Math.max(selectedTemplate?.sizeGib ?? 1, selectedPlan?.storageGib ?? 1)} GiB.`} required><input type="number" min={1} max={4096} className={inputClass} value={storageGib} onChange={(event) => set('storageGib', Number(event.target.value))} required /></Field>
            <Field label="Password delivery" hint="Email dikirim provider ke email akun UpCloud; none memerlukan SSH key."><select className={inputClass} value={form.passwordDelivery} onChange={(event) => set('passwordDelivery', event.target.value)}><option value="none">None — gunakan SSH key</option><option value="email">Email oleh UpCloud</option></select></Field>
            <div className="sm:col-span-2"><Field label="SSH public keys" hint="Satu key per baris, maksimal 8. Private key tidak pernah diminta."><textarea className={`${inputClass} min-h-28 font-mono text-xs`} value={form.sshKeys} onChange={(event) => set('sshKeys', event.target.value)} maxLength={65536} placeholder="ssh-ed25519 AAAAC3... user@host" /></Field></div>
            <div className="flex justify-end sm:col-span-2"><Button type="submit" disabled={!catalog.data || !form.title || !form.hostname || !templateUuid}><PlusCircle className="h-4 w-4" />Tinjau deployment</Button></div>
          </>}
        </form>}
      </Card>
      <div className="space-y-5"><Card className="p-5"><ShieldCheck className="h-5 w-5 text-teal-500" /><h3 className="mt-3 text-sm font-bold">Provisioning terverifikasi</h3><p className="mt-2 text-xs leading-5 text-slate-400">Respons diterima bukan akhir proses. Worker menunggu VPS meninggalkan maintenance dan membaca ulang resource dari UpCloud.</p></Card><Card className="p-5"><Info className="h-5 w-5 text-sky-500" /><h3 className="mt-3 text-sm font-bold">Biaya & akses</h3><p className="mt-2 text-xs leading-5 text-slate-400">Deployment dapat menimbulkan biaya provider. Panel tidak menampilkan harga yang tidak tersedia dari API. Client yang melakukan deployment mendapat assignment ke VPS baru setelah resource dibuat.</p></Card></div>
    </div>
    {confirmOpen && <Modal title="Konfirmasi deployment berbayar" description="Pastikan konfigurasi sudah benar. Permintaan hanya dikirim sekali." onClose={() => !submitting && setConfirmOpen(false)} footer={<><Button variant="outline" disabled={submitting} onClick={() => setConfirmOpen(false)}>Batal</Button><Button loading={submitting} disabled={confirmationTitle !== form.title} onClick={() => void deploy()}><Cloud className="h-4 w-4" />Deploy melalui UpCloud</Button></>}>
      <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-xs dark:bg-slate-950"><dt className="text-slate-400">Nama / hostname</dt><dd className="text-right font-semibold">{form.title}<br />{form.hostname}</dd><dt className="text-slate-400">OS</dt><dd className="text-right">{selectedTemplate?.title}</dd><dt className="text-slate-400">Plan / zona</dt><dd className="text-right">{planName} · {zoneName}</dd><dt className="text-slate-400">Storage</dt><dd className="text-right"><HardDrive className="mr-1 inline h-3.5 w-3.5" />{storageGib} GiB · {form.storageTier}</dd></dl>
      <div className="mt-5"><Field label={`Ketik judul “${form.title}” untuk konfirmasi`} required><input autoFocus className={inputClass} value={confirmationTitle} onChange={(event) => setConfirmationTitle(event.target.value)} maxLength={255} /></Field></div>
    </Modal>}
  </>;
}
