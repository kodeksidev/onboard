import type { AnalysisResult, SearchHit, SearchRequest, SearchResponse } from '@onboard/contract';

/**
 * A mock, client-side implementation of Section 8.7's ranking algorithm,
 * for `VITE_IPC=mock`'s `searchRepo`. It is deliberately a SIMPLIFICATION,
 * not a port: the real engine's `token_index` (content occurrences,
 * `W_CONTENT`) lives in `bun:sqlite` and is built from real file bytes —
 * this mock has no file content to index (the fixture carries metadata
 * only), so `W_CONTENT` is omitted and `lineHits` are derived from matching
 * symbols' real `startLine`s instead of a content scan. Every other weight
 * below is transcribed verbatim from Section 8.7 so ranking ORDER is
 * genuine, even though the absolute scores aren't bit-for-bit what the real
 * engine would produce.
 */
const MIN_SEARCH_TERM_LENGTH = 3;
const EXPANSION_DECAY = 0.6;
const W_SYMBOL_EXACT = 100;
const W_SYMBOL_PREFIX = 60;
const W_SYMBOL_SUBSTRING = 30;
const W_FILENAME_EXACT = 45;
const W_FILENAME_SUBSTR = 20;
const W_PATH_SEGMENT = 15;
const W_EXPORTED_BONUS = 8;
const W_IMPORTANCE = 25;
const P_TEST = -20;
const P_GENERATED = -30;
const P_FIXTURE = -15;
const MAX_LINE_HITS = 5;
const LINE_PREVIEW_MAX_CHARS = 200;
const SCORE_DECIMALS = 3;

/**
 * A small UI-side mirror of a few Section 8.7 KEYWORD_MAP entries — enough
 * to make `expandedTerms` genuine for common queries against this fixture.
 * The real, frozen KEYWORD_MAP is engine-owned
 * (`packages/engine/src/search/keyword-map.ts`); this mock never imports
 * across that process boundary.
 */
const MOCK_KEYWORD_MAP: Readonly<Record<string, readonly string[]>> = {
  auth: [
    'auth', 'login', 'logout', 'session', 'token', 'jwt', 'oauth',
    'credential', 'signin', 'authenticate', 'authorize', 'permission',
  ],
  payment: ['payment', 'pay', 'stripe', 'checkout', 'invoice', 'billing', 'charge', 'subscription', 'refund'],
  database: ['db', 'database', 'sql', 'query', 'orm', 'prisma', 'sequelize', 'sqlalchemy', 'migration', 'schema', 'repository'],
  routing: ['route', 'router', 'endpoint', 'path', 'url', 'handler', 'controller', 'view'],
  config: ['config', 'settings', 'env', 'environment', 'options', 'dotenv'],
  logging: ['log', 'logger', 'logging', 'winston', 'pino', 'tracing', 'telemetry'],
  error: ['error', 'exception', 'throw', 'catch', 'handler', 'fallback', 'retry'],
};

function tokenizeQuery(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 0);
}

