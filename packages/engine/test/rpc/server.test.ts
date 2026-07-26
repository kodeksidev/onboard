import { describe, expect, test } from 'bun:test';
import { DomainError } from '../../src/rpc/domain-error';
import { handleRpcLine, readLines, runServer } from '../../src/rpc/server';
import type { EngineMethods } from '../../src/rpc/methods';

function fakeMethods(overrides: Partial<EngineMethods> = {}): EngineMethods {
  return {
    sessions: { get: () => undefined, set: () => {}, closeAll: () => {} },
    version: () => Promise.resolve({ engineVersion: '0.0.0-test', contractSchemaVersion: 1, grammarFingerprint: 'fp' }),
    analyze: () => Promise.reject(new Error('not implemented in this fake')),
    search: () => Promise.reject(new Error('not implemented in this fake')),
    readFile: () => Promise.reject(new Error('not implemented in this fake')),
    snippets: () => Promise.reject(new Error('not implemented in this fake')),
    shutdown: () => Promise.resolve({}),
    ...overrides,
  };
}

function collectLines(): { writeLine: (line: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { writeLine: (line) => lines.push(line), lines };
}

describe('handleRpcLine — happy path', () => {
  test('routes engine.version to methods.version and writes a success response', async () => {
    const methods = fakeMethods();
    const { writeLine, lines } = collectLines();
    const result = await handleRpcLine('{"jsonrpc":"2.0","id":1,"method":"engine.version","params":{}}', methods, writeLine);
    expect(result.shouldShutdown).toBe(false);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { engineVersion: '0.0.0-test', contractSchemaVersion: 1, grammarFingerprint: 'fp' },
    });
  });

  test('a successful engine.shutdown reports shouldShutdown: true', async () => {
    const methods = fakeMethods();
    const { writeLine } = collectLines();
    const result = await handleRpcLine('{"jsonrpc":"2.0","id":"a","method":"engine.shutdown","params":{}}', methods, writeLine);
    expect(result.shouldShutdown).toBe(true);
  });
});

describe('handleRpcLine — protocol-level errors carry no error.data', () => {
  test('malformed JSON produces a Parse error with id: null and no data field', async () => {
    const methods = fakeMethods();
    const { writeLine, lines } = collectLines();
    await handleRpcLine('{ not valid json', methods, writeLine);
    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed.id).toBeNull();
    expect(parsed.error.code).toBe(-32700);
    expect(parsed.error).not.toHaveProperty('data');
  });

  test('an unknown method produces a Method not found error with no data field', async () => {
    const methods = fakeMethods();
    const { writeLine, lines } = collectLines();
    await handleRpcLine('{"jsonrpc":"2.0","id":1,"method":"engine.doesNotExist","params":{}}', methods, writeLine);
    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed.error.code).toBe(-32601);
    expect(parsed.error).not.toHaveProperty('data');
  });

  test('params that fail zod validation produce an Invalid params error with no data field', async () => {
    const methods = fakeMethods();
    const { writeLine, lines } = collectLines();
    await handleRpcLine('{"jsonrpc":"2.0","id":1,"method":"engine.search","params":{"repoId":"too-short"}}', methods, writeLine);
    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed.error.code).toBe(-32602);
    expect(parsed.error).not.toHaveProperty('data');
  });
});

describe('handleRpcLine — the frozen domain-error convention', () => {
  test('a thrown DomainError puts the fully serialized AppError in error.data unchanged', async () => {
    const appError = { code: 'E_REPO_TOO_LARGE', message: 'This repository is too large to map in one pass', detail: '30000 files', path: '/x' };
    const methods = fakeMethods({ analyze: () => Promise.reject(new DomainError(appError)) });
    const { writeLine, lines } = collectLines();
    await handleRpcLine(
      '{"jsonrpc":"2.0","id":1,"method":"engine.analyze","params":{"repoPath":"/x","appDataDir":"/y","excludeGlobs":[],"isForceRefresh":false}}',
      methods,
      writeLine,
    );
    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed.error.data).toEqual(appError);
  });

  test('an unrecognized thrown Error carries no error.data, relying on the remote fallback', async () => {
    const methods = fakeMethods({ analyze: () => Promise.reject(new Error('boom, unexpected bug')) });
    const { writeLine, lines } = collectLines();
    await handleRpcLine(
      '{"jsonrpc":"2.0","id":1,"method":"engine.analyze","params":{"repoPath":"/x","appDataDir":"/y","excludeGlobs":[],"isForceRefresh":false}}',
      methods,
      writeLine,
    );
    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed.error).not.toHaveProperty('data');
    expect(parsed.error.message).toBe('boom, unexpected bug');
  });
});

describe('runServer', () => {
  async function* linesOf(...values: readonly string[]): AsyncGenerator<string> {
    for (const value of values) {
      yield value;
    }
  }

  test('processes every line and stops after a successful engine.shutdown, ignoring blank lines', async () => {
    const methods = fakeMethods();
    const { writeLine, lines } = collectLines();
    await runServer({
      methods,
      lines: linesOf(
        '{"jsonrpc":"2.0","id":1,"method":"engine.version","params":{}}',
        '',
        '{"jsonrpc":"2.0","id":2,"method":"engine.shutdown","params":{}}',
        '{"jsonrpc":"2.0","id":3,"method":"engine.version","params":{}}',
      ),
      writeLine,
    });
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? '').id).toBe(2);
  });
});

describe('readLines', () => {
  function streamFromChunks(chunks: readonly string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;
    return new ReadableStream({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
      },
    });
  }

  test('splits a single chunk containing multiple newline-delimited messages', async () => {
    const stream = streamFromChunks(['{"a":1}\n{"b":2}\n']);
    const collected: string[] = [];
    for await (const line of readLines(stream)) {
      collected.push(line);
    }
    expect(collected).toEqual(['{"a":1}', '{"b":2}']);
  });

  test('reassembles a message split across two chunks at the newline boundary', async () => {
    const stream = streamFromChunks(['{"a":1', '}\n{"b":2}\n']);
    const collected: string[] = [];
    for await (const line of readLines(stream)) {
      collected.push(line);
    }
    expect(collected).toEqual(['{"a":1}', '{"b":2}']);
  });

  test('yields a final line even without a trailing newline', async () => {
    const stream = streamFromChunks(['{"a":1}\n{"b":2}']);
    const collected: string[] = [];
    for await (const line of readLines(stream)) {
      collected.push(line);
    }
    expect(collected).toEqual(['{"a":1}', '{"b":2}']);
  });
});
