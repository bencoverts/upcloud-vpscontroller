import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, setApiCsrf, setUnauthorizedHandler } from '../api';
import type { PanelUser } from '../types';

type AuthResponse = { user: PanelUser; csrfToken: string; expiresAt: string };
type AuthContextValue = {
  user: PanelUser | null; loading: boolean; login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>; expireSession: () => void;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PanelUser | null>(null);
  const [loading, setLoading] = useState(true);
  const expireSession = useCallback(() => { setApiCsrf(null); setUser(null); }, []);
  useEffect(() => {
    setUnauthorizedHandler(expireSession);
    api.get<AuthResponse>('/api/auth/me').then((result) => {
      setApiCsrf(result.csrfToken);
      setUser(result.user);
    }).catch(() => setUser(null)).finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, [expireSession]);
  const login = useCallback(async (username: string, password: string) => {
    const result = await api.post<AuthResponse>('/api/auth/login', { username, password });
    setApiCsrf(result.csrfToken);
    setUser(result.user);
  }, []);
  const logout = useCallback(async () => {
    await api.post('/api/auth/logout', {});
    expireSession();
  }, [expireSession]);
  const value = useMemo(() => ({ user, loading, login, logout, expireSession }), [user, loading, login, logout, expireSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
