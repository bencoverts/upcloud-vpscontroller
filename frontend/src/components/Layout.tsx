import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  Activity, Cloud, KeyRound, LayoutDashboard, LogOut, Menu, Moon, RefreshCw,
  Server, Settings, ShieldCheck, Sun, Users, X, Zap, BookOpen, Boxes, KeySquare, PlusCircle,
} from 'lucide-react';
import { api } from '../api';
import type { SyncJob } from '../types';
import { cx } from '../utils';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { useJobs } from '../context/JobsContext';
import { useBranding } from '../context/BrandingContext';
import { useLiveStatus } from '../context/LiveContext';
import { Button, Skeleton } from './ui';

const navigation = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/servers', label: 'VPS Servers', icon: Server },
  { to: '/tokens', label: 'API Token Manager', icon: KeyRound, admin: true },
  { to: '/deploy', label: 'Deploy VPS', icon: PlusCircle },
  { to: '/proxmox', label: 'Proxmox VE', icon: Boxes, admin: true },
  { to: '/api-keys', label: 'Panel API Keys', icon: KeySquare },
  { to: '/docs', label: 'Documentation', icon: BookOpen },
  { to: '/monitoring', label: 'Monitoring', icon: Activity },
  { to: '/activity', label: 'Activity Logs', icon: Zap, admin: true },
  { to: '/users', label: 'Client Users', icon: Users, admin: true },
  { to: '/settings', label: 'Settings', icon: Settings },
];
const pageNames: Record<string, string> = { '/': 'Dashboard', '/servers': 'VPS Servers', '/tokens': 'API Token Manager', '/monitoring': 'Monitoring', '/activity': 'Activity Logs', '/settings': 'Settings', '/users': 'Client Users', '/deploy': 'Deploy VPS', '/proxmox': 'Proxmox VE', '/api-keys': 'Panel API Keys', '/docs': 'Documentation' };

