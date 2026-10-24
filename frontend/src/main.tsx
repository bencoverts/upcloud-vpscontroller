import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { BrandingProvider } from './context/BrandingContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { JobsProvider } from './context/JobsContext';
import { LiveProvider } from './context/LiveContext';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <BrandingProvider><ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <JobsProvider>
                <LiveProvider><App /></LiveProvider>
              </JobsProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider></BrandingProvider>
      </QueryClientProvider>
    </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
