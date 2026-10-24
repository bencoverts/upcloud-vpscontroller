import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Clock3, KeyRound, Mail, Plus, Server, ShieldCheck, UserCog, Users } from 'lucide-react';
import { api } from '../api';
import type { ClientUser, Server as ServerType } from '../types';
import { formatDate, relativeTime } from '../utils';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Field, inputClass, Modal, PageHeader, Skeleton } from '../components/ui';

type ServerOption = Pick<ServerType, 'uuid' | 'title' | 'hostname' | 'state'> & { zone: string | null };
const validPassword = (value: string) => value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [creating, setCreating] = useState(false);
  const [accessClient, setAccessClient] = useState<ClientUser | null>(null);
  const [emailClient, setEmailClient] = useState<ClientUser | null>(null);
  const [passwordClient, setPasswordClient] = useState<ClientUser | null>(null);
  const [disableClient, setDisableClient] = useState<ClientUser | null>(null);
  const clients = useQuery({ queryKey: ['users'], queryFn: () => api.get<ClientUser[]>('/api/users') });
  const options = useQuery({ queryKey: ['users', 'server-options'], queryFn: () => api.get<ServerOption[]>('/api/users/options/servers') });
  const invalidate = async () => { await queryClient.invalidateQueries({ queryKey: ['users'] }); };
  const toggle = useMutation({
    mutationFn: (client: ClientUser) => api.patch<ClientUser>(`/api/users/${client.id}`, { disabled: !client.disabled }),
    onSuccess: async (client) => { await invalidate(); setDisableClient(null); push('success', client.disabled ? 'Client dinonaktifkan' : 'Client diaktifkan', client.username); },
    onError: (error) => push('error', 'Status client tidak berubah', error.message),
  });
  return <>
    <PageHeader eyebrow="Role-based access" title="Client Users" description="Admin dan client memakai halaman login yang sama. Tentukan VPS yang dapat dikontrol serta masa berlaku aksesnya." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Tambah client</Button>} />
    <div className="mb-5 flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-xs leading-5 text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>Expired hanya mencabut akses panel dan kontrol client. VPS tidak dimatikan. Token UpCloud, grup token, backup, dan data client lain tidak pernah diekspos.</p></div>
    {clients.isLoading ? <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
      : clients.error ? <Card><ErrorState error={clients.error} retry={() => void clients.refetch()} /></Card>
        : clients.data?.length === 0 ? <Card><EmptyState icon={Users} title="Belum ada client" description="Buat akun client dengan password unik, lalu pilih VPS yang boleh dikontrol." action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Tambah client</Button>} /></Card>
          : <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">{clients.data?.map((client) => <Card key={client.id} className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400"><UserCog className="h-5 w-5" /></div><div className="min-w-0"><h2 className="truncate text-sm font-bold">{client.username}</h2><p className="mt-1 truncate text-[11px] text-slate-400">{client.email ?? 'Email belum diatur'} · Dibuat {formatDate(client.createdAt)}</p></div></div><Badge tone={client.disabled ? 'red' : 'green'}>{client.disabled ? 'Nonaktif' : 'Aktif'}</Badge></div>
            <div className="p-5"><div className="mb-3 flex items-center justify-between text-xs"><span className="font-semibold">Akses VPS</span><span className="text-slate-400">{client.access.length} assignment</span></div>
              {client.access.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-400 dark:bg-slate-950/50">Belum ada VPS yang dapat diakses.</p> : <div className="space-y-2">{client.access.map((access) => <div key={access.serverUuid} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800"><div className="flex items-start justify-between gap-2"><span className="min-w-0 truncate text-xs font-semibold">{access.title}</span><Badge tone={access.expired ? 'red' : access.expiresAt ? 'amber' : 'green'}>{access.expired ? 'Expired' : access.expiresAt ? 'Berbatas' : 'Tanpa expiry'}</Badge></div><p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400"><Clock3 className="h-3 w-3" />{access.expiresAt ? `${formatDate(access.expiresAt)} · ${relativeTime(access.expiresAt)}` : 'Akses tidak terbatas'}</p></div>)}</div>}
            </div><div className="flex flex-wrap gap-2 border-t border-slate-100 p-4 dark:border-slate-800"><Button size="sm" variant="outline" onClick={() => setAccessClient(client)}><Server className="h-3.5 w-3.5" />Atur VPS</Button><Button size="sm" variant="outline" onClick={() => setEmailClient(client)}><Mail className="h-3.5 w-3.5" />Email / Google</Button><Button size="sm" variant="outline" onClick={() => setPasswordClient(client)}><KeyRound className="h-3.5 w-3.5" />Reset password</Button><Button size="sm" variant={client.disabled ? 'primary' : 'danger'} loading={toggle.isPending && toggle.variables?.id === client.id} onClick={() => client.disabled ? toggle.mutate(client) : setDisableClient(client)}>{client.disabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}{client.disabled ? 'Aktifkan' : 'Nonaktifkan'}</Button></div>
          </Card>)}</div>}
    {creating && <ClientForm onClose={() => setCreating(false)} onSaved={invalidate} />}
    {accessClient && <AccessEditor client={accessClient} servers={options.data ?? []} loading={options.isLoading} onClose={() => setAccessClient(null)} onSaved={async () => { await invalidate(); setAccessClient(null); }} />}
    {emailClient && <EmailEditor client={emailClient} onClose={() => setEmailClient(null)} onSaved={invalidate} />}
    {passwordClient && <PasswordReset client={passwordClient} onClose={() => setPasswordClient(null)} onSaved={invalidate} />}
    {disableClient && <Modal title={`Nonaktifkan ${disableClient.username}?`} description="Semua sesi client akan dicabut dan login berikutnya ditolak." onClose={() => !toggle.isPending && setDisableClient(null)} footer={<><Button variant="outline" disabled={toggle.isPending} onClick={() => setDisableClient(null)}>Batal</Button><Button variant="danger" loading={toggle.isPending} onClick={() => toggle.mutate(disableClient)}>Ya, nonaktifkan client</Button></>}><p className="text-sm leading-6 text-slate-500">Assignment dan histori tetap tersimpan. Tindakan ini tidak mematikan, menghentikan, atau mengubah VPS.</p></Modal>}
  </>;
}

function ClientForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [username, setUsername] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('');
  const { push } = useToast();
  const save = useMutation({
    mutationFn: () => api.post<ClientUser>('/api/users', { username, password, email: email.trim() || null }),
    onSuccess: async (client) => { await onSaved(); push('success', 'Client dibuat', `${client.username} dapat login melalui halaman yang sama.`); onClose(); },
    onError: (reason) => setError(reason.message),
  });
  const submit = (event: FormEvent) => { event.preventDefault(); setError(''); if (!validPassword(password)) return setError('Password minimal 12 karakter dan memuat huruf besar, huruf kecil, serta angka.'); save.mutate(); };
  return <Modal title="Tambah client" description="Tidak ada role yang dipilih saat login; role ditentukan dari akun." onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate()} disabled={!username.trim() || !validPassword(password)}>Buat client</Button></>}>
    <form id="create-client" onSubmit={submit} className="space-y-4"><Field label="Username" required><input className={inputClass} value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={64} pattern="[a-zA-Z0-9._-]+" autoComplete="off" required /></Field><Field label="Email untuk Google Auth (opsional)"><input type="email" className={inputClass} value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} autoComplete="off" placeholder="client@example.com" /></Field><Field label="Password awal" hint="Minimal 12 karakter, huruf besar, huruf kecil, dan angka. Bagikan melalui kanal aman." required><input type="password" className={inputClass} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></Field>{error && <p role="alert" className="text-xs text-rose-500">{error}</p>}<button type="submit" className="hidden" /></form>
  </Modal>;
}

