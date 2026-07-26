/**
 * @onboard/engine — newline-delimited JSON-RPC 2.0 stdio transport
 * (Section 7.3). This is the ONLY module that speaks JSON-RPC framing; it
 * has no domain knowledge beyond routing a method name to `EngineMethods`
 * and applying the frozen error convention documented at the top of
 * `domain-error.ts` / `docs/DECISIONS.md`.
 */
import { z } from 'zod';
import {
  ENGINE_RPC_METHODS,
  EngineAnalyzeParams,
  EngineReadFileParams,
  EngineSearchParams,
  EngineShutdownParams,
  EngineSnippetsParams,
  EngineVersionParams,
  type EngineRpcMethod,
} from '@onboard/contract';
import type { AppError } from '@onboard/contract';
import { DomainError } from './domain-error';
import type { EngineMethods } from './methods';

type JsonRpcId = string | number;

function isEngineRpcMethod(method: string): method is EngineRpcMethod {
  return (ENGINE_RPC_METHODS as readonly string[]).includes(method);
}

function successResponse(id: JsonRpcId, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

/** Builds one JSON-RPC error line. `data`, when present, is a fully serialized `AppError` (the frozen convention). */
function errorResponse(id: JsonRpcId | null, code: number, message: string, data?: AppError): string {
  const error = data === undefined ? { code, message } : { code, message, data };
  return JSON.stringify({ jsonrpc: '2.0', id, error });
}

interface ParsedRequest {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params: unknown;
}

type ParseOutcome = { readonly ok: true; readonly request: ParsedRequest } | { readonly ok: false; readonly id: JsonRpcId | null };

function parseRequestLine(line: string): ParseOutcome {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, id: null };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, id: null };
  }
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' || typeof obj.id === 'number' ? obj.id : null;
  if (typeof obj.method !== 'string') {
    return { ok: false, id };
  }
  return { ok: true, request: { id: id ?? '', method: obj.method, params: obj.params } };
}

async function callMethod(methods: EngineMethods, method: EngineRpcMethod, params: unknown): Promise<unknown> {
  switch (method) {
    case 'engine.version':
      return methods.version(EngineVersionParams.parse(params));
    case 'engine.analyze':
      return methods.analyze(EngineAnalyzeParams.parse(params));
    case 'engine.search':
      return methods.search(EngineSearchParams.parse(params));
    case 'engine.readFile':
      return methods.readFile(EngineReadFileParams.parse(params));
    case 'engine.snippets':
      return methods.snippets(EngineSnippetsParams.parse(params));
    case 'engine.shutdown':
      return methods.shutdown(EngineShutdownParams.parse(params));
  }
}

/**
 * Builds the wire-format error line for a thrown value. Only a recognized
 * `DomainError` carries `error.data` (an `AppError`) — protocol-level
 * failures (malformed JSON, unknown method, a params shape zod rejects, or
 * any other unrecognized exception) deliberately leave `data` absent and
 * rely on the Rust side's own documented fallback ("if data is absent...
 * falls back to a generic E_ENGINE_CRASHED and puts the raw remote string
 * in detail, never in the user-facing message") rather than this module
 * guessing at an `AppErrorCode` that doesn't actually fit.
 */
function buildErrorResponseForThrown(id: JsonRpcId, error: unknown): string {
  if (error instanceof DomainError) {
    return errorResponse(id, -32000, error.appError.message, error.appError);
  }
  if (error instanceof z.ZodError) {
    return errorResponse(id, -32602, 'Invalid params');
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorResponse(id, -32000, message);
}

export interface HandleLineResult {
  readonly shouldShutdown: boolean;
}

/** Handles exactly one already-trimmed, non-empty line. Never throws. */
export async function handleRpcLine(line: string, methods: EngineMethods, writeLine: (out: string) => void): Promise<HandleLineResult> {
  const parsed = parseRequestLine(line);
  if (!parsed.ok) {
    writeLine(errorResponse(parsed.id, -32700, 'Parse error'));
    return { shouldShutdown: false };
  }
  const { id, method, params } = parsed.request;
  if (!isEngineRpcMethod(method)) {
    writeLine(errorResponse(id, -32601, `Method not found: ${method}`));
    return { shouldShutdown: false };
  }
  try {
    const result = await callMethod(methods, method, params);
    writeLine(successResponse(id, result));
    return { shouldShutdown: method === 'engine.shutdown' };
  } catch (error) {
    writeLine(buildErrorResponseForThrown(id, error));
    return { shouldShutdown: false };
  }
}

export interface RunServerOptions {
  readonly methods: EngineMethods;
  readonly lines: AsyncIterable<string>;
  readonly writeLine: (out: string) => void;
}

/** Reads newline-delimited requests until EOF or a successful `engine.shutdown`. */
export async function runServer(options: RunServerOptions): Promise<void> {
  for await (const rawLine of options.lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const { shouldShutdown } = await handleRpcLine(line, options.methods, options.writeLine);
    if (shouldShutdown) {
      return;
    }
  }
}

/**
 * Splits an arbitrarily-chunked byte stream into newline-delimited text
 * lines. A JSON-RPC message is never guaranteed to arrive in one `read()`
 * chunk (or to be alone in one), so this buffers across chunks rather than
 * assuming one message per read.
 */
export async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
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
  } finally {
    reader.releaseLock();
  }
  if (buffer.length > 0) {
    yield buffer;
  }
}
