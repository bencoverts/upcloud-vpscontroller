import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeySquare, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatDate } from '../utils';
import { Badge, Button, Card, CopyButton, EmptyState, ErrorState, Field, inputClass, Modal, PageHeader, Skeleton } from '../components/ui';

type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; expiresAt: string | null; lastUsedAt: string | null; revoked: boolean; createdAt: string };
export default function ApiKeysPage() {
  const { user } = useAuth(); const queryClient = useQueryClient(); const { push } = useToast();
  const [createOpen, setCreateOpen] = useState(false); const [name, setName] = useState(''); const [scopes, setScopes] = useState<string[]>(['read']); const [expiresAt, setExpiresAt] = useState('');
  const [secret, setSecret] = useState<{ key: string; name: string } | null>(null); const [submitting, setSubmitting] = useState(false); const [revoke, setRevoke] = useState<ApiKey | null>(null); const [confirmation, setConfirmation] = useState('');
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<{ items: ApiKey[]; availableScopes: string[] }>('/api/api-keys') });
  const available = (keys.data?.availableScopes ?? []).filter((scope) => user?.role === 'admin' || scope !== 'admin');
  const create = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true);
    try {
      const result = await api.post<{ key: string; record: ApiKey }>('/api/api-keys', { name, scopes, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null });
      setSecret({ key: result.key, name }); setCreateOpen(false); setName(''); setScopes(['read']); setExpiresAt('');
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    } catch (error) { push('error', 'API key tidak dapat dibuat', error instanceof Error ? error.message : undefined); }
    finally { setSubmitting(false); }
  };
  const remove = async () => {
    if (!revoke) return; setSubmitting(true);
    try { await api.delete(`/api/api-keys/${revoke.id}`); push('success', 'API key dicabut', 'Request berikutnya dengan key tersebut akan ditolak.'); setRevoke(null); await queryClient.invalidateQueries({ queryKey: ['api-keys'] }); }
    catch (error) { push('error', 'API key tidak dapat dicabut', error instanceof Error ? error.message : undefined); }
    finally { setSubmitting(false); }
  };
  return <>
    <PageHeader eyebrow="Secure automation" title="Panel API Keys" description="Buat kredensial terpisah untuk automation dengan scope dan masa berlaku minimum yang diperlukan." actions={<><Link to="/docs"><Button variant="outline" size="sm">Dokumentasi API</Button></Link><Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />Buat API key</Button></>} />
    <div className="mb-5 flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-xs leading-5 text-sky-800 dark:border-sky-500/15 dark:bg-sky-500/5 dark:text-sky-300"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>Gunakan header <code>Authorization: Bearer cnp_…</code> pada API panel. API key tidak memerlukan CSRF header, tetapi scope tetap diperiksa pada setiap request. Jangan gunakan API key di browser atau frontend publik.</p></div>
    <Card className="overflow-hidden">{keys.isLoading ? <div className="p-5"><Skeleton className="h-64" /></div> : keys.error ? <ErrorState error={keys.error} retry={() => void keys.refetch()} /> : keys.data?.items.length === 0 ? <EmptyState icon={KeySquare} title="Belum ada API key" description="Buat key khusus automation. Secret hanya ditampilkan sekali setelah dibuat." /> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{keys.data?.items.map((key) => <div key={key.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-bold">{key.name}</h2><Badge tone={key.revoked ? 'red' : key.expiresAt && new Date(key.expiresAt) < new Date() ? 'amber' : 'green'}>{key.revoked ? 'Revoked' : key.expiresAt && new Date(key.expiresAt) < new Date() ? 'Expired' : 'Active'}</Badge></div><code className="mt-2 block text-xs text-slate-400">{key.prefix}</code><div className="mt-2 flex flex-wrap gap-1.5">{key.scopes.map((scope) => <Badge key={scope} tone="blue">{scope}</Badge>)}</div></div><div className="text-xs text-slate-400 sm:text-right"><p>Dibuat {formatDate(key.createdAt)}</p><p className="mt-1">Terakhir digunakan {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Belum pernah'}</p><p className="mt-1">Kedaluwarsa {key.expiresAt ? formatDate(key.expiresAt) : 'Tidak ada'}</p></div>{!key.revoked && <Button variant="ghost" size="icon" className="text-rose-500" aria-label={`Cabut ${key.name}`} onClick={() => { setConfirmation(''); setRevoke(key); }}><Trash2 className="h-4 w-4" /></Button>}</div>)}</div>}</Card>
    {createOpen && <Modal title="Buat scoped API key" description="Secret dibuat di backend dan hanya hash-nya yang disimpan." onClose={() => !submitting && setCreateOpen(false)}><form onSubmit={create} className="space-y-5"><Field label="Nama key" required><input autoFocus className={inputClass} value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={80} required placeholder="billing-production" /></Field><Field label="Scopes" hint="read: baca data; servers:write: kontrol VPS; servers:deploy: provisioning; admin: administrasi (admin only)." required><div className="grid gap-2 sm:grid-cols-2">{available.map((scope) => <label key={scope} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700"><input type="checkbox" checked={scopes.includes(scope)} onChange={(event) => setScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))} /><code>{scope}</code></label>)}</div></Field><Field label="Kedaluwarsa (opsional)"><input type="datetime-local" className={inputClass} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></Field><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button><Button type="submit" loading={submitting} disabled={name.trim().length < 3 || scopes.length === 0}><KeySquare className="h-4 w-4" />Buat secret</Button></div></form></Modal>}
    {secret && <Modal title="Simpan API key sekarang" description="Untuk keamanan, secret lengkap tidak dapat ditampilkan lagi setelah dialog ini ditutup." onClose={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>Saya sudah menyimpannya</Button>}><div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-500/20 dark:bg-teal-500/10"><p className="text-xs font-semibold">{secret.name}</p><code className="mt-3 block break-all rounded-xl bg-white p-3 text-xs dark:bg-slate-950">{secret.key}</code><div className="mt-2 flex justify-end"><CopyButton value={secret.key} label="Salin API key" /></div></div><p className="mt-4 text-xs leading-5 text-amber-600">Jangan masukkan secret ke source code, URL, log, gambar, atau localStorage. Simpan di secret manager automation Anda.</p></Modal>}
    {revoke && <Modal title={`Cabut ${revoke.name}?`} description="Pencabutan berlaku pada request berikutnya dan tidak dapat diurungkan." onClose={() => !submitting && setRevoke(null)} footer={<><Button variant="outline" onClick={() => setRevoke(null)}>Batal</Button><Button variant="danger" loading={submitting} disabled={confirmation !== revoke.name} onClick={() => void remove()}>Cabut key</Button></>}><Field label={`Ketik nama “${revoke.name}” untuk konfirmasi`}><input autoFocus className={inputClass} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field></Modal>}
  </>;
}
