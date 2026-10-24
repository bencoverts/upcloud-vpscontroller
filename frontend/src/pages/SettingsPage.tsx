import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CheckCircle2, Clock3, Database, Download, KeyRound, RefreshCw, Save, ShieldCheck, SlidersHorizontal, XCircle } from 'lucide-react';
import { api } from '../api';
import type { Settings } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, ErrorState, Field, inputClass, PageHeader, Skeleton } from '../components/ui';

export default function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ status: string; database: string; storage: string }>('/health/ready'), refetchInterval: 30_000, retry: 0 });
  return <>
    <PageHeader eyebrow="Panel configuration" title="Settings" description="Atur frekuensi sinkronisasi, polling UI, pengambilan metrik, dan retensi sampel lokal." />
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_340px]"><div className="space-y-6"><div>{settings.isLoading ? <Skeleton className="h-[520px]" /> : settings.error ? <Card><ErrorState error={settings.error} retry={() => void settings.refetch()} /></Card> : settings.data && <SettingsForm key={JSON.stringify(settings.data)} initial={settings.data} />}</div><PasswordForm /></div>
      <div className="space-y-5"><AdminBackup /><Card className="p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-teal-500" /><h2 className="text-sm font-bold">Status backend</h2></div>{health.isLoading ? <Badge>Memeriksa</Badge> : health.error ? <Badge tone="red">Tidak ready</Badge> : <Badge tone="green">Ready</Badge>}</div><div className="mt-4 space-y-3 text-xs"><div className="flex items-center justify-between"><span className="text-slate-400">HTTP API</span><span className="flex items-center gap-1.5 font-medium">{health.error ? <XCircle className="h-4 w-4 text-rose-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}{health.error ? 'Gagal' : 'Merespons'}</span></div><div className="flex items-center justify-between"><span className="text-slate-400">{health.data?.storage === 'r2_json' ? 'JSON R2 / Durable Object' : 'Database JSON lokal'}</span><span className="flex items-center gap-1.5 font-medium"><Database className="h-4 w-4 text-slate-400" />{health.data?.database ?? 'unknown'}</span></div></div><Button className="mt-4 w-full" variant="outline" size="sm" onClick={() => void health.refetch()}><RefreshCw className="h-3.5 w-3.5" />Periksa ulang</Button></Card>
        <Card className="p-5"><ShieldCheck className="h-5 w-5 text-teal-500" /><h2 className="mt-3 text-sm font-bold">Batas keamanan</h2><ul className="mt-3 space-y-2.5 text-xs leading-5 text-slate-400"><li>Token dienkripsi AES-256-GCM dan tidak pernah dikembalikan utuh.</li><li>Browser hanya mengakses API panel same-origin.</li><li>Session menggunakan cookie HttpOnly dan CSRF header.</li><li>Admin mengelola sistem; client hanya dapat mengubah VPS assignment yang masih berlaku.</li></ul></Card>
        <Card className="p-5"><Clock3 className="h-5 w-5 text-sky-500" /><h2 className="mt-3 text-sm font-bold">Tentang interval statistik</h2><p className="mt-2 text-xs leading-5 text-slate-400">Endpoint statistik yang digunakan memberikan daily summary. Polling lebih sering tidak menjamin angka upstream berubah. Interval 300 detik atau lebih disarankan untuk mengurangi beban dan risiko rate limit.</p></Card>
      </div></div>
  </>;
}

function AdminBackup() {
  const { user } = useAuth();
  const { push } = useToast();
  const [downloading, setDownloading] = useState(false);
  if (user?.role !== 'admin') return null;
  const download = async () => {
    setDownloading(true);
    try {
      const response = await fetch('/api/backup', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? 'Backup tidak dapat diunduh.');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      const disposition = response.headers.get('content-disposition');
      anchor.href = url;
      anchor.download = disposition?.match(/filename="([^"]+)"/)?.[1] ?? `cerdasnet-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      URL.revokeObjectURL(url);
      push('success', 'Backup JSON diunduh', 'Simpan file dan TOKEN_ENCRYPTION_KEY secara terpisah di lokasi aman. Sesi aktif tidak disertakan.');
    } catch (error) { push('error', 'Download backup gagal', error instanceof Error ? error.message : undefined); }
    finally { setDownloading(false); }
  };
  return <Card className="p-5"><Database className="h-5 w-5 text-teal-500" /><h2 className="mt-3 text-sm font-bold">Backup database JSON</h2><p className="mt-2 text-xs leading-5 text-slate-400">Snapshot konsisten berisi user, assignment, konfigurasi, token terenkripsi, dan metrik. Sesi login aktif dikeluarkan dari download.</p><Button className="mt-4 w-full" variant="outline" size="sm" loading={downloading} onClick={() => void download()}><Download className="h-3.5 w-3.5" />Download backup JSON</Button><p className="mt-3 text-[10px] leading-4 text-amber-600 dark:text-amber-400">File bersifat sangat sensitif. Encryption key tidak disertakan dan wajib disimpan terpisah untuk restore.</p></Card>;
}

