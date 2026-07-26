/**
 * @onboard/engine — `test:rpc` (Section 9 Phase 5 gate item 2): drives the
 * BUILT sidecar binary (not `src/main.ts` via `bun run`) over stdio through
 * `engine.analyze` -> `engine.search` -> `engine.readFile` -> `engine.shutdown`,
 * the same newline-delimited JSON-RPC 2.0 protocol the Rust shell speaks.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLines } from '../src/rpc/server';

const DIST_DIR = join(import.meta.dir, '..', 'dist');
const GRAMMARS_DIR = join(import.meta.dir, '..', 'grammars');
const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures');

function binaryNameForHost(): string {
  if (process.platform === 'win32') {
    return 'onboard-engine-x86_64-pc-windows-msvc.exe';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'onboard-engine-aarch64-apple-darwin' : 'onboard-engine-x86_64-apple-darwin';
  }
  return 'onboard-engine-x86_64-unknown-linux-gnu';
}

interface JsonRpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

function assertField(condition: boolean, description: string): void {
  if (!condition) {
    throw new Error(`test:rpc assertion failed: ${description}`);
  }
}

class RpcSession {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (msg: JsonRpcMessage) => void; reject: (error: Error) => void }>();
  readonly progressEvents: JsonRpcMessage[] = [];

  constructor(
    private readonly write: (line: string) => void,
    linesIterable: AsyncIterable<string>,
  ) {
    void this.consumeLines(linesIterable);
  }

  private async consumeLines(linesIterable: AsyncIterable<string>): Promise<void> {
    for await (const line of linesIterable) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const message = JSON.parse(trimmed) as JsonRpcMessage;
      if (message.method === 'engine.progress') {
        this.progressEvents.push(message);
        continue;
      }
      if (typeof message.id === 'number') {
        this.pending.get(message.id)?.resolve(message);
        this.pending.delete(message.id);
      }
    }
  }

  call(method: string, params: unknown): Promise<JsonRpcMessage> {
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise<JsonRpcMessage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return promise;
  }
}

interface AnalyzeStepResult {
  readonly repoId: string;
  readonly files: readonly { path: string }[];
}

/**
 * A green RPC round-trip on a zero-symbol result is not a passing gate
 * (Section 9 Phase 5's original weakness, per the coordinator's report):
 * node-express is a fixture known to parse cleanly, so it must actually
 * produce symbols and edges, with zero `PARSE_FAILED` diagnostics — not
 * merely respond successfully with an empty, meaningless `AnalysisResult`.
 */
async function runAnalyzeStep(session: RpcSession, appDataDir: string): Promise<AnalyzeStepResult> {
  const analyze = await session.call('engine.analyze', {
    repoPath: join(FIXTURES_DIR, 'node-express'),
    appDataDir,
    excludeGlobs: [],
    isForceRefresh: false,
  });
  assertField(analyze.error === undefined, `engine.analyze returned an error: ${JSON.stringify(analyze.error)}`);
  const analyzeResult = analyze.result as {
    result: {
      repo: { id: string };
      files: readonly { path: string }[];
      symbols: readonly unknown[];
      edges: readonly unknown[];
      diagnostics: readonly { code: string; path: string }[];
    };
  };
  const { repo, files, symbols, edges, diagnostics } = analyzeResult.result;
  const parseFailures = diagnostics.filter((d) => d.code === 'PARSE_FAILED');
  console.log(
    `engine.analyze -> repoId=${repo.id}, files=${String(files.length)}, symbols=${String(symbols.length)}, ` +
      `edges=${String(edges.length)}, PARSE_FAILED=${String(parseFailures.length)}, progressEvents=${String(session.progressEvents.length)}`,
  );
  assertField(files.length > 0, 'engine.analyze returned zero files for the node-express fixture');
  assertField(symbols.length > 0, 'engine.analyze extracted zero symbols from the node-express fixture');
  assertField(edges.length > 0, 'engine.analyze resolved zero import edges from the node-express fixture');
  assertField(
    parseFailures.length === 0,
    `engine.analyze produced ${String(parseFailures.length)} PARSE_FAILED diagnostic(s) on a fixture known to parse cleanly: ${JSON.stringify(parseFailures)}`,
  );
  assertField(session.progressEvents.length > 0, 'engine.analyze produced zero engine.progress notifications');
  return { repoId: repo.id, files };
}

async function runScenario(session: RpcSession, appDataDir: string): Promise<void> {
  const version = await session.call('engine.version', {});
  console.log('engine.version ->', JSON.stringify(version.result));
  assertField(version.error === undefined, `engine.version returned an error: ${JSON.stringify(version.error)}`);

  const { repoId, files } = await runAnalyzeStep(session, appDataDir);

  const search = await session.call('engine.search', { repoId, query: 'router', limit: 10 });
  assertField(search.error === undefined, `engine.search returned an error: ${JSON.stringify(search.error)}`);
  const searchResult = search.result as { hits: readonly { path: string }[] };
  console.log(`engine.search "router" -> ${String(searchResult.hits.length)} hit(s)`);
  assertField(searchResult.hits.length > 0, 'engine.search "router" returned zero hits on the node-express fixture');

  const somePath = files[0]?.path ?? '';
  const readFile = await session.call('engine.readFile', { repoId, path: somePath, maxBytes: 1_000_000 });
  assertField(readFile.error === undefined, `engine.readFile returned an error: ${JSON.stringify(readFile.error)}`);
  const readFileResult = readFile.result as { path: string; content: string };
  console.log(`engine.readFile "${somePath}" -> ${String(readFileResult.content.length)} byte(s)`);
  assertField(readFileResult.path === somePath, 'engine.readFile echoed a different path than requested');

  const shutdown = await session.call('engine.shutdown', {});
  assertField(shutdown.error === undefined, `engine.shutdown returned an error: ${JSON.stringify(shutdown.error)}`);
  console.log('engine.shutdown -> {}');
}

async function main(): Promise<void> {
  const binaryPath = join(DIST_DIR, binaryNameForHost());
  const appDataDir = mkdtempSync(join(tmpdir(), 'onboard-test-rpc-'));

  const proc = Bun.spawn([binaryPath, '--grammars-dir', GRAMMARS_DIR], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const write = (line: string): void => {
    proc.stdin.write(`${line}\n`);
    void proc.stdin.flush();
  };
  const session = new RpcSession(write, readLines(proc.stdout));

  try {
    await runScenario(session, appDataDir);
    const exitCode = await proc.exited;
    assertField(exitCode === 0, `sidecar process exited with code ${String(exitCode)}, expected 0`);
    console.log(`\nPASS: analyze -> search -> readFile -> shutdown over stdio against the built binary (${binaryNameForHost()}), exit code 0.`);
  } catch (error) {
    proc.kill();
    const stderrText = await new Response(proc.stderr).text();
    if (stderrText.length > 0) {
      console.error('sidecar stderr:', stderrText);
    }
    throw error;
  } finally {
    rmSync(appDataDir, { recursive: true, force: true });
  }
}

await main();
