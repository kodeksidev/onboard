import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Runs only `*.perf.test.tsx` (Section 9 Phase 10's 20,000-line render-time
 * gate), outside the default parallel suite and with file parallelism
 * disabled, so the `performance.now()` measurement it asserts is not shared
 * with other test files competing for the same worker-thread pool. See
 * `vitest.config.ts`'s `test.exclude` comment for the observed contention
 * numbers this avoids. `bun run test:perf` is the authoritative way to
 * evaluate this gate.
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
    include: ['**/*.perf.test.tsx'],
    fileParallelism: false,
  },
});
