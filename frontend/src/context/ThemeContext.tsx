import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useBranding } from './BrandingContext';

type Theme = 'light' | 'dark';
const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const branding = useBranding();
  const [overridden, setOverridden] = useState(() => ['light', 'dark'].includes(localStorage.getItem('cerdasnet-theme') ?? ''));
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('cerdasnet-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('cerdasnet-theme', theme);
  }, [theme]);
  useEffect(() => {
    if (overridden) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setTheme(branding.defaultTheme === 'system' ? (media.matches ? 'dark' : 'light') : branding.defaultTheme);
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [branding.defaultTheme, overridden]);
  const value = useMemo(() => ({ theme, toggleTheme: () => { setOverridden(true); setTheme((current) => current === 'dark' ? 'light' : 'dark'); } }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