export function Brand({ compact = false }: { compact?: boolean }) {
  const branding = useBranding();
  return <div className="flex items-center gap-3"><div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[13px] bg-gradient-to-br from-teal-400 to-teal-700 text-white shadow-lg shadow-teal-600/20">{branding.logoUrl ? <img src={branding.logoUrl} alt="" className="h-full w-full object-cover" /> : <Cloud className="h-5 w-5" strokeWidth={2.2} />}<span className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400 dark:border-slate-900" /></div>{!compact && <div><div className="max-w-44 truncate text-[17px] font-extrabold tracking-[-0.035em] text-slate-950 dark:text-white">{branding.siteName}</div><div className="max-w-44 truncate text-[9px] font-bold tracking-[0.2em] text-slate-400 uppercase dark:text-slate-500">{branding.siteTagline}</div></div>}</div>;
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileOpen]);
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
  const nav = <nav className="space-y-1.5" aria-label="Navigasi utama">{navigation.filter((item) => !item.admin || user?.role === 'admin').map((item) => <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMobileOpen(false)} className={({ isActive }) => cx('group flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-medium', isActive ? 'bg-teal-50 text-teal-700 shadow-[inset_0_0_0_1px_rgb(20_184_166_/_0.08)] dark:bg-teal-500/10 dark:text-teal-400' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white')}>
    <item.icon className="h-[18px] w-[18px] shrink-0" />{item.label}
  </NavLink>)}</nav>;
  return <div className="min-h-screen bg-[#f5f7fb] text-slate-800 dark:bg-[#0a0f1c] dark:text-slate-200">
    <a href="#main-content" className="fixed top-2 left-2 z-[120] -translate-y-20 rounded-lg bg-teal-600 px-4 py-2 text-white focus:translate-y-0">Lewati ke konten</a>
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-hidden border-r border-slate-200/70 bg-white px-4 py-5 dark:border-slate-800/80 dark:bg-slate-950 lg:flex" aria-label="Navigasi samping desktop">
      <div className="shrink-0 px-2"><Brand /></div>
      <div data-testid="desktop-navigation-scroll" className="scrollbar-thin -mx-1 mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-3">{nav}</div>
      <div className="mt-3 shrink-0 rounded-2xl border border-slate-100 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300"><ShieldCheck className="h-4 w-4 text-teal-500" />Kredensial terlindungi</div>
        <p className="mt-2 text-[11px] leading-5 text-slate-400 dark:text-slate-500">AES-256-GCM · API UpCloud hanya melalui backend.</p>
      </div>
      <div className="shrink-0 px-3 pt-4 text-[10px] font-medium tracking-wide text-slate-400 dark:text-slate-600">UPCLOUD API 1.3 · v1.0.0</div>
    </aside>
    {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="Tutup navigasi" /><aside className="absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col overflow-hidden bg-white px-4 py-5 shadow-2xl dark:bg-slate-950" aria-label="Navigasi samping mobile"><div className="flex shrink-0 items-center justify-between px-2"><Brand /><Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Tutup menu"><X className="h-5 w-5" /></Button></div><div data-testid="mobile-navigation-scroll" className="scrollbar-thin -mx-1 mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-3">{nav}</div><div className="mt-3 shrink-0 border-t border-slate-100 pt-4 text-xs text-slate-400 dark:border-slate-800">UpCloud API 1.3 · koneksi via backend</div></aside></div>}
    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-[70px] items-center gap-3 border-b border-slate-200/70 bg-white/85 px-4 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/80 sm:px-6 lg:px-8">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Buka navigasi"><Menu className="h-5 w-5" /></Button>
        <div className="min-w-0"><h2 className="truncate text-sm font-bold text-slate-900 dark:text-white">{title}</h2><div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400"><span className={cx('h-1.5 w-1.5 rounded-full', live === 'live' ? 'live-dot bg-emerald-500' : live === 'connecting' ? 'bg-amber-500' : 'bg-rose-500')} />{live === 'live' ? 'Panel live' : live === 'connecting' ? 'Menghubungkan' : 'Koneksi terputus'}<span className="hidden sm:inline">· WebSocket realtime</span></div></div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {activeCount > 0 && <span className="hidden rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-600 dark:bg-sky-500/10 dark:text-sky-400 sm:inline">{activeCount} job dipantau</span>}
          {user?.role === 'admin' && <Button variant="outline" size="sm" loading={syncAll.isPending} onClick={() => syncAll.mutate()} title="Sinkronisasi semua token aktif"><RefreshCw className="h-4 w-4" /><span className="hidden md:inline">Sinkronisasi semua</span></Button>}
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Gunakan mode terang' : 'Gunakan mode gelap'}>{theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}</Button>
          <div className="mx-1 hidden h-7 w-px bg-slate-200 dark:bg-slate-800 sm:block" />
          <div className="hidden text-right xl:block"><p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{user?.username}</p><p className="text-[10px] text-slate-400 capitalize">{user?.role}</p></div>
          <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Logout" title="Logout"><LogOut className="h-[18px] w-[18px]" /></Button>
        </div>
      </header>
      <main id="main-content" className={cx('mx-auto w-full p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8', location.pathname === '/' ? 'max-w-[1440px]' : 'max-w-[1680px]')}><Suspense fallback={<div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-80" /></div>}><Outlet /></Suspense></main>
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[72px] items-stretch justify-around border-t border-slate-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95 lg:hidden" aria-label="Navigasi mobile">{navigation.filter((item) => ['/', '/servers', '/deploy', '/monitoring', '/settings'].includes(item.to)).map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cx('flex min-w-14 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold', isActive ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400')}><item.icon className="h-5 w-5" /><span className="max-w-full truncate px-1">{item.to === '/' ? 'Home' : item.to === '/servers' ? 'VPS' : item.label}</span></NavLink>)}</nav>
  </div>;
}
