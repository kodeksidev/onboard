/**
 * @onboard/engine — "where is X?" search (Section 8.7).
 */
import { z } from 'zod';
import { SearchResponse, SymbolEntry } from '@onboard/contract';
import {
  EXPANSION_DECAY,
  LINE_HIT_PREVIEW_MAX_CHARS,
  MAX_LINE_HITS,
  MAX_SEARCH_CANDIDATES,
  MIN_SEARCH_TERM_LENGTH,
} from '../constants';
import { posixBasenameWithoutExt, splitPosixSegments } from '../util/posix-path';
import { byteCompare } from '../util/sort';
import { scoreFile, type FileMatchDetail, type TermWeight } from './ranking';
import type { KeywordMap } from './keyword-map';

export type SearchResponseValue = z.infer<typeof SearchResponse>;
export type SymbolEntryValue = z.infer<typeof SymbolEntry>;

export interface SearchFileRecord {
  readonly path: string;
  readonly classification: string;
  readonly importance: number;
}

export interface SearchSymbolRow {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly nameLower: string;
  readonly kind: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly isExported: boolean;
  readonly containerName: string | null;
  readonly signature: string | null;
}

export interface SearchTokenRow {
  readonly path: string;
  readonly count: number;
  readonly linesJson: string;
}

export interface SearchDataSource {
  readonly files: readonly SearchFileRecord[];
  symbolsForTerm(term: string): readonly SearchSymbolRow[];
  tokensForToken(term: string): readonly SearchTokenRow[];
  /** Full text of one file, for building `lineHits` previews on the final (limited) hits only. */
  readFileText(path: string): string | null;
}

interface TermExtraction {
  readonly terms: readonly string[];
  readonly droppedTerms: readonly string[];
}

function extractTerms(query: string): TermExtraction {
  const all = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 0);
  const dropped = new Set<string>();
  const kept: string[] = [];
  all.forEach((t) => {
    if (t.length < MIN_SEARCH_TERM_LENGTH) {
      dropped.add(t);
    } else {
      kept.push(t);
    }
  });
  return { terms: kept, droppedTerms: [...dropped].sort(byteCompare) };
}

function buildTermWeights(terms: readonly string[], keywordMap: KeywordMap): { weights: readonly TermWeight[]; expandedTerms: readonly string[] } {
  const weightByTerm = new Map<string, number>();
  terms.forEach((t) => weightByTerm.set(t, 1.0));
  const expandedSet = new Set<string>();
  terms.forEach((t) => {
    (keywordMap[t] ?? []).forEach((expanded) => {
      expandedSet.add(expanded);
      if (!weightByTerm.has(expanded)) {
        weightByTerm.set(expanded, EXPANSION_DECAY);
      }
    });
  });
  const weights = [...weightByTerm.entries()]
    .map(([term, weightFactor]) => ({ term, weightFactor }))
    .sort((a, b) => byteCompare(a.term, b.term));
  return { weights, expandedTerms: [...expandedSet].sort(byteCompare) };
}

interface GatheredData {
  readonly candidatePaths: readonly string[];
  readonly symbolsByPath: ReadonlyMap<string, readonly SearchSymbolRow[]>;
  readonly tokensByPath: ReadonlyMap<string, ReadonlyMap<string, SearchTokenRow>>;
}

function gatherCandidates(termWeights: readonly TermWeight[], dataSource: SearchDataSource): GatheredData {
  const candidatePaths = new Set<string>();
  const symbolsByPath = new Map<string, SearchSymbolRow[]>();
  const tokensByPath = new Map<string, Map<string, SearchTokenRow>>();

  termWeights.forEach(({ term }) => {
    dataSource.symbolsForTerm(term).forEach((sym) => {
      candidatePaths.add(sym.path);
      if (!symbolsByPath.has(sym.path)) {
        symbolsByPath.set(sym.path, []);
      }
      symbolsByPath.get(sym.path)?.push(sym);
    });
    dataSource.tokensForToken(term).forEach((tok) => {
      candidatePaths.add(tok.path);
      if (!tokensByPath.has(tok.path)) {
        tokensByPath.set(tok.path, new Map());
      }
      tokensByPath.get(tok.path)?.set(term, tok);
    });
  });

  dataSource.files.forEach((file) => {
    const baseLower = posixBasenameWithoutExt(file.path).toLowerCase();
    const segmentsLower = splitPosixSegments(file.path).map((s) => s.toLowerCase());
    const matches = termWeights.some(({ term }) => baseLower.includes(term) || segmentsLower.includes(term));
    if (matches) {
      candidatePaths.add(file.path);
    }
  });

  return {
    candidatePaths: [...candidatePaths].sort(byteCompare).slice(0, MAX_SEARCH_CANDIDATES),
    symbolsByPath,
    tokensByPath,
  };
}

interface ScoredHit {
  readonly path: string;
  readonly file: SearchFileRecord;
  readonly detail: FileMatchDetail;
}

