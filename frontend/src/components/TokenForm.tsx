import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, EyeOff, Loader2, Search, Server, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import type { Token } from '../types';
import { cx, formatMemory } from '../utils';
import { useToast } from '../context/ToastContext';
import { useJobs } from '../context/JobsContext';
import { Badge, Button, Field, inputClass, Modal, StatusBadge } from './ui';

type Discovered = { uuid: string; title: string; state: string; zone: string | null; coreNumber: number; memoryMib: number; selectedSlot?: number | null };
type Validation = { valid: boolean; servers: Discovered[]; maskedToken: string; account: { username: string | null } };
const localExpiry = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

export function TokenFormModal({ existing, onClose }: { existing?: Token; onClose: () => void }) {
  const isReplace = Boolean(existing);
  const [name, setName] = useState(existing?.name ?? '');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [expiry, setExpiry] = useState(localExpiry(existing?.expiresAt));
  const [validation, setValidation] = useState<Validation | null>(null);
  const [validatedSecret, setValidatedSecret] = useState('');
  const [selected, setSelected] = useState<string[]>(existing?.selectedServers.filter((server) => server.active).sort((a, b) => a.slot - b.slot).map((server) => server.uuid) ?? []);
  const [search, setSearch] = useState('');
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { push } = useToast();
  const { trackJob } = useJobs();
  const queryClient = useQueryClient();
  const filteredServers = useMemo(() => validation?.servers.filter((server) => `${server.title} ${server.uuid} ${server.zone}`.toLowerCase().includes(search.toLowerCase())) ?? [], [validation, search]);
  const changeSecret = (value: string) => { setSecret(value); setValidation(null); setValidatedSecret(''); setError(''); };
  const validate = async () => {
    setValidating(true); setError('');
    try {
      const result = await api.post<Validation>('/api/tokens/validate', { token: secret });
      setValidation(result); setValidatedSecret(secret);
      setSelected((current) => current.filter((uuid) => result.servers.some((server) => server.uuid === uuid)).slice(0, 2));
      push('success', 'Token valid', `${result.servers.length} VPS ditemukan melalui UpCloud API.`);
    } catch (reason) { setValidation(null); setError(reason instanceof Error ? reason.message : 'Validasi gagal.'); }
    finally { setValidating(false); }
  };
  const toggleServer = (uuid: string) => {
    if (selected.includes(uuid)) { setSelected(selected.filter((item) => item !== uuid)); return; }
    if (selected.length >= 2) { push('warning', 'Maksimal dua VPS per grup', 'Hapus satu pilihan sebelum memilih server lain. Hak akses token di UpCloud tidak berubah.'); return; }
    setSelected([...selected, uuid]);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!validation || validatedSecret !== secret) { setError('Validasi token terlebih dahulu tanpa mengubah nilainya setelah validasi.'); return; }
    setSaving(true); setError('');
    try {
      const body = { token: secret, expiresAt: expiry ? new Date(expiry).toISOString() : null, selectedServerUuids: selected };
      const result = isReplace
        ? await api.put<Token>(`/api/tokens/${existing!.id}/replace`, body)
        : await api.post<Token>('/api/tokens', { ...body, name: name.trim() });
      if (result.syncJob) trackJob(result.syncJob, 'Sinkronisasi detail token');
      await queryClient.invalidateQueries();
      if (result.syncNotice) push('warning', 'Token tersimpan; periksa antrean sync', result.syncNotice);
      else push('success', isReplace ? 'Token berhasil diganti' : 'Grup token berhasil ditambahkan', `${result.serverCount} VPS ditemukan; ${selected.length} VPS dipilih untuk grup.`);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Token tidak dapat disimpan.'); }
    finally { setSaving(false); }
  };
  return <Modal wide title={isReplace ? `Ganti token · ${existing!.name}` : 'Tambahkan API token'} description="Validasi langsung ke UpCloud, lalu pilih maksimal dua VPS untuk tampilan grup." onClose={() => !saving && onClose()} footer={<><Button variant="outline" disabled={saving} onClick={onClose}>Batal</Button><Button type="submit" form="token-form" loading={saving} disabled={!validation || validatedSecret !== secret || (!isReplace && !name.trim())}>{isReplace ? 'Ganti & sinkronkan' : 'Simpan grup token'}</Button></>}>
    <form id="token-form" onSubmit={save} className="space-y-5">
      {!isReplace && <Field label="Nama grup token" hint="Contoh: CerdasNet VPS Group 01. Nama dapat diubah kapan saja." required><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} minLength={1} maxLength={120} required placeholder="CerdasNet VPS Production" /></Field>}
      <Field label="API token UpCloud" hint="Dikirim hanya ke backend panel melalui HTTPS. Jangan gunakan token dari akun yang tidak Anda kelola." required><div className="relative"><input className={`${inputClass} pr-11 font-mono text-xs`} type={showSecret ? 'text' : 'password'} value={secret} onChange={(event) => changeSecret(event.target.value)} required minLength={16} maxLength={4096} autoComplete="off" spellCheck={false} placeholder="ucat_••••••••••••••••" /><button type="button" className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400" onClick={() => setShowSecret((value) => !value)} aria-label={showSecret ? 'Sembunyikan token' : 'Tampilkan token'}>{showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></Field>
      <Field label="Masa berlaku menurut UpCloud Hub (opsional)" hint="Metadata admin, bukan klaim terverifikasi. UpCloud tetap menolak token kedaluwarsa/dicabut/filter IP saat request."><input type="datetime-local" className={inputClass} value={expiry} onChange={(event) => setExpiry(event.target.value)} /></Field>
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" loading={validating} disabled={secret.length < 16 || saving} onClick={validate}><ShieldCheck className="h-4 w-4" />{validation ? 'Validasi ulang' : 'Validasi token'}</Button>{validation && validatedSecret === secret && <Badge tone="green"><Check className="h-3 w-3" />Valid · {validation.maskedToken}</Badge>}</div>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}
      {validation && <div className="rounded-2xl border border-slate-200 dark:border-slate-700"><div className="border-b border-slate-100 p-4 dark:border-slate-800"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900 dark:text-white">Pilih VPS untuk grup</h3><p className="mt-1 text-xs text-slate-400">{selected.length}/2 dipilih · {validation.servers.length} ditemukan oleh API</p></div><Badge tone="blue">{validation.account.username ?? 'Akun tervalidasi'}</Badge></div><div className="relative mt-3"><Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari hasil validasi…" /></div></div>
        <div className="scrollbar-thin max-h-72 overflow-y-auto p-2">{filteredServers.length ? filteredServers.map((server) => <button type="button" key={server.uuid} onClick={() => toggleServer(server.uuid)} className={cx('mb-1 flex w-full items-center gap-3 rounded-xl border p-3 text-left', selected.includes(server.uuid) ? 'border-teal-400 bg-teal-50/70 dark:border-teal-500/40 dark:bg-teal-500/10' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50')}><span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border', selected.includes(server.uuid) ? 'border-teal-500 bg-teal-500 text-white' : 'border-slate-300 dark:border-slate-600')}>{selected.includes(server.uuid) && <Check className="h-3.5 w-3.5" />}</span><Server className="h-4 w-4 shrink-0 text-slate-400" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-200">{server.title}</span><span className="mt-0.5 block truncate text-[11px] text-slate-400">{server.uuid} · {server.zone} · {server.coreNumber} vCPU · {formatMemory(server.memoryMib)}</span></span><StatusBadge status={server.state} /></button>) : <p className="p-6 text-center text-xs text-slate-400">Tidak ada server yang cocok dengan pencarian.</p>}</div>
      </div>}
      <p className="text-[11px] leading-5 text-slate-400">Dua VPS hanya batas tampilan grup CerdasNet. Semua server yang ditemukan tetap masuk dashboard global dan hak akses token di sisi UpCloud tidak dibatasi oleh pilihan ini.</p>
    </form>
  </Modal>;
}

export function SelectionModal({ token, onClose }: { token: Token; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [selected, setSelected] = useState(token.selectedServers.filter((server) => server.active).map((server) => server.uuid));
  const [saving, setSaving] = useState(false);
  const servers = useQuery({ queryKey: ['token-servers', token.id], queryFn: () => api.get<Discovered[]>(`/api/tokens/${token.id}/servers`) });
  const toggle = (uuid: string) => {
    if (selected.includes(uuid)) setSelected(selected.filter((item) => item !== uuid));
    else if (selected.length < 2) setSelected([...selected, uuid]);
    else push('warning', 'Maksimal dua VPS per grup');
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/tokens/${token.id}/selection`, { selectedServerUuids: selected });
      await queryClient.invalidateQueries({ queryKey: ['tokens'] });
      push('success', 'Pilihan grup diperbarui'); onClose();
    } catch (error) { push('error', 'Pilihan tidak dapat disimpan', error instanceof Error ? error.message : undefined); }
    finally { setSaving(false); }
  };
  return <Modal title={`Pilihan VPS · ${token.name}`} description="Pilih maksimal dua dari seluruh server aktif yang ditemukan token ini." onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button loading={saving} disabled={servers.isLoading || Boolean(servers.error)} onClick={save}>Simpan pilihan ({selected.length}/2)</Button></>}>
    {servers.isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div> : servers.error ? <p className="text-sm text-rose-500">{servers.error.message}</p> : <div className="space-y-2">{servers.data?.map((server) => <button key={server.uuid} onClick={() => toggle(server.uuid)} className={cx('flex w-full items-center gap-3 rounded-xl border p-3 text-left', selected.includes(server.uuid) ? 'border-teal-400 bg-teal-50 dark:border-teal-500/40 dark:bg-teal-500/10' : 'border-slate-200 dark:border-slate-700')}><span className="flex-1"><span className="block text-sm font-medium">{server.title}</span><span className="text-xs text-slate-400">{server.zone} · {server.coreNumber} vCPU</span></span>{selected.includes(server.uuid) && <Check className="h-4 w-4 text-teal-500" />}</button>)}</div>}
  </Modal>;
}
