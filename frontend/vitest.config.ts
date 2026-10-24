import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['./src/tests/**/*.test.tsx', './src/tests/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**/*.{ts,tsx}'], exclude: ['src/tests/**'] },
  },
});