function EmailEditor({ client, onClose, onSaved }: { client: ClientUser; onClose: () => void; onSaved: () => Promise<void> }) {
  const [email, setEmail] = useState(client.email ?? ''); const { push } = useToast();
  const save = useMutation({
    mutationFn: () => api.patch(`/api/users/${client.id}`, { email: email.trim() || null }),
    onSuccess: async () => { await onSaved(); push('success', 'Email client disimpan', 'Google harus memverifikasi email ini sebelum dapat digunakan login.'); onClose(); },
    onError: (error) => push('error', 'Email tidak dapat disimpan', error.message),
  });
  return <Modal title={`Email & Google Auth · ${client.username}`} description="Email harus unik. Google login hanya berhasil setelah provider menyatakan email_verified=true." onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Simpan email</Button></>}><Field label="Email client" hint="Kosongkan untuk menonaktifkan pencocokan akun Google berdasarkan email. Identity yang sudah terhubung tetap mengikuti subject Google."><input type="email" autoFocus className={inputClass} value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} placeholder="client@example.com" /></Field></Modal>;
}

function PasswordReset({ client, onClose, onSaved }: { client: ClientUser; onClose: () => void; onSaved: () => Promise<void> }) {
  const [password, setPassword] = useState(''); const { push } = useToast();
  const save = useMutation({
    mutationFn: () => api.patch(`/api/users/${client.id}`, { password }),
    onSuccess: async () => { await onSaved(); push('success', 'Password client direset', 'Semua sesi client telah dicabut.'); onClose(); },
    onError: (error) => push('error', 'Reset password gagal', error.message),
  });
  return <Modal title={`Reset password ${client.username}`} description="Semua sesi client akan dicabut setelah password berhasil diganti." onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button loading={save.isPending} disabled={!validPassword(password)} onClick={() => save.mutate()}>Reset password</Button></>}><Field label="Password baru" hint="Minimal 12 karakter dengan huruf besar, huruf kecil, dan angka." required><input type="password" className={inputClass} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" autoFocus /></Field></Modal>;
}

function AccessEditor({ client, servers, loading, onClose, onSaved }: { client: ClientUser; servers: ServerOption[]; loading: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const toLocal = (value: string | null) => {
    if (!value) return '';
    const date = new Date(value); date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  };
  const [selected, setSelected] = useState<Record<string, string>>(() => Object.fromEntries(client.access.map((item) => [item.serverUuid, toLocal(item.expiresAt)])));
  const { push } = useToast();
  const save = useMutation({
    mutationFn: () => api.put<ClientUser>(`/api/users/${client.id}/access`, { access: Object.entries(selected).map(([serverUuid, expiry]) => ({ serverUuid, expiresAt: expiry ? new Date(expiry).toISOString() : null })) }),
    onSuccess: async () => { await onSaved(); push('success', 'Akses client diperbarui', `${client.username} menerima perubahan melalui WebSocket.`); },
    onError: (error) => push('error', 'Akses tidak berubah', error.message),
  });
  return <Modal wide title={`Akses VPS · ${client.username}`} description="Centang VPS yang dapat dikontrol. Kosongkan tanggal untuk akses tanpa expiry." onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Simpan akses</Button></>}>
    {loading ? <Skeleton className="h-64" /> : servers.length === 0 ? <EmptyState icon={Server} title="Belum ada VPS" description="Tambahkan token dan sinkronisasi server terlebih dahulu." /> : <div className="grid gap-3 lg:grid-cols-2">{servers.map((server) => {
      const checked = Object.hasOwn(selected, server.uuid);
      return <div key={server.uuid} className={`rounded-2xl border p-4 ${checked ? 'border-teal-300 bg-teal-50/50 dark:border-teal-500/30 dark:bg-teal-500/5' : 'border-slate-200 dark:border-slate-800'}`}><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-teal-600" checked={checked} onChange={() => setSelected((current) => { const next = { ...current }; if (checked) delete next[server.uuid]; else next[server.uuid] = ''; return next; })} /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{server.title}</span><span className="mt-1 block break-all text-[10px] text-slate-400">{server.uuid} · {server.zone}</span></span></label>{checked && <div className="mt-3"><label className="text-[11px] font-medium text-slate-500">Expired akses (opsional)</label><input type="datetime-local" className={`${inputClass} mt-1.5`} value={selected[server.uuid] ?? ''} onChange={(event) => setSelected((current) => ({ ...current, [server.uuid]: event.target.value }))} /><p className="mt-1 text-[10px] text-slate-400">Ditafsirkan sebagai waktu lokal browser lalu disimpan dalam UTC.</p></div>}</div>;
    })}</div>}
  </Modal>;
}