function PasswordForm() {
  const { expireSession } = useAuth();
  const { push } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const valid = newPassword.length >= 12 && /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (!valid || newPassword !== confirmation) { setError('Password baru belum memenuhi syarat atau konfirmasi tidak sama.'); return; }
    setSaving(true);
    try {
      await api.patch('/api/auth/password', { currentPassword, newPassword });
      push('success', 'Password diperbarui', 'Semua sesi telah dicabut. Masuk kembali dengan password baru.');
      expireSession();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Password tidak dapat diubah.'); }
    finally { setSaving(false); }
  };
  return <Card className="overflow-hidden"><div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6"><KeyRound className="h-5 w-5 text-violet-500" /><div><h2 className="text-sm font-bold">Ganti password</h2><p className="mt-1 text-xs text-slate-400">Semua sesi akun dicabut setelah perubahan berhasil.</p></div></div><form onSubmit={submit} className="space-y-4 p-5 sm:p-6"><Field label="Password saat ini" required><input type="password" className={inputClass} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></Field><Field label="Password baru" hint="Minimal 12 karakter dengan huruf besar, huruf kecil, dan angka." required><input type="password" className={inputClass} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={256} required /></Field><Field label="Konfirmasi password baru" required><input type="password" className={inputClass} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={12} maxLength={256} required /></Field>{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}<Button type="submit" loading={saving} disabled={!currentPassword || !valid || newPassword !== confirmation}><KeyRound className="h-4 w-4" />Perbarui password & cabut sesi</Button></form></Card>;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const readOnly = user?.role !== 'admin';
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const update = (key: keyof Settings, value: number) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      const result = await api.patch<Settings>('/api/settings', form);
      await queryClient.invalidateQueries();
      setForm(result);
      push('success', 'Pengaturan disimpan', 'Scheduler membaca interval baru pada siklus berikutnya. Riwayat lama dibersihkan menurut retensi.');
    } catch (error) { push('error', 'Pengaturan tidak dapat disimpan', error instanceof Error ? error.message : undefined); }
    finally { setSaving(false); }
  };
  const fields: Array<{ key: keyof Settings; label: string; description: string; min: number; max: number; unit: string }> = [
    { key: 'syncIntervalSeconds', label: 'Interval sinkronisasi otomatis', description: 'Frekuensi penemuan ulang server dan detail konfigurasi untuk semua token aktif.', min: 60, max: 86400, unit: 'detik' },
    { key: 'serverPollSeconds', label: 'Polling server di browser', description: 'Interval refresh cache dashboard. Tidak secara langsung memanggil UpCloud.', min: 5, max: 3600, unit: 'detik' },
    { key: 'metricsRefreshSeconds', label: 'Refresh statistik UpCloud', description: 'Interval minimum pengambilan CPU/disk/network. Berlaku juga sebagai batas cache.', min: 60, max: 3600, unit: 'detik' },
    { key: 'metricsRetentionDays', label: 'Retensi riwayat metrik', description: 'Sampel yang lebih lama dihapus oleh cleanup scheduler. Backup tetap mengikuti kebijakan Anda.', min: 1, max: 365, unit: 'hari' },
  ];
  return <Card className="overflow-hidden"><div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6"><SlidersHorizontal className="h-5 w-5 text-teal-500" /><div><h2 className="text-sm font-bold">Sinkronisasi & monitoring</h2><p className="mt-1 text-xs text-slate-400">Perubahan divalidasi ulang oleh backend.</p></div></div><form onSubmit={save} className="p-5 sm:p-6"><div className="space-y-5">{fields.map((field) => <div key={field.key} className="grid gap-3 rounded-2xl border border-slate-100 p-4 dark:border-slate-800 sm:grid-cols-[1fr_190px] sm:items-center"><div><label htmlFor={field.key} className="text-sm font-semibold text-slate-800 dark:text-slate-200">{field.label}</label><p className="mt-1 text-xs leading-5 text-slate-400">{field.description}</p><p className="mt-1 text-[10px] text-slate-400">Rentang {field.min.toLocaleString('id-ID')}–{field.max.toLocaleString('id-ID')} {field.unit}</p></div><div className="relative"><input id={field.key} type="number" className={`${inputClass} pr-16`} value={form[field.key]} min={field.min} max={field.max} step={1} disabled={readOnly} required onChange={(event) => update(field.key, Number(event.target.value))} /><span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[10px] text-slate-400">{field.unit}</span></div></div>)}</div>
    {readOnly && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">Role client hanya dapat membaca pengaturan interval.</p>}<div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-5 dark:border-slate-800"><Button variant="outline" disabled={!dirty || saving} onClick={() => setForm(initial)}>Batalkan perubahan</Button><Button type="submit" loading={saving} disabled={!dirty || readOnly}><Save className="h-4 w-4" />Simpan pengaturan</Button></div></form></Card>;
}
