import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Cloud, RefreshCw } from 'lucide-react';

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Keep the fallback free of request payloads and credentials. Operational errors remain visible through API states.
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5 dark:bg-slate-950"><div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900"><Cloud className="mx-auto h-9 w-9 text-teal-500" /><h1 className="mt-5 text-xl font-bold text-slate-950 dark:text-white">Panel perlu dimuat ulang</h1><p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">Terjadi kesalahan tampilan yang tidak terduga. Tidak ada operasi baru yang dikirim dari layar ini. Muat ulang, lalu periksa Activity Logs sebelum mengulangi tindakan.</p><button onClick={() => window.location.reload()} className="mt-6 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"><RefreshCw className="h-4 w-4" />Muat ulang panel</button></div></div>;
  }
}
