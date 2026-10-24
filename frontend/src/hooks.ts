import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Settings } from './types';

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings'),
    staleTime: 30_000, retry: 1,
  });
}
