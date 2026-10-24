import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, ChevronLeft, ChevronRight, Copy, Inbox, Loader2, RefreshCw, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx, stateLabels } from '../utils';
import { useToast } from '../context/ToastContext';

export function Button({ className, variant = 'primary', size = 'md', loading, children, disabled, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'icon'; loading?: boolean;
}) {
  const variants = {
    primary: 'bg-teal-600 text-white shadow-sm shadow-teal-600/20 hover:bg-teal-700 dark:bg-teal-500 dark:text-teal-950 dark:hover:bg-teal-400',
    secondary: 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
    outline: 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
    danger: 'bg-rose-600 text-white shadow-sm shadow-rose-600/20 hover:bg-rose-700',
  };
  const sizes = { sm: 'min-h-8 px-3 py-1.5 text-xs rounded-lg', md: 'min-h-10 px-4 py-2.5 text-sm rounded-xl', icon: 'h-9 w-9 rounded-xl' };
  return <button type={type} disabled={disabled || loading} className={cx('inline-flex shrink-0 items-center justify-center gap-2 font-semibold disabled:cursor-not-allowed disabled:opacity-45', variants[variant], sizes[size], className)} {...props}>
    {loading && <Loader2 className="h-4 w-4 animate-spin" />}{children}
  </button>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgb(15_23_42_/_0.02)] dark:border-slate-800 dark:bg-slate-900', className)}>{children}</section>;
}

export function Badge({ children, tone = 'slate', className }: { children: ReactNode; tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'violet'; className?: string }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    red: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    blue: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
    violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400',
  };
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

export function StatusBadge({ status, pulse = false }: { status: string; pulse?: boolean }) {
  const tone = ['started', 'ok', 'valid', 'online', 'succeeded', 'success'].includes(status) ? 'green'
    : ['error', 'failed', 'invalid', 'expired', 'offline', 'failure', 'not_found'].includes(status) ? 'red'
      : ['maintenance', 'degraded', 'queued', 'verifying', 'verification_timeout', 'accepted'].includes(status) ? 'amber'
        : ['running', 'info'].includes(status) ? 'blue' : 'slate';
  return <Badge tone={tone}>{(pulse || status === 'started' || status === 'online') && <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />}{stateLabels[status] ?? status}</Badge>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">{eyebrow && <p className="mb-1.5 text-xs font-bold tracking-[0.16em] text-teal-600 uppercase dark:text-teal-400">{eyebrow}</p>}
      <h1 className="text-balance text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white sm:text-[28px]">{title}</h1>
      {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>}</div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}

export function Field({ label, hint, error, required, children }: { label: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return <label className="block">
    <span className="mb-2 block text-xs font-semibold text-slate-700 dark:text-slate-300">{label}{required && <span className="ml-1 text-rose-500">*</span>}</span>
    <div className="field-control">{children}</div>
    {error ? <span className="mt-1.5 block text-xs text-rose-600 dark:text-rose-400">{error}</span> : hint && <span className="mt-1.5 block text-xs leading-5 text-slate-400 dark:text-slate-500">{hint}</span>}
  </label>;
}

export const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 hover:border-slate-300 focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-600 dark:hover:border-slate-600';

export function Modal({ title, description, children, footer, onClose, wide = false }: { title: string; description?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', handler); };
  }, [onClose]);
  return createPortal(<div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-5" role="presentation">
    <button className="absolute inset-0 cursor-default bg-slate-950/50 backdrop-blur-sm" onClick={onClose} aria-label="Tutup dialog" />
    <div role="dialog" aria-modal="true" aria-labelledby="modal-title" className={cx('relative flex max-h-[92vh] w-full flex-col rounded-t-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-3xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 dark:border-slate-800 sm:px-6">
        <div><h2 id="modal-title" className="text-lg font-bold text-slate-950 dark:text-white">{title}</h2>{description && <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">{description}</p>}</div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Tutup"><X className="h-5 w-5" /></Button>
      </div>
      <div className="scrollbar-thin overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-3xl border-t border-slate-100 bg-slate-50/70 px-5 py-4 dark:border-slate-800 dark:bg-slate-950/40 sm:px-6">{footer}</div>}
    </div>
  </div>, document.body);
}

export function Skeleton({ className }: { className?: string }) { return <div className={cx('skeleton rounded-xl bg-slate-200/70 dark:bg-slate-800', className)} />; }
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="space-y-3 p-5">{Array.from({ length: rows }, (_, index) => <div key={index} className="flex items-center gap-4"><Skeleton className="h-10 w-10" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-1/5" /></div><Skeleton className="h-7 w-20" /></div>)}</div>;
}
export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title: string; description: string; action?: ReactNode; icon?: LucideIcon }) {
  return <div className="flex flex-col items-center px-6 py-12 text-center"><div className="mb-4 rounded-2xl bg-slate-100 p-3.5 text-slate-400 dark:bg-slate-800 dark:text-slate-500"><Icon className="h-7 w-7" /></div><h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3><p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>{action && <div className="mt-5">{action}</div>}</div>;
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Data tidak dapat dimuat.';
  return <div className="m-5 flex flex-col items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 sm:flex-row sm:items-center"><AlertCircle className="h-5 w-5 shrink-0" /><div className="flex-1 text-sm"><strong className="block">Data tidak dapat dimuat</strong><span className="mt-1 block text-xs opacity-80">{message}</span></div>{retry && <Button variant="outline" size="sm" onClick={retry}><RefreshCw className="h-3.5 w-3.5" />Coba lagi</Button>}</div>;
}
export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  return <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
    <span className="text-xs text-slate-500 dark:text-slate-400">{total.toLocaleString('id-ID')} hasil · Halaman {page} dari {pages}</span>
    <div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" />Sebelumnya</Button><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Berikutnya<ChevronRight className="h-4 w-4" /></Button></div>
  </div>;
}
export function CopyButton({ value, label = 'Salin' }: { value: string; label?: string }) {
  const { push } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { push('error', 'Tidak dapat menyalin', 'Browser memerlukan izin clipboard atau konteks HTTPS.'); }
  };
  return <button onClick={copy} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-teal-600 dark:hover:bg-slate-800" title={label} aria-label={label}>{copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}<span className="sr-only sm:not-sr-only">{copied ? 'Tersalin' : label}</span></button>;
}
export function Tabs<T extends string>({ items, value, onChange }: { items: Array<{ id: T; label: string; icon?: LucideIcon }>; value: T; onChange: (value: T) => void }) {
  return <div className="scrollbar-thin mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">{items.map((item) => <button key={item.id} role="tab" aria-selected={value === item.id} onClick={() => onChange(item.id)} className={cx('flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 text-sm font-medium', value === item.id ? 'border-teal-500 text-teal-700 dark:text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200')}>{item.icon && <item.icon className="h-4 w-4" />}{item.label}</button>)}</div>;
}
