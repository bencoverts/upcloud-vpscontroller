import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext';

type LiveStatus = 'connecting' | 'live' | 'disconnected';
type Connection = { userId: string | null; status: LiveStatus };
const LiveContext = createContext<LiveStatus>('disconnected');
export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<Connection>({ userId: null, status: 'disconnected' });
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    const source = new EventSource('/api/events');
    source.addEventListener('ready', () => setConnection({ userId, status: 'live' }));
    source.onerror = () => setConnection({ userId, status: 'disconnected' });
    for (const type of ['job', 'server', 'token']) {
      source.addEventListener(type, () => {
        void queryClient.invalidateQueries({ queryKey: ['servers'] });
        void queryClient.invalidateQueries({ queryKey: ['server'] });
        void queryClient.invalidateQueries({ queryKey: ['tokens'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        void queryClient.invalidateQueries({ queryKey: ['activity'] });
      });
    }
    return () => source.close();
  }, [userId, queryClient]);
  const status: LiveStatus = !userId ? 'disconnected' : connection.userId !== userId ? 'connecting' : connection.status;
  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>;
}
export function useLiveStatus() { return useContext(LiveContext); }
export function useLiveLabel() {
  return useMemo(() => ({ connecting: 'Menghubungkan', live: 'Panel live', disconnected: 'Koneksi terputus' }), []);
}
