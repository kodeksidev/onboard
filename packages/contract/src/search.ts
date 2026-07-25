/**
 * @onboard/contract — Search contract (Section 7.2, FROZEN at Phase 1).
 *
 * Transcribed verbatim from the build spec. `SearchHit` and `SearchResponse`
 * are what the engine's `engine.search` RPC and the Rust `search_repo`
 * command both return unchanged.
 */
import { z } from 'zod';
import { RepoPath, SymbolEntry } from './analysis-result';

export const SearchRequest = z.object({
  repoId: z.string().length(16),
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(200).default(50),
});
export type SearchRequest = z.infer<typeof SearchRequest>;

export const SearchHit = z.object({
  path: RepoPath,
  score: z.number(), // 3 decimal places
  matchKinds: z.array(
    z.enum([
      'symbol-exact',
      'symbol-prefix',
      'symbol-substring',
      'filename-exact',
      'filename-substring',
      'path-segment',
      'content',
    ]),
  ),
  symbol: SymbolEntry.nullable(), // best-scoring symbol hit in this file
  lineHits: z
    .array(z.object({ line: z.number().int().min(1), preview: z.string().max(200) }))
    .max(5),
  importance: z.number().min(0).max(1),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchResponse = z.object({
  query: z.string(),
  expandedTerms: z.array(z.string()), // shown in the UI so ranking is explainable
  droppedTerms: z.array(z.string()), // terms < 3 chars, surfaced as a notice
  hits: z.array(SearchHit),
  totalCandidateCount: z.number().int().min(0),
});
export type SearchResponse = z.infer<typeof SearchResponse>;