function expandTerms(terms: readonly string[]): readonly string[] {
  const expanded = new Set<string>();
  terms.forEach((term) => {
    (MOCK_KEYWORD_MAP[term] ?? []).forEach((expandedTerm) => expanded.add(expandedTerm));
  });
  return [...expanded].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function basenameWithoutExt(path: string): string {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  const dotIndex = basename.lastIndexOf('.');
  return dotIndex <= 0 ? basename : basename.slice(0, dotIndex);
}

function pathSegments(path: string): readonly string[] {
  return path.split('/').slice(0, -1).map((segment) => segment.toLowerCase());
}

function roundFixed(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

type SymbolEntry = AnalysisResult['symbols'][number];
type FileNode = AnalysisResult['files'][number];

interface TermMatch {
  readonly score: number;
  readonly bestSymbol: SymbolEntry | null;
}

function matchSymbols(symbols: readonly SymbolEntry[], term: string): { score: number; best: SymbolEntry | null } {
  const exact = symbols.find((symbol) => symbol.name.toLowerCase() === term);
  if (exact !== undefined) {
    return { score: W_SYMBOL_EXACT, best: exact };
  }
  const prefix = symbols.find((symbol) => symbol.name.toLowerCase().startsWith(term));
  if (prefix !== undefined) {
    return { score: W_SYMBOL_PREFIX, best: prefix };
  }
  const substring = symbols.find((symbol) => symbol.name.toLowerCase().includes(term));
  if (substring !== undefined) {
    return { score: W_SYMBOL_SUBSTRING, best: substring };
  }
  return { score: 0, best: null };
}

function matchTerm(file: FileNode, fileSymbols: readonly SymbolEntry[], term: string): TermMatch {
  const symbolMatch = matchSymbols(fileSymbols, term);
  const basename = basenameWithoutExt(file.path).toLowerCase();
  const filenameScore = basename === term ? W_FILENAME_EXACT : basename.includes(term) ? W_FILENAME_SUBSTR : 0;
  const segmentScore = pathSegments(file.path).includes(term) ? W_PATH_SEGMENT : 0;
  const exportedBonus = symbolMatch.best?.isExported === true ? W_EXPORTED_BONUS : 0;
  return { score: symbolMatch.score + filenameScore + segmentScore + exportedBonus, bestSymbol: symbolMatch.best };
}

interface WeightedTerm {
  readonly term: string;
  readonly weightFactor: number;
}

function scoreFile(file: FileNode, fileSymbols: readonly SymbolEntry[], weightedTerms: readonly WeightedTerm[]): TermMatch {
  let total = 0;
  let bestSymbol: SymbolEntry | null = null;
  weightedTerms.forEach(({ term, weightFactor }) => {
    const match = matchTerm(file, fileSymbols, term);
    total += match.score * weightFactor;
    if (match.bestSymbol !== null && bestSymbol === null) {
      bestSymbol = match.bestSymbol;
    }
  });
  total += W_IMPORTANCE * file.importance;
  if (file.classification === 'test') total += P_TEST;
  if (file.classification === 'generated') total += P_GENERATED;
  if (file.classification === 'fixture') total += P_FIXTURE;
  return { score: roundFixed(Math.max(total, 0), SCORE_DECIMALS), bestSymbol };
}

function buildLineHits(fileSymbols: readonly SymbolEntry[], weightedTerms: readonly WeightedTerm[]): SearchHit['lineHits'] {
  const terms = weightedTerms.map((weighted) => weighted.term);
  const matching = fileSymbols
    .filter((symbol) => terms.some((term) => symbol.name.toLowerCase().includes(term)))
    .sort((a, b) => a.startLine - b.startLine)
    .slice(0, MAX_LINE_HITS);
  return matching.map((symbol) => ({
    line: symbol.startLine,
    preview: (symbol.signature ?? symbol.name).slice(0, LINE_PREVIEW_MAX_CHARS),
  }));
}

function hasAnyMatch(file: FileNode, fileSymbols: readonly SymbolEntry[], weightedTerms: readonly WeightedTerm[]): boolean {
  return weightedTerms.some(({ term }) => matchTerm(file, fileSymbols, term).score > 0);
}

function buildMatchKinds(file: FileNode, fileSymbols: readonly SymbolEntry[], weightedTerms: readonly WeightedTerm[]): SearchHit['matchKinds'] {
  const kinds = new Set<SearchHit['matchKinds'][number]>();
  const basename = basenameWithoutExt(file.path).toLowerCase();
  weightedTerms.forEach(({ term }) => {
    const symbolMatch = matchSymbols(fileSymbols, term);
    if (symbolMatch.score === W_SYMBOL_EXACT) kinds.add('symbol-exact');
    else if (symbolMatch.score === W_SYMBOL_PREFIX) kinds.add('symbol-prefix');
    else if (symbolMatch.score === W_SYMBOL_SUBSTRING) kinds.add('symbol-substring');
    if (basename === term) kinds.add('filename-exact');
    else if (basename.includes(term)) kinds.add('filename-substring');
    if (pathSegments(file.path).includes(term)) kinds.add('path-segment');
  });
  return [...kinds];
}

function compareHits(a: SearchHit, b: SearchHit): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.importance !== b.importance) return b.importance - a.importance;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** Section 8.7's `SEARCH(query, limit) -> SearchResponse`, simplified per this file's header comment. */
export function buildSearchResponse(result: AnalysisResult, request: SearchRequest): SearchResponse {
  const allTerms = tokenizeQuery(request.query);
  const directTerms = allTerms.filter((term) => term.length >= MIN_SEARCH_TERM_LENGTH);
  const droppedTerms = allTerms.filter((term) => term.length < MIN_SEARCH_TERM_LENGTH);

  if (directTerms.length === 0) {
    return { query: request.query, expandedTerms: [], droppedTerms, hits: [], totalCandidateCount: 0 };
  }

  const expandedTerms = expandTerms(directTerms);
  const weightedTerms: readonly WeightedTerm[] = [
    ...directTerms.map((term) => ({ term, weightFactor: 1 })),
    ...expandedTerms.map((term) => ({ term, weightFactor: EXPANSION_DECAY })),
  ];

  const symbolsByPath = new Map<string, SymbolEntry[]>();
  result.symbols.forEach((symbol) => {
    const existing = symbolsByPath.get(symbol.path) ?? [];
    symbolsByPath.set(symbol.path, [...existing, symbol]);
  });

  const candidates = result.files.filter((file) => hasAnyMatch(file, symbolsByPath.get(file.path) ?? [], weightedTerms));

  const hits: SearchHit[] = candidates.map((file) => {
    const fileSymbols = symbolsByPath.get(file.path) ?? [];
    const { score, bestSymbol } = scoreFile(file, fileSymbols, weightedTerms);
    return {
      path: file.path,
      score,
      matchKinds: buildMatchKinds(file, fileSymbols, weightedTerms),
      symbol: bestSymbol,
      lineHits: buildLineHits(fileSymbols, weightedTerms),
      importance: file.importance,
    };
  });

  const sorted = [...hits].sort(compareHits).slice(0, request.limit);

  return {
    query: request.query,
    expandedTerms: [...expandedTerms],
    droppedTerms: [...droppedTerms],
    hits: sorted,
    totalCandidateCount: candidates.length,
  };
}
