import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Brand } from '../components/Layout';
import { Button, Field, inputClass } from '../components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
      const destination = (location.state as any)?.from?.pathname ?? '/';
      navigate(destination, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Login tidak berhasil.');
    } finally { setLoading(false); }
  };
  return <div className="relative min-h-screen overflow-hidden bg-[#f5f7fb] dark:bg-[#080e19]">
    <div className="grid-fade pointer-events-none absolute inset-0" />
    <div className="pointer-events-none absolute -top-40 -left-32 h-[480px] w-[480px] rounded-full bg-teal-400/10 blur-3xl" />
    <Button variant="ghost" size="icon" className="absolute top-5 right-5 z-10" onClick={toggleTheme} aria-label="Ganti tema">{theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</Button>
    <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-12 px-5 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:px-12">
      <section className="hidden lg:block">
        <Brand />
        <div className="mt-16 max-w-xl"><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/5 px-3 py-1.5 text-xs font-semibold text-teal-700 dark:text-teal-400"><ShieldCheck className="h-3.5 w-3.5" />Infrastruktur Anda, dalam kendali penuh</div>
          <h1 className="text-balance text-5xl leading-[1.08] font-extrabold tracking-[-0.045em] text-slate-950 dark:text-white">Satu panel.<br /><span className="bg-gradient-to-r from-teal-600 to-emerald-500 bg-clip-text text-transparent dark:from-teal-400 dark:to-emerald-400">Seluruh VPS Anda.</span></h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-500 dark:text-slate-400">Kelola banyak API token UpCloud, pantau kondisi server, dan jalankan kontrol terverifikasi—tanpa mengorbankan keamanan kredensial.</p>
          <div className="mt-10 grid max-w-lg grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/80 bg-white/55 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/40"><KeyRound className="h-5 w-5 text-teal-500" /><p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Multi-token terisolasi</p><p className="mt-1 text-xs leading-5 text-slate-400">Kegagalan satu koneksi tidak memutus grup lain.</p></div>
            <div className="rounded-2xl border border-white/80 bg-white/55 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/40"><Activity className="h-5 w-5 text-teal-500" /><p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Data apa adanya</p><p className="mt-1 text-xs leading-5 text-slate-400">Metrik nyata, bukan angka simulasi.</p></div>
          </div>
        </div>
      </section>
      <section className="mx-auto w-full max-w-md">
        <div className="mb-10 lg:hidden"><Brand /></div>
        <div className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_-24px_rgb(15_23_42_/_0.18)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/85 sm:p-8">
          <div className="mb-8"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400"><LockKeyhole className="h-5 w-5" /></div><h2 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Selamat datang kembali</h2><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Masuk ke konsol administrator CerdasNet.</p></div>
          <form onSubmit={submit} className="space-y-5">
            <Field label="Username" required><input id="username" className={inputClass} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required minLength={3} maxLength={64} placeholder="Username admin" /></Field>
            <Field label="Password" required><div className="relative"><input id="password" className={`${inputClass} pr-11`} type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required maxLength={256} placeholder="Password admin" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></Field>
            {error && <div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-3 text-xs leading-5 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}
            <Button type="submit" loading={loading} className="w-full" disabled={!username || !password}>{loading ? 'Memverifikasi…' : 'Masuk ke dashboard'}{!loading && <ArrowRight className="h-4 w-4" />}</Button>
          </form>
          <div className="mt-6 flex items-start gap-2 border-t border-slate-100 pt-5 text-[11px] leading-5 text-slate-400 dark:border-slate-800 dark:text-slate-500"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-500" />Session HttpOnly, CSRF protection, Argon2id, dan login rate limiting aktif.</div>
        </div>
        <p className="mt-6 text-center text-[11px] text-slate-400 dark:text-slate-600">CerdasNet VPS Control · UpCloud API 1.3</p>
      </section>
    </div>
  </div>;
}
