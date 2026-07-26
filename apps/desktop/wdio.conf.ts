import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/**
 * WebdriverIO + `tauri-driver` E2E config (Section 9 Phase 11, Section 11,
 * A19). Windows and Linux only — macOS has no WebDriver support in Tauri
 * (A19); `docs/MACOS_SMOKE.md` covers macOS via a manual checklist instead.
 *
 * `tauri-driver` is the intermediary WebDriver server Tauri ships: it
 * receives standard WebDriver commands on `--port` and forwards them to the
 * OS-native driver it launches (`--native-driver`, `msedgedriver.exe` on
 * Windows) to actually control the WebView2 control inside the already-built
 * `onboard.exe`. Nothing here talks to a remote origin — `tauri-driver` and
 * the native driver are both local processes on 127.0.0.1 (Section 5's
 * static-mode network guarantee is orthogonal to, and unaffected by, this
 * local test-automation loopback).
 *
 * Prerequisite (documented, not automated by this file): `bun run
 * build:e2e` must have produced `../dist` with the E2E test bridge
 * (`src/main.tsx`'s `window.__onboardE2E`) and `cargo build --bin onboard`
 * must have embedded it into `src-tauri/target/debug/onboard.exe` — the
 * `e2e` script below (`apps/desktop/package.json`) runs both first.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Overridable so CI can point at a driver it installed itself. */
const MSEDGEDRIVER_PATH =
  process.env.MSEDGEDRIVER_PATH ??
  path.join(__dirname, 'src-tauri', 'target', 'webdriver', 'msedgedriver.exe');

const TAURI_DRIVER_PATH = process.env.TAURI_DRIVER_PATH ?? 'tauri-driver';

const APPLICATION_PATH = path.join(__dirname, 'src-tauri', 'target', 'debug', 'onboard.exe');

const TAURI_DRIVER_PORT = 4444;
// Must differ from TAURI_DRIVER_PORT: without an explicit `--native-port`,
// `tauri-driver` can collide with its own intermediary port when binding
// the native driver's listener (observed directly against msedgedriver).
const NATIVE_DRIVER_PORT = 9515;

let tauriDriverProcess: ChildProcess | undefined;

export const config = {
  runner: 'local',
  specs: ['./e2e/**/*.spec.ts'],
  // Each worker's `beforeSession` spawns its own `tauri-driver` +
  // `msedgedriver` pair on the SAME fixed ports (`TAURI_DRIVER_PORT`,
  // `NATIVE_DRIVER_PORT`) — observed directly: the config-level
  // `maxInstances` below was not sufficient on its own to force one spec
  // file at a time, so `apps/desktop/package.json`'s `e2e` script also
  // passes `--maxInstances 1` on the CLI, which reliably serializes them.
  maxInstances: 1,
  capabilities: [
    {
      // `tauri-driver` ignores most standard capabilities and reads its
      // target application from this vendor-prefixed key (Tauri's
      // documented WebdriverIO integration shape).
      'tauri:options': {
        application: APPLICATION_PATH,
      },
    },
  ],
  logLevel: 'warn' as const,
  bail: 0,
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  hostname: '127.0.0.1',
  port: TAURI_DRIVER_PORT,
  path: '/',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
  },

  onPrepare: (): void => {
    console.log(`[wdio] application: ${APPLICATION_PATH}`);
    console.log(`[wdio] native driver: ${MSEDGEDRIVER_PATH}`);
  },

  beforeSession: (): void => {
    tauriDriverProcess = spawn(
      TAURI_DRIVER_PATH,
      [
        '--port',
        String(TAURI_DRIVER_PORT),
        '--native-port',
        String(NATIVE_DRIVER_PORT),
        '--native-driver',
        MSEDGEDRIVER_PATH,
      ],
      { stdio: [null, process.stdout, process.stderr] },
    );
  },

  afterSession: (): void => {
    tauriDriverProcess?.kill();
  },
};
