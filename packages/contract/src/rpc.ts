/**
 * @onboard/contract — Sidecar JSON-RPC contract (Section 7.3, FROZEN at Phase 1).
 *
 * Newline-delimited JSON-RPC 2.0 over stdio between the Rust shell and the
 * engine sidecar. Each `Engine<Method>Params` / `Engine<Method>Result` pair
 * below transcribes one row of Section 7.3's table. `EngineProgress` is the
 * `engine.progress` notification payload.
 */
import { z } from 'zod';
import { AnalysisEnvelope, Language, RepoPath } from './analysis-result';
import { SearchRequest, SearchResponse } from './search';

// engine.version — called at spawn; a mismatch aborts with E_ENGINE_VERSION_MISMATCH.
export const EngineVersionParams = z.object({});
export type EngineVersionParams = z.infer<typeof EngineVersionParams>;

export const EngineVersionResult = z.object({
  engineVersion: z.string(),
  contractSchemaVersion: z.number().int(),
  grammarFingerprint: z.string(),
});
export type EngineVersionResult = z.infer<typeof EngineVersionResult>;

// engine.analyze — emits engine.progress notifications while running.
export const EngineAnalyzeParams = z.object({
  repoPath: z.string().min(1),
  appDataDir: z.string().min(1),
  excludeGlobs: z.array(z.string()),
  isForceRefresh: z.boolean(),
});
export type EngineAnalyzeParams = z.infer<typeof EngineAnalyzeParams>;

export const EngineAnalyzeResult = AnalysisEnvelope;
export type EngineAnalyzeResult = z.infer<typeof EngineAnalyzeResult>;

// engine.search — requires a completed analysis for repoId.
export const EngineSearchParams = SearchRequest;
export type EngineSearchParams = z.infer<typeof EngineSearchParams>;

export const EngineSearchResult = SearchResponse;
export type EngineSearchResult = z.infer<typeof EngineSearchResult>;

// engine.readFile — path is confined to the repo root; '..' and escaping
// symlinks are rejected by the engine before this ever resolves.
export const EngineReadFileParams = z.object({
  repoId: z.string().length(16),
  path: RepoPath,
  maxBytes: z.number().int().min(1),
});
export type EngineReadFileParams = z.infer<typeof EngineReadFileParams>;

export const EngineReadFileResult = z.object({
  path: RepoPath,
  language: Language,
  lineCount: z.number().int().min(0),
  isTruncated: z.boolean(),
  content: z.string(),
});
export type EngineReadFileResult = z.infer<typeof EngineReadFileResult>;

// engine.snippets — the only source of text the AI path may use.
export const EngineSnippetsParams = z.object({
  repoId: z.string().length(16),
  paths: z.array(RepoPath),
  maxLinesPerFile: z.number().int().min(1),
  maxBytesPerFile: z.number().int().min(1),
});
export type EngineSnippetsParams = z.infer<typeof EngineSnippetsParams>;

export const EngineSnippetsResult = z.object({
  snippets: z.array(
    z.object({
      path: RepoPath,
      startLine: z.number().int().min(1),
      endLine: z.number().int().min(1),
      content: z.string(),
    }),
  ),
});
export type EngineSnippetsResult = z.infer<typeof EngineSnippetsResult>;

// engine.shutdown — flushes SQLite WAL and exits 0.
export const EngineShutdownParams = z.object({});
export type EngineShutdownParams = z.infer<typeof EngineShutdownParams>;

export const EngineShutdownResult = z.object({});
export type EngineShutdownResult = z.infer<typeof EngineShutdownResult>;

/** Notification `engine.progress`, emitted at most every 100 ms. */
export const EngineProgress = z.object({
  phase: z.enum(['walk', 'parse', 'resolve', 'graph', 'rank', 'persist']),
  processed: z.number().int().min(0),
  total: z.number().int().min(0),
  currentPath: z.string().nullable(),
});
export type EngineProgress = z.infer<typeof EngineProgress>;

/** The closed set of sidecar JSON-RPC method names, for reference by callers. */
export const ENGINE_RPC_METHODS = [
  'engine.version',
  'engine.analyze',
  'engine.search',
  'engine.readFile',
  'engine.snippets',
  'engine.shutdown',
] as const;
export type EngineRpcMethod = (typeof ENGINE_RPC_METHODS)[number];
