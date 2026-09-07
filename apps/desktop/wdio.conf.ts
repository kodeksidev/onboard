import path from 'node:path';
import net from 'node:net';
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
 * Windows, `WebKitWebDriver` on Linux) to actually control the webview inside
 * the already-built `onboard` binary. Nothing here talks to a remote origin —
 * `tauri-driver` and the native driver are both local processes on 127.0.0.1
 * (Section 5's static-mode network guarantee is orthogonal to, and unaffected
 * by, this local test-automation loopback).
 *
 * Prerequisite (documented, not automated by this file): `bun run
 * build:e2e` must have produced `../dist` with the E2E test bridge
 * (`src/main.tsx`'s `window.__onboardE2E`) and `cargo build --bin onboard`
 * must have embedded it into `src-tauri/target/debug/onboard[.exe]` — the
 * `e2e` script below (`apps/desktop/package.json`) runs both first.
 *
 * ## Why the ports below are leased rather than fixed
 *
 * This file previously hardcoded `4444` / `9515`. Every spec file's
 * `beforeSession` spawns its OWN `tauri-driver` + native-driver pair and
 * `afterSession` kills them, so consecutive spec files raced the previous
 * pair's socket teardown: a killed process does not release its listener
 * synchronously, and the next spec's `newSession` would hit a socket that was
 * closing. Measured symptom, on Windows with every prerequisite present: two
 * consecutive runs each ended "3 passed, 1 failed, 4 total", a DIFFERENT spec
 * each time, always `Failed to create a session: WebDriverError ...
 * UND_ERR_SOCKET POST http://127.0.0.1:4444/session` — never an assertion.
 *
 * `--maxInstances 1` serialises the workers but does not make a killed port
 * free, which is why serialising alone never fixed it. Two changes do:
 *
 *   1. `leasePort()` asks the OS for an unused port per session, so a
 *      lingering listener from the previous spec cannot be collided with at
 *      all — the new session simply gets a different number.
 *   2. `waitForListening()` blocks until the freshly spawned `tauri-driver`
 *      actually accepts a TCP connection, so `newSession` is never sent to a
 *      port nothing is bound to yet. This is the half that a port change
 *      alone would not fix: spawn returns long before the server binds.
 *
 * `afterSession` additionally AWAITS process exit rather than fire-and-
 * forgetting `kill()`, so a worker cannot start while the previous driver is
 * still shutting down and holding the application binary open.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IS_WINDOWS = process.platform === 'win32';

/**
 * The native WebDriver implementation `tauri-driver` proxies to. Tauri's
 * webview is platform-native, so this differs per OS: WebView2/msedgedriver
 * on Windows, WebKitGTK/WebKitWebDriver on Linux. Overridable so CI can point
 * at a driver it installed itself.
 *
 * On Windows, this WILL go stale: WebView2 auto-updates with the OS/Edge, but
 * the driver at this path does not update itself, and `msedgedriver` refuses
 * to start a session against a runtime it wasn't built for — "session not
 * created: This version of Microsoft Edge WebDriver only supports Microsoft
 * Edge version X" (X is the driver's version; the SAME error message also
 * states "Current browser version is Y" — that Y is exactly the version to
 * fetch, no separate lookup needed). To refresh: download
 * `https://msedgedriver.microsoft.com/{Y}/edgedriver_win64.zip`, extract
 * `msedgedriver.exe`, and overwrite this path. See docs/DECISIONS.md
 * ("msedgedriver pinning", 2026-09-07) for the incident this was written
 * from.
 */
const NATIVE_DRIVER_PATH =
  process.env.MSEDGEDRIVER_PATH ??
  process.env.NATIVE_DRIVER_PATH ??
  (IS_WINDOWS
    ? path.join(__dirname, 'src-tauri', 'target', 'webdriver', 'msedgedriver.exe')
    : 'WebKitWebDriver');

const TAURI_DRIVER_PATH = process.env.TAURI_DRIVER_PATH ?? 'tauri-driver';

const APPLICATION_PATH = path.join(
  __dirname,
  'src-tauri',
  'target',
  'debug',
  IS_WINDOWS ? 'onboard.exe' : 'onboard',
);

/** How long to wait for a spawned `tauri-driver` to bind its port. */
const DRIVER_READY_TIMEOUT_MS = 30_000;
const DRIVER_READY_POLL_MS = 100;
/** How long to wait for a killed driver to actually exit before moving on. */
const DRIVER_EXIT_TIMEOUT_MS = 10_000;

let tauriDriverProcess: ChildProcess | undefined;

/**
 * Asks the OS for a currently-unused TCP port by binding to port 0 and
 * reading back what it assigned, then releasing it.
 *
 * This is a lease, not a reservation — strictly speaking another process
 * could take the port between `close()` and `tauri-driver` binding it. That
 * residual race is orders of magnitude smaller than the one it replaces (a
 * *guaranteed* collision with the previous spec's teardown on a fixed port),
 * and `waitForListening` below turns any such loss into a clean, immediate
 * failure rather than a flaky socket hang. Binding to 127.0.0.1 rather than
 * 0.0.0.0 keeps the probe on loopback, matching where the driver listens.
 */
function leasePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Could not lease an ephemeral port')));
        return;
      }
      const { port } = address;
      server.close((closeError) => (closeError ? reject(closeError) : resolve(port)));
    });
  });
}

