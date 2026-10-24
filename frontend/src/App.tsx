import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import { Brand } from './components/Layout';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ServersPage = lazy(() => import('./pages/ServersPage'));
const ServerDetailPage = lazy(() => import('./pages/ServerDetailPage'));
const TokenManagerPage = lazy(() => import('./pages/TokenManagerPage'));
const MonitoringPage = lazy(() => import('./pages/MonitoringPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DeployPage = lazy(() => import('./pages/DeployPage'));
const ApiKeysPage = lazy(() => import('./pages/ApiKeysPage'));
const ProxmoxPage = lazy(() => import('./pages/ProxmoxPage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));

function LoadingScreen() {
  return <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] dark:bg-[#0a0f1c]"><div className="flex flex-col items-center gap-5"><Brand /><div className="h-1 w-36 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full w-1/2 animate-pulse rounded-full bg-teal-500" /></div><p className="text-xs text-slate-400">Memuat sesi aman…</p></div></div>;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Routes><Route path="/login" element={<LoginPage />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>;
  return <Suspense fallback={<LoadingScreen />}><Routes>
    <Route element={<Layout />}>
      <Route index element={<DashboardPage />} />
      <Route path="servers" element={<ServersPage />} />
      <Route path="servers/:uuid" element={<ServerDetailPage />} />
      <Route path="tokens" element={user.role === 'admin' ? <TokenManagerPage /> : <Navigate to="/" replace />} />
      <Route path="deploy" element={<DeployPage />} />
      <Route path="api-keys" element={<ApiKeysPage />} />
      <Route path="proxmox" element={user.role === 'admin' ? <ProxmoxPage /> : <Navigate to="/" replace />} />
      <Route path="docs" element={<DocsPage />} />
      <Route path="monitoring" element={<MonitoringPage />} />
      <Route path="activity" element={user.role === 'admin' ? <ActivityPage /> : <Navigate to="/" replace />} />
      <Route path="users" element={user.role === 'admin' ? <UsersPage /> : <Navigate to="/" replace />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes></Suspense>;
}
