import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  Activity, Cloud, KeyRound, LayoutDashboard, LogOut, Menu, Moon, RefreshCw,
  Server, Settings, ShieldCheck, Sun, X, Zap,
} from 'lucide-react';
import { api } from '../api';
import type { SyncJob } from '../types';
import { cx } from '../utils';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { useJobs } from '../context/JobsContext';
import { useLiveStatus } from '../context/LiveContext';
import { Button, Skeleton } from './ui';

const navigation = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/servers', label: 'VPS Servers', icon: Server },
  { to: '/tokens', label: 'API Token Manager', icon: KeyRound },
  { to: '/monitoring', label: 'Monitoring', icon: Activity },
  { to: '/activity', label: 'Activity Logs', icon: Zap },
  { to: '/settings', label: 'Settings', icon: Settings },
];
const pageNames: Record<string, string> = { '/': 'Dashboard', '/servers': 'VPS Servers', '/tokens': 'API Token Manager', '/monitoring': 'Monitoring', '/activity': 'Activity Logs', '/settings': 'Settings' };

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-3"><div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-teal-400 to-emerald-600 text-white shadow-lg shadow-teal-600/20"><Cloud className="h-5 w-5" strokeWidth={2.2} /><span className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400 dark:border-slate-900" /></div>{!compact && <div><div className="text-[17px] font-extrabold tracking-[-0.035em] text-slate-950 dark:text-white">CerdasNet</div><div className="text-[9px] font-bold tracking-[0.2em] text-slate-400 uppercase dark:text-slate-500">VPS Control</div></div>}</div>;
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { push } = useToast();
  const { trackJob, activeCount } = useJobs();
  const live = useLiveStatus();
  const syncAll = useMutation({
    mutationFn: () => api.post<{ jobs: SyncJob[]; skipped: Array<{ reason: string }> }>('/api/sync/all', {}),
    onSuccess: (result) => {
      result.jobs.forEach((job) => trackJob(job, 'Sinkronisasi token'));
      if (result.jobs.length === 0) push('info', 'Tidak ada job baru', result.skipped.length ? 'Job aktif masih berjalan atau tidak ada token aktif.' : 'Tambahkan dan aktifkan API token terlebih dahulu.');
      else push('info', `${result.jobs.length} sinkronisasi dimulai`, 'Setiap token diproses terisolasi; kegagalan satu token tidak menghentikan token lain.');
    },
    onError: (error) => push('error', 'Sinkronisasi tidak dapat dimulai', error.message),
  });
  const handleLogout = async () => {
    try { await logout(); } catch (error) { push('error', 'Logout gagal', error instanceof Error ? error.message : undefined); }
  };
  const title = location.pathname.startsWith('/servers/') ? 'Detail VPS' : pageNames[location.pathname] ?? 'CerdasNet';
  const nav = <nav className="mt-8 space-y-1.5" aria-label="Navigasi utama">{navigation.map((item) => <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMobileOpen(false)} className={({ isActive }) => cx('group flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-medium', isActive ? 'bg-teal-50 text-teal-700 shadow-[inset_0_0_0_1px_rgb(20_184_166_/_0.08)] dark:bg-teal-500/10 dark:text-teal-400' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white')}>
    <item.icon className="h-[18px] w-[18px] shrink-0" />{item.label}
  </NavLink>)}</nav>;
  return <div className="min-h-screen bg-[#f5f7fb] text-slate-800 dark:bg-[#0a0f1c] dark:text-slate-200">
    <a href="#main-content" className="fixed top-2 left-2 z-[120] -translate-y-20 rounded-lg bg-teal-600 px-4 py-2 text-white focus:translate-y-0">Lewati ke konten</a>
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200/70 bg-white px-4 py-5 dark:border-slate-800/80 dark:bg-slate-950 lg:flex">
      <div className="px-2"><Brand /></div>{nav}
      <div className="mt-auto rounded-2xl border border-slate-100 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300"><ShieldCheck className="h-4 w-4 text-teal-500" />Kredensial terlindungi</div>
        <p className="mt-2 text-[11px] leading-5 text-slate-400 dark:text-slate-500">AES-256-GCM · API UpCloud hanya melalui backend.</p>
      </div>
      <div className="px-3 pt-4 text-[10px] font-medium tracking-wide text-slate-400 dark:text-slate-600">UPCLOUD API 1.3 · v1.0.0</div>
    </aside>
    {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="Tutup navigasi" /><aside className="absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-white px-4 py-5 shadow-2xl dark:bg-slate-950"><div className="flex items-center justify-between px-2"><Brand /><Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Tutup menu"><X className="h-5 w-5" /></Button></div>{nav}<div className="mt-auto text-xs text-slate-400">UpCloud API 1.3 · koneksi via backend</div></aside></div>}
    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-[70px] items-center gap-3 border-b border-slate-200/70 bg-white/85 px-4 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/80 sm:px-6 lg:px-8">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Buka navigasi"><Menu className="h-5 w-5" /></Button>
        <div className="min-w-0"><h2 className="truncate text-sm font-bold text-slate-900 dark:text-white">{title}</h2><div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400"><span className={cx('h-1.5 w-1.5 rounded-full', live === 'live' ? 'live-dot bg-emerald-500' : live === 'connecting' ? 'bg-amber-500' : 'bg-rose-500')} />{live === 'live' ? 'Panel live' : live === 'connecting' ? 'Menghubungkan' : 'Koneksi terputus'}<span className="hidden sm:inline">· sumber via polling</span></div></div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {activeCount > 0 && <span className="hidden rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-600 dark:bg-sky-500/10 dark:text-sky-400 sm:inline">{activeCount} job dipantau</span>}
          <Button variant="outline" size="sm" loading={syncAll.isPending} onClick={() => syncAll.mutate()} title="Sinkronisasi semua token aktif"><RefreshCw className="h-4 w-4" /><span className="hidden md:inline">Sinkronisasi semua</span></Button>
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Gunakan mode terang' : 'Gunakan mode gelap'}>{theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}</Button>
          <div className="mx-1 hidden h-7 w-px bg-slate-200 dark:bg-slate-800 sm:block" />
          <div className="hidden text-right xl:block"><p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{user?.username}</p><p className="text-[10px] text-slate-400 capitalize">{user?.role}</p></div>
          <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Logout" title="Logout"><LogOut className="h-[18px] w-[18px]" /></Button>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-[1680px] p-4 sm:p-6 lg:p-8"><Suspense fallback={<div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-80" /></div>}><Outlet /></Suspense></main>
    </div>
  </div>;
}
