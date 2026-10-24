import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cx } from '../utils';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
type Toast = { id: number; kind: ToastKind; title: string; message?: string };
const ToastContext = createContext<{ push: (kind: ToastKind, title: string, message?: string) => void } | null>(null);
const icons = { success: CheckCircle2, error: AlertCircle, info: Info, warning: TriangleAlert };
const colors = { success: 'text-emerald-500', error: 'text-rose-500', info: 'text-sky-500', warning: 'text-amber-500' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setToasts((items) => items.filter((item) => item.id !== id)), []);
  const push = useCallback((kind: ToastKind, title: string, message?: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((items) => [...items.slice(-3), { id, kind, title, message }]);
    window.setTimeout(() => remove(id), kind === 'error' ? 8000 : 5000);
  }, [remove]);
  const value = useMemo(() => ({ push }), [push]);
  return <ToastContext.Provider value={value}>
    {children}
    <div className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex flex-col items-end gap-3 sm:left-auto sm:w-[390px]" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => {
        const Icon = icons[toast.kind];
        return <div key={toast.id} className="pointer-events-auto flex w-full items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95">
          <Icon className={cx('mt-0.5 h-5 w-5 shrink-0', colors[toast.kind])} />
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900 dark:text-white">{toast.title}</p>{toast.message && <p className="mt-1 break-words text-xs leading-5 text-slate-500 dark:text-slate-400">{toast.message}</p>}</div>
          <button onClick={() => remove(toast.id)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Tutup notifikasi"><X className="h-4 w-4" /></button>
        </div>;
      })}
    </div>
  </ToastContext.Provider>;
}
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
