/**
 * @onboard/engine — the six sidecar JSON-RPC methods (Section 7.3), composed
 * from `analyze-method.ts` / `search-method.ts` / `read-file-method.ts` /
 * `snippets-method.ts`. Nothing in this file (or the modules it composes)
 * knows about JSON-RPC framing — that is `server.ts`'s job. Every method
 * either returns a contract-shaped result or throws a `DomainError`
 * (recognized failure) or a plain `Error` (unrecognized — `server.ts` falls
 * back to `E_ENGINE_CRASHED` for those, per the frozen error convention).
 */
import type {
  EngineAnalyzeParams,
  EngineAnalyzeResult,
  EngineProgress,
  EngineReadFileParams,
  EngineReadFileResult,
  EngineSearchParams,
  EngineSearchResult,
  EngineShutdownParams,
  EngineShutdownResult,
  EngineSnippetsParams,
  EngineSnippetsResult,
  EngineVersionParams,
  EngineVersionResult,
} from '@onboard/contract';
import { SCHEMA_VERSION } from '@onboard/contract';
import { SqliteCacheStore } from '../cache/sqlite-cache-store';
import type { CacheStore } from '../cache/cache-store';
import { runAnalyzeMethod } from './analyze-method';
import { runReadFileMethod } from './read-file-method';
import { runSearchMethod } from './search-method';
import { runSnippetsMethod } from './snippets-method';
import { createSessionStore, type SessionStore } from './session-store';

export interface EngineMethodsConfig {
  readonly engineVersion: string;
  readonly grammarsDir: string;
  readonly grammarFingerprint: string;
  readonly onProgress: (progress: EngineProgress) => void;
  /** DI seam for tests; defaults to a real `SqliteCacheStore` per repo. */
  readonly createCacheStore?: (dbFilePath: string) => CacheStore;
}

export interface EngineMethods {
  readonly version: (params: EngineVersionParams) => Promise<EngineVersionResult>;
  readonly analyze: (params: EngineAnalyzeParams) => Promise<EngineAnalyzeResult>;
  readonly search: (params: EngineSearchParams) => Promise<EngineSearchResult>;
  readonly readFile: (params: EngineReadFileParams) => Promise<EngineReadFileResult>;
  readonly snippets: (params: EngineSnippetsParams) => Promise<EngineSnippetsResult>;
  readonly shutdown: (params: EngineShutdownParams) => Promise<EngineShutdownResult>;
  /** Not an RPC method — lets `server.ts` close every open cache on shutdown. */
  readonly sessions: SessionStore;
}

/** Builds the six-method dispatch table `server.ts` routes JSON-RPC requests to. */
export function createEngineMethods(config: EngineMethodsConfig): EngineMethods {
  const sessions = createSessionStore();
  const createCacheStore = config.createCacheStore ?? ((dbFilePath: string) => new SqliteCacheStore(dbFilePath));

  return {
    sessions,

    version: () =>
      Promise.resolve({
        engineVersion: config.engineVersion,
        contractSchemaVersion: SCHEMA_VERSION,
        grammarFingerprint: config.grammarFingerprint,
      }),

    analyze: (params) =>
      runAnalyzeMethod(params, {
        grammarsDir: config.grammarsDir,
        engineVersion: config.engineVersion,
        createCacheStore,
        onProgress: config.onProgress,
        sessions,
      }),

    search: (params) => Promise.resolve(runSearchMethod(params, sessions)),

    readFile: (params) => Promise.resolve(runReadFileMethod(params, sessions)),

    snippets: (params) => Promise.resolve(runSnippetsMethod(params, sessions)),

    shutdown: () => {
      sessions.closeAll();
      return Promise.resolve({});
    },
  };
}
