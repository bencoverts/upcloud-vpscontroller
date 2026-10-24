import { createContext, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export type Branding = { siteName: string; siteTagline: string; accent: 'teal' | 'blue' | 'violet' | 'rose' | 'amber'; defaultTheme: 'system' | 'light' | 'dark'; logoUrl: string | null; faviconUrl: string | null };
const fallback: Branding = { siteName: 'CerdasNet', siteTagline: 'VPS Control', accent: 'teal', defaultTheme: 'system', logoUrl: null, faviconUrl: null };
const accentColors = { teal: '#14b8a6', blue: '#3b82f6', violet: '#8b5cf6', rose: '#f43f5e', amber: '#f59e0b' };
const BrandingContext = createContext<Branding>(fallback);
export function BrandingProvider({ children }: { children: ReactNode }) {
  const query = useQuery({ queryKey: ['branding'], queryFn: () => api.get<Branding>('/api/branding'), staleTime: 60_000, retry: 1 });
  const branding = query.data ?? fallback;
  useEffect(() => {
    document.title = `${branding.siteName} · ${branding.siteTagline}`;
    document.documentElement.style.setProperty('--brand-accent', accentColors[branding.accent]);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', accentColors[branding.accent]);
    const existing = document.querySelector<HTMLLinkElement>('link[data-branding-favicon]');
    if (branding.faviconUrl) {
      const icon = existing ?? document.createElement('link');
      icon.rel = 'icon'; icon.dataset.brandingFavicon = 'true'; icon.href = branding.faviconUrl;
      if (!existing) document.head.appendChild(icon);
    } else existing?.remove();
  }, [branding]);
  const value = useMemo(() => branding, [branding]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}
export function useBranding() { return useContext(BrandingContext); }
