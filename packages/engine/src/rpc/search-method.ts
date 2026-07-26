/**
 * @onboard/engine — `engine.search` RPC method (Section 7.3, Section 8.7).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineSearchParams, EngineSearchResult } from '@onboard/contract';
import type { CacheStore, SymbolRow } from '../cache/cache-store';
import { search, type SearchDataSource, type SearchSymbolRow } from '../search/search';
import { noAnalysisMessage } from './error-copy';
import { domainError } from './domain-error';
import type { RepoSession, SessionStore } from './session-store';

function toSearchSymbolRow(row: SymbolRow): SearchSymbolRow {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    nameLower: row.nameLower,
    kind: row.kind,
    startLine: row.startLine,
    endLine: row.endLine,
    isExported: row.isExported,
    containerName: row.container,
    signature: row.signature,
  };
}

function buildDataSource(session: RepoSession, cacheStore: CacheStore): SearchDataSource {
  return {
    files: session.analysisResult.files.map((f) => ({
      path: f.path,
      classification: f.classification,
      importance: f.importance,
    })),
    symbolsForTerm: (term) => cacheStore.querySymbolsByTermSubstring(term).map(toSearchSymbolRow),
    tokensForToken: (term) => cacheStore.queryTokensByToken(term),
    readFileText: (path) => {
      try {
        return readFileSync(join(session.canonicalRoot, path), 'utf8');
      } catch {
        return null;
      }
    },
  };
}

export function runSearchMethod(params: EngineSearchParams, sessions: SessionStore): EngineSearchResult {
  const session = sessions.get(params.repoId);
  if (session === undefined) {
    const { message, detail } = noAnalysisMessage();
    throw domainError('E_NO_ANALYSIS', message, detail, null);
  }
  const dataSource = buildDataSource(session, session.cacheStore);
  return search(params.query, params.limit, session.keywordMap, dataSource);
}