/** Resolves true as soon as something accepts a TCP connection on `port`. */
function canConnect(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const settle = (result: boolean): void => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.setTimeout(DRIVER_READY_POLL_MS, () => settle(false));
  });
}

/**
 * Blocks until `tauri-driver` is accepting connections on `port`, or throws.
 *
 * Fails fast and loudly if the driver process dies during startup (a missing
 * `tauri-driver` on PATH, or a native driver whose version does not match the
 * installed webview) — otherwise that surfaces 30s later as an opaque socket
 * timeout that reads exactly like the flake this function exists to remove.
 */
async function waitForListening(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + DRIVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `tauri-driver exited (code ${String(child.exitCode)}, signal ${String(child.signalCode)}) ` +
          `before binding 127.0.0.1:${String(port)}. Check that "${TAURI_DRIVER_PATH}" is on PATH ` +
          `and that the native driver "${NATIVE_DRIVER_PATH}" exists and matches the installed webview.`,
      );
    }
    if (await canConnect(port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, DRIVER_READY_POLL_MS));
  }
  throw new Error(
    `tauri-driver did not accept a connection on 127.0.0.1:${String(port)} ` +
      `within ${String(DRIVER_READY_TIMEOUT_MS)}ms`,
  );
}

/** Kills the driver and waits for the OS to reap it, so its port is genuinely free. */
function killAndWait(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, DRIVER_EXIT_TIMEOUT_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

interface MutablePortConfig {
  port: number;
}

export const config = {
  runner: 'local',
  specs: ['./e2e/**/*.spec.ts'],
  /**
   * One spec file at a time. `tauri-driver` drives a single application
   * instance, and the app holds an exclusive SQLite cache per repo, so two
   * concurrent sessions are not merely slow but genuinely unsound. The `e2e`
   * script in `apps/desktop/package.json` also passes `--maxInstances 1` on
   * the CLI, which is what reliably serialises the local runner; this value
   * keeps the file honest on its own.
   */
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
  /**
   * Placeholder only. The real port is leased per session in `beforeSession`
   * and written back into the live config before `newSession` is sent; no
   * fixed port is ever connected to. It is not 4444 precisely so that a
   * regression which skips the lease fails visibly instead of silently
   * working on the old hardcoded port.
   */
  port: 0,
  path: '/',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
  },

  onPrepare: (): void => {
    console.log(`[wdio] application: ${APPLICATION_PATH}`);
    console.log(`[wdio] native driver: ${NATIVE_DRIVER_PATH}`);
  },

  /**
   * Receives the live config object; mutating `port` here is what points the
   * about-to-be-created session at the leased port. WDIO reads `config.port`
   * when it builds the session request, which happens after this hook
   * resolves — so the assignment must be awaited, not fired and forgotten.
   */
  beforeSession: async (sessionConfig: MutablePortConfig): Promise<void> => {
    const driverPort = await leasePort();
    const nativePort = await leasePort();
    sessionConfig.port = driverPort;

    tauriDriverProcess = spawn(
      TAURI_DRIVER_PATH,
      [
        '--port',
        String(driverPort),
        // Must differ from the driver port: without an explicit
        // `--native-port`, `tauri-driver` can collide with its own
        // intermediary port when binding the native driver's listener
        // (observed directly against msedgedriver).
        '--native-port',
        String(nativePort),
        '--native-driver',
        NATIVE_DRIVER_PATH,
      ],
      { stdio: [null, process.stdout, process.stderr] },
    );

    await waitForListening(driverPort, tauriDriverProcess);
    console.log(`[wdio] tauri-driver ready on 127.0.0.1:${String(driverPort)}`);
  },

  afterSession: async (): Promise<void> => {
    if (tauriDriverProcess !== undefined) {
      await killAndWait(tauriDriverProcess);
      tauriDriverProcess = undefined;
    }
  },
};