function scoreCandidates(
  candidatePaths: readonly string[],
  termWeights: readonly TermWeight[],
  fileByPath: ReadonlyMap<string, SearchFileRecord>,
  gathered: GatheredData,
): readonly ScoredHit[] {
  const scored: ScoredHit[] = [];
  candidatePaths.forEach((path) => {
    const file = fileByPath.get(path);
    if (file === undefined) {
      return;
    }
    const symbolRows = gathered.symbolsByPath.get(path) ?? [];
    const tokenMap = gathered.tokensByPath.get(path);
    const tokenOccurrencesByTerm = new Map<string, number>();
    tokenMap?.forEach((row, term) => tokenOccurrencesByTerm.set(term, row.count));
    const detail = scoreFile(termWeights, {
      classification: file.classification,
      importance: file.importance,
      basenameWithoutExtLower: posixBasenameWithoutExt(path).toLowerCase(),
      pathSegmentsLower: splitPosixSegments(path).map((s) => s.toLowerCase()),
      symbols: symbolRows.map((s) => ({ nameLower: s.nameLower, isExported: s.isExported })),
      tokenOccurrencesByTerm,
    });
    scored.push({ path, file, detail });
  });
  return scored;
}

function pickBestSymbol(symbolRows: readonly SearchSymbolRow[], bestNameLower: string | null): SymbolEntryValue | null {
  if (bestNameLower === null) {
    return null;
  }
  const matches = symbolRows.filter((s) => s.nameLower === bestNameLower);
  if (matches.length === 0) {
    return null;
  }
  const chosen = matches.find((s) => s.isExported) ?? matches[0]!;
  return {
    id: chosen.id,
    name: chosen.name,
    kind: chosen.kind as SymbolEntryValue['kind'],
    path: chosen.path,
    startLine: chosen.startLine,
    endLine: chosen.endLine,
    isExported: chosen.isExported,
    containerName: chosen.containerName,
    signature: chosen.signature,
  };
}

function trimPreview(rawLine: string, terms: readonly string[]): string {
  const trimmed = rawLine.trim();
  if (trimmed.length <= LINE_HIT_PREVIEW_MAX_CHARS) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  const matchIndex = terms.reduce<number>((found, term) => (found !== -1 ? found : lower.indexOf(term)), -1);
  if (matchIndex === -1) {
    return trimmed.slice(0, LINE_HIT_PREVIEW_MAX_CHARS);
  }
  const half = Math.floor(LINE_HIT_PREVIEW_MAX_CHARS / 2);
  const start = Math.max(0, Math.min(matchIndex - half, trimmed.length - LINE_HIT_PREVIEW_MAX_CHARS));
  return trimmed.slice(start, start + LINE_HIT_PREVIEW_MAX_CHARS);
}

function buildLineHits(
  path: string,
  termWeights: readonly TermWeight[],
  tokensByPath: ReadonlyMap<string, ReadonlyMap<string, SearchTokenRow>>,
  readFileText: (p: string) => string | null,
): readonly { line: number; preview: string }[] {
  const tokenMap = tokensByPath.get(path);
  if (tokenMap === undefined) {
    return [];
  }
  const allLines = new Set<number>();
  termWeights.forEach(({ term }) => {
    const row = tokenMap.get(term);
    if (row === undefined) {
      return;
    }
    (JSON.parse(row.linesJson) as readonly number[]).forEach((line) => allLines.add(line));
  });
  const sortedLines = [...allLines].sort((a, b) => a - b).slice(0, MAX_LINE_HITS);
  const text = readFileText(path);
  const fileLines = text === null ? [] : text.split('\n');
  const terms = termWeights.map((t) => t.term);
  return sortedLines.map((line) => ({ line, preview: trimPreview(fileLines[line - 1] ?? '', terms) }));
}

function byHitOrder(a: ScoredHit, b: ScoredHit): number {
  if (a.detail.score !== b.detail.score) {
    return b.detail.score - a.detail.score;
  }
  if (a.file.importance !== b.file.importance) {
    return b.file.importance - a.file.importance;
  }
  return byteCompare(a.path, b.path);
}

/** Runs the full "where is X?" search per Section 8.7. */
export function search(
  query: string,
  limit: number,
  keywordMap: KeywordMap,
  dataSource: SearchDataSource,
) {
  const { terms, droppedTerms } = extractTerms(query);
  if (terms.length === 0) {
    return { query, expandedTerms: [], droppedTerms: [...droppedTerms], hits: [], totalCandidateCount: 0 };
  }

  const { weights, expandedTerms } = buildTermWeights(terms, keywordMap);
  const gathered = gatherCandidates(weights, dataSource);
  const fileByPath = new Map(dataSource.files.map((f) => [f.path, f] as const));
  const scored = scoreCandidates(gathered.candidatePaths, weights, fileByPath, gathered);
  const ranked = [...scored].sort(byHitOrder).slice(0, limit);

  const hits = ranked.map((hit) => ({
    path: hit.path,
    score: hit.detail.score,
    matchKinds: [...hit.detail.matchKinds],
    symbol: pickBestSymbol(gathered.symbolsByPath.get(hit.path) ?? [], hit.detail.bestSymbolNameLower),
    lineHits: [...buildLineHits(hit.path, weights, gathered.tokensByPath, dataSource.readFileText)],
    importance: hit.file.importance,
  }));

  return {
    query,
    expandedTerms: [...expandedTerms],
    droppedTerms: [...droppedTerms],
    hits,
    totalCandidateCount: gathered.candidatePaths.length,
  };
}
