import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, Mail, Palette, Save, Send, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import type { Branding } from '../context/BrandingContext';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, Field, inputClass } from './ui';

const LOGO_MAX_BYTES = 3 * 1024 * 1024;
const FAVICON_MAX_BYTES = 512 * 1024;
const accents: Array<{ id: Branding['accent']; color: string }> = [{ id: 'teal', color: '#14b8a6' }, { id: 'blue', color: '#3b82f6' }, { id: 'violet', color: '#8b5cf6' }, { id: 'rose', color: '#f43f5e' }, { id: 'amber', color: '#f59e0b' }];
export default function BrandingSettings() {
  const { user } = useAuth(); const branding = useBranding();
  if (user?.role !== 'admin') return null;
  return <BrandingEditor key={JSON.stringify(branding)} branding={branding} />;
}
function BrandingEditor({ branding }: { branding: Branding }) {
  const queryClient = useQueryClient(); const { push } = useToast();
  const [form, setForm] = useState({ siteName: branding.siteName, siteTagline: branding.siteTagline, accent: branding.accent, defaultTheme: branding.defaultTheme });
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState('');
  const updated = async (result: Branding) => { queryClient.setQueryData(['branding'], result); setForm({ siteName: result.siteName, siteTagline: result.siteTagline, accent: result.accent, defaultTheme: result.defaultTheme }); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try { const result = await api.patch<Branding>('/api/branding', form); await updated(result); push('success', 'Branding disimpan', 'Nama, tema, dan aksen baru langsung diterapkan.'); }
    catch (error) { push('error', 'Branding tidak dapat disimpan', error instanceof Error ? error.message : undefined); }
    finally { setSaving(false); }
  };
  const upload = (kind: 'logo' | 'favicon', file?: File) => {
    if (!file) return;
    const maxBytes = kind === 'logo' ? LOGO_MAX_BYTES : FAVICON_MAX_BYTES;
    const maxLabel = kind === 'logo' ? '3 MB' : '512 KiB';
    if (file.size > maxBytes) { push('error', 'Gambar terlalu besar', `Ukuran maksimum ${maxLabel}.`); return; }
    setUploading(kind); const reader = new FileReader();
    reader.onload = async () => {
      try { const result = await api.put<Branding>(`/api/branding/assets/${kind}`, { dataUrl: reader.result }); await updated(result); push('success', `${kind === 'logo' ? 'Logo' : 'Favicon'} diperbarui`, 'MIME dan signature file telah divalidasi backend.'); }
      catch (error) { push('error', 'Upload gambar gagal', error instanceof Error ? error.message : undefined); }
      finally { setUploading(''); }
    };
    reader.onerror = () => { setUploading(''); push('error', 'File tidak dapat dibaca'); }; reader.readAsDataURL(file);
  };
  const remove = async (kind: 'logo' | 'favicon') => {
    setUploading(kind); try { const result = await api.delete<Branding>(`/api/branding/assets/${kind}`); await updated(result); push('success', 'Asset branding dihapus'); }
    catch (error) { push('error', 'Asset tidak dapat dihapus', error instanceof Error ? error.message : undefined); }
    finally { setUploading(''); }
  };
  return <Card className="overflow-hidden"><div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6"><Palette className="h-5 w-5 text-teal-500" /><div><h2 className="text-sm font-bold">Website & branding</h2><p className="mt-1 text-xs text-slate-400">Kustomisasi global untuk layar login, dashboard, dan mobile.</p></div></div><form onSubmit={save} className="space-y-5 p-5 sm:p-6"><div className="grid gap-4 sm:grid-cols-2"><Field label="Nama website" required><input className={inputClass} value={form.siteName} onChange={(event) => setForm({ ...form, siteName: event.target.value })} maxLength={80} required /></Field><Field label="Tagline / title" required><input className={inputClass} value={form.siteTagline} onChange={(event) => setForm({ ...form, siteTagline: event.target.value })} maxLength={120} required /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Warna aksen"><div className="flex gap-2">{accents.map((accent) => {
  const selected = form.accent === accent.id;
  return <button key={accent.id} type="button" aria-label={`Gunakan aksen ${accent.id}`} onClick={() => setForm({ ...form, accent: accent.id })} className={selected ? 'h-9 w-9 rounded-xl border-2 border-slate-800 ring-2 ring-slate-300 dark:border-white' : 'h-9 w-9 rounded-xl border-2 border-transparent'} style={{ backgroundColor: accent.color }} />;
})}</div></Field><Field label="Tema default"><select className={inputClass} value={form.defaultTheme} onChange={(event) => setForm({ ...form, defaultTheme: event.target.value as Branding['defaultTheme'] })}><option value="system">Ikuti sistem</option><option value="light">Light</option><option value="dark">Dark</option></select></Field></div><Button type="submit" loading={saving}><Save className="h-4 w-4" />Simpan branding</Button></form><div className="grid gap-4 border-t border-slate-100 p-5 dark:border-slate-800 sm:grid-cols-2 sm:px-6">{(['logo', 'favicon'] as const).map((kind) => <div key={kind} className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">{branding[`${kind}Url`] ? <img src={branding[`${kind}Url`]!} alt={`${kind} saat ini`} className="h-full w-full object-contain" /> : <Image className="h-5 w-5 text-slate-400" />}</div><div><h3 className="text-sm font-semibold capitalize">{kind}</h3><p className="text-[10px] text-slate-400">Maks. {kind === 'logo' ? '3 MB' : '512 KiB'} · {kind === 'logo' ? 'PNG/JPEG/WebP' : 'PNG/ICO'}</p></div></div><div className="mt-3 flex gap-2"><label className="inline-flex min-h-8 cursor-pointer items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold dark:border-slate-700">{uploading === kind ? 'Mengupload…' : 'Pilih gambar'}<input type="file" className="sr-only" accept={kind === 'logo' ? 'image/png,image/jpeg,image/webp' : 'image/png,image/x-icon,image/vnd.microsoft.icon,.ico'} disabled={Boolean(uploading)} onChange={(event) => { upload(kind, event.target.files?.[0]); event.target.value = ''; }} /></label>{branding[`${kind}Url`] && <Button variant="ghost" size="icon" className="text-rose-500" aria-label={`Hapus ${kind}`} disabled={Boolean(uploading)} onClick={() => void remove(kind)}><Trash2 className="h-4 w-4" /></Button>}</div></div>)}</div></Card>;
}

export function IntegrationSettings() {
  const { user } = useAuth(); const { push } = useToast(); const [recipient, setRecipient] = useState(''); const [sending, setSending] = useState(false);
  const smtp = useQuery({ queryKey: ['smtp-status'], queryFn: () => api.get<{ configured: boolean; host: string | null; from: string | null; secure: boolean }>('/api/integrations/smtp'), enabled: user?.role === 'admin', refetchInterval: 60_000 });
  const google = useQuery({ queryKey: ['google-auth-status'], queryFn: () => api.get<{ enabled: boolean }>('/api/auth/google/status') });
  if (user?.role !== 'admin') return null;
  const send = async (event: FormEvent) => {
    event.preventDefault(); setSending(true);
    try { const result = await api.post<{ messageId: string | null }>('/api/integrations/smtp/test', { recipient }); push('success', 'Email test diterima SMTP', `Server menerima message${result.messageId ? ` ${result.messageId}` : ''}. Periksa inbox/spam penerima.`); }
    catch (error) { push('error', 'SMTP test gagal', error instanceof Error ? error.message : undefined); }
    finally { setSending(false); }
  };
  return <Card className="p-5 sm:p-6"><div className="flex items-center gap-3"><Mail className="h-5 w-5 text-sky-500" /><div><h2 className="text-sm font-bold">SMTP & Google Auth</h2><p className="mt-1 text-xs text-slate-400">Secret dikonfigurasi melalui environment, bukan disimpan dalam JSON.</p></div></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950"><div className="flex items-center justify-between"><h3 className="text-xs font-bold">SMTP</h3><Badge tone={smtp.data?.configured ? 'green' : 'amber'}>{smtp.data?.configured ? 'Configured' : 'Not configured'}</Badge></div><p className="mt-2 break-all text-xs text-slate-400">{smtp.data?.host ?? 'Set SMTP_HOST dan SMTP_FROM pada backend Node.js.'}</p><p className="mt-1 break-all text-xs text-slate-400">{smtp.data?.from}</p></div><div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950"><div className="flex items-center justify-between"><h3 className="text-xs font-bold">Google OIDC</h3><Badge tone={google.data?.enabled ? 'green' : 'amber'}>{google.data?.enabled ? 'Enabled' : 'Disabled'}</Badge></div><p className="mt-2 text-xs leading-5 text-slate-400">Set GOOGLE_CLIENT_ID/SECRET dan redirect URL <code>/api/auth/google/callback</code>. Hanya email terverifikasi yang sudah terdaftar dapat masuk.</p></div></div>{smtp.data?.configured && <form onSubmit={send} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"><div className="flex-1"><Field label="Penerima email test" required><input type="email" className={inputClass} value={recipient} onChange={(event) => setRecipient(event.target.value)} required maxLength={320} placeholder="admin@example.com" /></Field></div><Button type="submit" loading={sending}><Send className="h-4 w-4" />Verifikasi & kirim test</Button></form>}</Card>;
}
