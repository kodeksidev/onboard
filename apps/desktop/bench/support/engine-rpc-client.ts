/**
 * A minimal newline-delimited JSON-RPC 2.0 client over stdio (Section 7.3),
 * driving the REAL staged sidecar binary directly — the same protocol the
 * Rust shell speaks (`apps/desktop/src-tauri/src/sidecar/rpc.rs`) and the
 * same one `packages/engine/scripts/test-rpc.ts` already exercises. Kept
 * deliberately small and bench-scoped rather than importing `@onboard/engine`
 * as a dependency of `apps/desktop`.
 */

export interface JsonRpcMessage {
  readonly jsonrpc?: '2.0';
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        yield buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
      }
    }
    if (buffer.length > 0) {
      yield buffer;
    }
  } finally {
    reader.releaseLock();
  }
}

export class EngineRpcSession {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (msg: JsonRpcMessage) => void; reject: (error: Error) => void }
  >();
  readonly progressEvents: JsonRpcMessage[] = [];
  private readonly consumeTask: Promise<void>;

  constructor(
    private readonly proc: { stdin: { write: (data: string) => void; flush: () => number | Promise<number> } },
    stdout: ReadableStream<Uint8Array>,
  ) {
    this.consumeTask = this.consumeLines(stdout);
  }

  private async consumeLines(stream: ReadableStream<Uint8Array>): Promise<void> {
    for await (const line of readLines(stream)) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(trimmed) as JsonRpcMessage;
      } catch {
        continue;
      }
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

  call(method: string, params: unknown, timeoutMs = 120_000): Promise<JsonRpcMessage> {
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise<JsonRpcMessage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC call "${method}" timed out after ${String(timeoutMs)}ms`));
        }
      }, timeoutMs);
    });
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    void this.proc.stdin.flush();
    return promise;
  }

  async waitForClose(): Promise<void> {
    await this.consumeTask;
  }
}

export interface SpawnedEngine {
  readonly session: EngineRpcSession;
  readonly pid: number;
  kill(): void;
  exited: Promise<number>;
}

/** Spawns the real staged sidecar binary with `--grammars-dir` (Section 14's "known hard part" #1). */
export function spawnEngine(binaryPath: string, grammarsDir: string): SpawnedEngine {
  const proc = Bun.spawn([binaryPath, '--grammars-dir', grammarsDir], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const session = new EngineRpcSession(proc, proc.stdout);
  return {
    session,
    pid: proc.pid,
    kill: () => proc.kill(),
    exited: proc.exited,
  };
}

export function assertNoRpcError(message: JsonRpcMessage, context: string): void {
  if (message.error !== undefined) {
    throw new Error(`${context}: ${JSON.stringify(message.error)}`);
  }
}
