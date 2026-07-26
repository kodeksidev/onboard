/**
 * @onboard/engine — importance ranking, "most important files" (Section 8.4).
 */
import {
  ROLE_BOOST_ENTRYPOINT,
  ROLE_BOOST_HIGH,
  ROLE_BOOST_HIGH_CLASSIFICATIONS,
  ROLE_BOOST_LOW,
  ROLE_BOOST_LOW_CLASSIFICATIONS,
  ROLE_BOOST_MEDIUM,
  ROLE_BOOST_MEDIUM_CLASSIFICATIONS,
  TOP_IMPORTANT_FILES,
  W_IN_DEGREE,
  W_PAGERANK,
  W_ROLE,
} from '../constants';
import { roundFixed } from '../util/round';
import { byteCompare } from '../util/sort';

export interface ImportanceInput {
  readonly path: string;
  readonly isParsed: boolean;
  readonly classification: string;
  readonly pageRank: number;
  readonly inDegree: number;
  readonly lineCount: number;
}

export interface ImportanceResult {
  readonly path: string;
  readonly importance: number;
  readonly importanceRank: number;
}

export interface ImportanceOutput {
  readonly results: readonly ImportanceResult[];
  /** First `TOP_IMPORTANT_FILES` paths, importance desc — `AnalysisResult.importantFilePaths`. */
  readonly importantFilePaths: readonly string[];
}

function roleBoost(classification: string): number {
  if (classification === 'entrypoint') {
    return ROLE_BOOST_ENTRYPOINT;
  }
  if (ROLE_BOOST_HIGH_CLASSIFICATIONS.includes(classification)) {
    return ROLE_BOOST_HIGH;
  }
  if (ROLE_BOOST_MEDIUM_CLASSIFICATIONS.includes(classification)) {
    return ROLE_BOOST_MEDIUM;
  }
  if (ROLE_BOOST_LOW_CLASSIFICATIONS.includes(classification)) {
    return ROLE_BOOST_LOW;
  }
  return 0;
}

interface MinMax {
  readonly min: number;
  readonly max: number;
}

function minMaxOf(values: readonly number[]): MinMax {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function normalize(value: number, range: MinMax): number {
  return range.max === range.min ? 0 : (value - range.min) / (range.max - range.min);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function computeScore(file: ImportanceInput, pageRankRange: MinMax, inDegreeRange: MinMax): number {
  const score =
    W_PAGERANK * normalize(file.pageRank, pageRankRange) +
    W_IN_DEGREE * normalize(file.inDegree, inDegreeRange) +
    W_ROLE * roleBoost(file.classification);
  return clamp01(roundFixed(score, 6));
}

function compareForRank(a: ImportanceInput & { importance: number }, b: ImportanceInput & { importance: number }): number {
  if (a.isParsed !== b.isParsed) {
    return a.isParsed ? -1 : 1; // parsed files rank before every unparsed file
  }
  if (a.importance !== b.importance) {
    return b.importance - a.importance;
  }
  if (a.inDegree !== b.inDegree) {
    return b.inDegree - a.inDegree;
  }
  if (a.lineCount !== b.lineCount) {
    return b.lineCount - a.lineCount;
  }
  return byteCompare(a.path, b.path);
}

/** Computes `importance`/`importanceRank` for every file and the top-20 `importantFilePaths`. */
export function computeImportance(files: readonly ImportanceInput[]): ImportanceOutput {
  const parsedFiles = files.filter((f) => f.isParsed);
  const pageRankRange = minMaxOf(parsedFiles.map((f) => f.pageRank));
  const inDegreeRange = minMaxOf(parsedFiles.map((f) => f.inDegree));

  const withImportance = files.map((file) => ({
    ...file,
    importance: file.isParsed ? computeScore(file, pageRankRange, inDegreeRange) : 0,
  }));
  const ranked = [...withImportance].sort(compareForRank);

  const results: ImportanceResult[] = ranked.map((file, index) => ({
    path: file.path,
    importance: file.importance,
    importanceRank: index + 1,
  }));
  const importantFilePaths = ranked.slice(0, TOP_IMPORTANT_FILES).map((file) => file.path);
  return { results, importantFilePaths };
}
