import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Save } from 'lucide-react';
import { api } from '../api';
import type { ServerDetail } from '../types';
import { useToast } from '../context/ToastContext';
import { Button, Field, inputClass, Modal } from './ui';

export default function ServerIdentityEditor({ server }: { server: ServerDetail }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(server.title);
  const [hostname, setHostname] = useState(server.hostname ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const { push } = useToast();
  const show = () => { setTitle(server.title); setHostname(server.hostname ?? ''); setError(''); setOpen(true); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const updated = await api.patch<ServerDetail>(`/api/servers/${server.uuid}/identity`, { title: title.trim(), hostname: hostname.trim() });
      queryClient.setQueryData(['server', server.uuid], updated);
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      push('success', 'Identitas VPS diperbarui', 'Title dan hostname telah dikonfirmasi oleh respons UpCloud.');
      setOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Perubahan gagal.'); }
    finally { setSaving(false); }
  };
  return <>
    <Button variant="outline" size="sm" onClick={show}><Pencil className="h-3.5 w-3.5" />Ubah nama</Button>
    {open && <Modal title="Ubah server name & hostname" description="Perubahan dikirim langsung ke UpCloud dan tidak dianggap berhasil sebelum API merespons." onClose={() => !saving && setOpen(false)} footer={<><Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Batal</Button><Button loading={saving} disabled={!title.trim() || !hostname.trim()} onClick={() => void submit({ preventDefault: () => undefined } as FormEvent)}><Save className="h-4 w-4" />Simpan ke UpCloud</Button></>}>
      <form onSubmit={submit} className="space-y-4"><Field label="Server name / title" required><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} minLength={1} maxLength={255} required /></Field><Field label="Hostname" hint="Gunakan lowercase, huruf/angka, dash, dan titik; maksimal 253 karakter." required><input className={inputClass} value={hostname} onChange={(event) => setHostname(event.target.value)} maxLength={253} autoCapitalize="none" autoCorrect="off" spellCheck={false} required /></Field>{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}<button type="submit" className="hidden" /></form>
    </Modal>}
  </>;
}
