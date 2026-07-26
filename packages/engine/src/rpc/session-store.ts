/**
 * @onboard/engine — per-`repoId` RPC session state.
 *
 * `engine.search` / `engine.readFile` / `engine.snippets` take a bare
 * `repoId` (Section 7.3's frozen `SearchRequest`/`EngineReadFileParams`
 * schemas), not a repo path or an open cache handle, so something has to
 * remember "the last successful `engine.analyze` for this `repoId`" across
 * calls within one long-lived sidecar process. This module is that memory;
 * it holds no JSON-RPC or transport concerns.
 */
import type { AnalysisResult as AnalysisResultValue } from '@onboard/contract';
import type { CacheStore } from '../cache/cache-store';
import type { KeywordMap } from '../search/keyword-map';

export interface RepoSession {
  readonly canonicalRoot: string;
  readonly cacheStore: CacheStore;
  readonly analysisResult: AnalysisResultValue;
  readonly keywordMap: KeywordMap;
}

export interface SessionStore {
  get(repoId: string): RepoSession | undefined;
  set(repoId: string, session: RepoSession): void;
  closeAll(): void;
}

/** Plain in-memory map, one process-lifetime instance per running sidecar. */
export function createSessionStore(): SessionStore {
  const sessions = new Map<string, RepoSession>();
  return {
    get(repoId) {
      return sessions.get(repoId);
    },
    set(repoId, session) {
      const previous = sessions.get(repoId);
      if (previous !== undefined && previous.cacheStore !== session.cacheStore) {
        previous.cacheStore.close();
      }
      sessions.set(repoId, session);
    },
    closeAll() {
      sessions.forEach((session) => {
        session.cacheStore.close();
      });
      sessions.clear();
    },
  };
}
