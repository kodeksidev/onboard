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
     * Deliberately left at Vitest's modest 5s default.
     *
     * Nine tests once failed here as "Test timed out in 5000ms" under parallel
     * load, and raising this to 20s did re-green them — but that is the wrong
     * mechanism. This value is the floor for detecting a silent slowdown in
     * every one of the ~270 tests that have no reason to be slow: a test that
     * should finish in 100ms and regresses to 8s would pass forever, silently,
     * under a 20s default. Buying headroom for six files by giving it to all
     * of them trades a real signal for convenience.
     *
     * Measured in isolation, no test in this suite does more than ~1.4s of
     * real work, so 5s is generous for anything not fighting for CPU. The
     * files that genuinely mount axe-core, Cytoscape, or CodeMirror ask for
     * headroom explicitly via `SLOW_MOUNT_TIMEOUT_MS` (see
     * `src/test/timeouts.ts`), which also keeps a written record of which
     * tests are expensive and why.
     */
    testTimeout: 5_000,
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
    /**
     * Section 13 #10: ">=80% lines and branches per package".
     *
     * `include` is an explicit allow-list rather than a default, because the
     * default is actively misleading here. Measured before this block existed:
     * `vitest run --coverage` reported `All files | 6.02% Stmts`, because the
     * v8 provider had swept 191 files including ~120 Tauri build artifacts
     * under `src-tauri/target/{debug,release}/build/onboard-<hash>/out/`
     * `tauri-codegen-assets/` (generated asset blobs, never executed by a
     * test), plus `wdio.conf.ts`, `bench/` and `e2e/support/`. A 6% figure
     * that is really "we measured the Rust build directory" is worse than no
     * figure: it cannot fail honestly and it cannot pass honestly.
     *
     * What is left in is the whole shipped UI source tree — including
     * `main.tsx`, which is NOT excluded despite being the hardest file here to
     * reach from jsdom. Excluding an untested file to lift the average is the
     * same vacuity this project rejects everywhere else; if it is uncovered,
     * the number should say so.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      /**
       * Test files and the test-only helpers they import are excluded from
       * being *measured* (they are still executed). Coverage of a test file by
       * itself is a tautology — it reports how much of the assertions ran, not
       * how much product code they reached.
       */
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.perf.test.tsx', 'src/test/**'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
