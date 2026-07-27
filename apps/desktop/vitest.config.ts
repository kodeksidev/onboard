import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
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
    /**
     * Vitest's 5s default is a poor fit for this suite. The axe-core
     * accessibility scans and the Cytoscape / CodeMirror mounts are genuinely
     * slow to initialise — several seconds each in isolation — and running
     * ~47 files across a shared worker pool pushes them past 5s on a loaded
     * machine. The result was 9 failures reading "Test timed out in 5000ms"
     * with zero assertion failures, i.e. a correctness gate turned into a coin
     * flip by the clock.
     *
     * A timeout is not a correctness assertion, so raising it loses nothing:
     * the real render-time budget is asserted deliberately and in isolation by
     * `bun run test:perf` (Section 9 Phase 10's 20,000-line gate), which is
     * excluded below precisely so CPU contention cannot corrupt a measurement
     * that is supposed to mean something.
     */
    testTimeout: 20_000,
    /**
     * `*.perf.test.tsx` (Section 9 Phase 10's 20,000-line render-time gate)
     * is measured with a real `performance.now()` wall-clock delta against a
     * fixed budget. Running it inside the default parallel suite — dozens of
     * test files sharing a small worker-thread pool — introduces genuine CPU
     * contention that can push the same measurement well over budget
     * non-deterministically (observed: ~200ms in isolation, repeatably, vs.
     * 641ms once with ~10 concurrent files); the DOM node count it also
     * asserts (`.cm-line` count stays small) is identical either way, so the
     * variance is scheduling noise, not a real regression. `bench:graph`
     * (Section 9 Phase 8) already established the precedent of measuring a
     * performance-sensitive gate outside the default parallel run rather
     * than asserting a number the shared pool cannot honestly guarantee; run
     * this file with `bun run test:perf` for the authoritative measurement.
     */
    /**
     * `e2e/**` is excluded because those are WebdriverIO specs (A19), driven
     * by `bun run e2e` through `wdio.conf.ts`. They use the WDIO runner's
     * Mocha-style globals, so Vitest collecting them fails with
     * `describe is not defined` — the files are correct, the collector was
     * simply the wrong one.
     */
    exclude: [...configDefaults.exclude, '**/*.perf.test.tsx', 'e2e/**'],
  },
});
