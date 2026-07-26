/**
 * @onboard/engine — per-file search scoring (Section 8.7 step 4).
 */
import {
  P_FIXTURE,
  P_GENERATED,
  P_TEST,
  SEARCH_SCORE_PRECISION,
  W_CONTENT_CAP,
  W_EXPORTED_BONUS,
  W_FILENAME_EXACT,
  W_FILENAME_SUBSTR,
  W_IMPORTANCE,
  W_PATH_SEGMENT,
  W_SYMBOL_EXACT,
  W_SYMBOL_PREFIX,
  W_SYMBOL_SUBSTRING,
} from '../constants';
import { roundFixed } from '../util/round';

export type MatchKind =
  | 'symbol-exact'
  | 'symbol-prefix'
  | 'symbol-substring'
  | 'filename-exact'
  | 'filename-substring'
  | 'path-segment'
  | 'content';

export interface TermWeight {
  readonly term: string;
  readonly weightFactor: number;
}

export interface ScoringSymbol {
  readonly nameLower: string;
  readonly isExported: boolean;
}

export interface FileScoringInput {
  readonly classification: string;
  readonly importance: number;
  readonly basenameWithoutExtLower: string;
  readonly pathSegmentsLower: readonly string[];
  readonly symbols: readonly ScoringSymbol[];
  /** Occurrence count (`token_index.count`) for this file, keyed by term. */
  readonly tokenOccurrencesByTerm: ReadonlyMap<string, number>;
}

export interface FileMatchDetail {
  readonly score: number;
  readonly matchKinds: readonly MatchKind[];
  /** The exported-preferring, highest-tier matching symbol name, if any term matched a symbol. */
  readonly bestSymbolNameLower: string | null;
}

interface SymbolTierResult {
  readonly points: number;
  readonly matchKind: MatchKind | null;
  readonly matchedNameLower: string | null;
  readonly isExported: boolean;
}

function scoreSymbolTier(term: string, symbols: readonly ScoringSymbol[]): SymbolTierResult {
  const exact = symbols.filter((s) => s.nameLower === term);
  if (exact.length > 0) {
    const best = exact.find((s) => s.isExported) ?? exact[0]!;
    return { points: W_SYMBOL_EXACT, matchKind: 'symbol-exact', matchedNameLower: best.nameLower, isExported: best.isExported };
  }
  const prefix = symbols.filter((s) => s.nameLower.startsWith(term));
  if (prefix.length > 0) {
    const best = prefix.find((s) => s.isExported) ?? prefix[0]!;
    return { points: W_SYMBOL_PREFIX, matchKind: 'symbol-prefix', matchedNameLower: best.nameLower, isExported: best.isExported };
  }
  const substring = symbols.filter((s) => s.nameLower.includes(term));
  if (substring.length > 0) {
    const best = substring.find((s) => s.isExported) ?? substring[0]!;
    return { points: W_SYMBOL_SUBSTRING, matchKind: 'symbol-substring', matchedNameLower: best.nameLower, isExported: best.isExported };
  }
  return { points: 0, matchKind: null, matchedNameLower: null, isExported: false };
}

interface FilenameTierResult {
  readonly points: number;
  readonly matchKind: MatchKind | null;
}

function scoreFilenameTier(term: string, basenameWithoutExtLower: string): FilenameTierResult {
  if (basenameWithoutExtLower === term) {
    return { points: W_FILENAME_EXACT, matchKind: 'filename-exact' };
  }
  if (basenameWithoutExtLower.includes(term)) {
    return { points: W_FILENAME_SUBSTR, matchKind: 'filename-substring' };
  }
  return { points: 0, matchKind: null };
}

interface TermScoreResult {
  readonly points: number;
  readonly matchKinds: readonly MatchKind[];
  readonly bestSymbolNameLower: string | null;
}

function scoreTerm(term: string, file: FileScoringInput): TermScoreResult {
  const matchKinds: MatchKind[] = [];
  const symbolTier = scoreSymbolTier(term, file.symbols);
  let points = symbolTier.points;
  if (symbolTier.matchKind !== null) {
    matchKinds.push(symbolTier.matchKind);
  }

  const filenameTier = scoreFilenameTier(term, file.basenameWithoutExtLower);
  points += filenameTier.points;
  if (filenameTier.matchKind !== null) {
    matchKinds.push(filenameTier.matchKind);
  }

  if (file.pathSegmentsLower.includes(term)) {
    points += W_PATH_SEGMENT;
    matchKinds.push('path-segment');
  }

  const occurrences = file.tokenOccurrencesByTerm.get(term) ?? 0;
  if (occurrences > 0) {
    points += Math.min(4 * Math.log2(1 + occurrences), W_CONTENT_CAP);
    matchKinds.push('content');
  }

  if (symbolTier.isExported) {
    points += W_EXPORTED_BONUS;
  }

  return { points, matchKinds, bestSymbolNameLower: symbolTier.matchedNameLower };
}

function classificationPenalty(classification: string): number {
  if (classification === 'test') {
    return P_TEST;
  }
  if (classification === 'generated') {
    return P_GENERATED;
  }
  return classification === 'fixture' ? P_FIXTURE : 0;
}

/** Scores one file against every (term, weightFactor) pair, per Section 8.7 step 4. */
export function scoreFile(terms: readonly TermWeight[], file: FileScoringInput): FileMatchDetail {
  let total = 0;
  const matchKindSet = new Set<MatchKind>();
  let bestSymbolNameLower: string | null = null;

  terms.forEach(({ term, weightFactor }) => {
    const termResult = scoreTerm(term, file);
    total += termResult.points * weightFactor;
    termResult.matchKinds.forEach((kind) => matchKindSet.add(kind));
    if (termResult.bestSymbolNameLower !== null) {
      bestSymbolNameLower = termResult.bestSymbolNameLower;
    }
  });

  total += W_IMPORTANCE * file.importance;
  total += classificationPenalty(file.classification);

  const matchKindOrder: readonly MatchKind[] = [
    'symbol-exact',
    'symbol-prefix',
    'symbol-substring',
    'filename-exact',
    'filename-substring',
    'path-segment',
    'content',
  ];
  return {
    score: roundFixed(Math.max(total, 0), SEARCH_SCORE_PRECISION),
    matchKinds: matchKindOrder.filter((kind) => matchKindSet.has(kind)),
    bestSymbolNameLower,
  };
}
