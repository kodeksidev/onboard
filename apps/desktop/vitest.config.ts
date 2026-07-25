import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * UI unit/component tests (A15): Vitest 3 + @testing-library/react + jsdom.
 * `VITE_IPC=mock` is forced here so every component test — and the Phase 7
 * gate's "renders the overview with no backend" evidence — exercises the
 * exact same mock-IPC code path a developer gets from `VITE_IPC=mock bun run
 * dev`, never a test-only shortcut.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    env: {
      VITE_IPC: 'mock',
    },
    css: false,
    restoreMocks: true,
  },
});
