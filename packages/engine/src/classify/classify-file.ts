/**
 * @onboard/engine — file classification (Section 8.6).
 *
 * Rules 1-18 are evaluated top to bottom; the first matching rule wins.
 * "Segment matching is case-insensitive and considers every path segment,
 * checking the deepest segment first" (Section 8.6) is implemented as a
 * literal deepest-to-shallowest scan within each segment-based rule's own
 * membership check — a rule still fires purely on set membership, so this
 * scan direction is a literal reading of the spec's wording rather than a
 * reordering of rule priority (see docs/DECISIONS.md).
 */
import { posixBasename, posixDirname, posixExtLower, splitPosixSegments } from '../util/posix-path';
import {
  ASSET_EXTENSIONS,
  COMPONENT_SEGMENTS,
  CONFIG_EXTENSIONS,
  CONFIG_FILENAMES,
  CONFIG_SEGMENT,
  CONTROLLER_SEGMENTS,
  DOCS_EXTENSIONS,
  DOCS_SEGMENT,
  FIXTURE_SEGMENTS,
  GENERATED_BASENAME_INFIXES,
  GENERATED_HEADER_CHECK_LINES,
  GENERATED_HEADER_MARKERS,
  HOOK_BASENAME_PATTERN,
  HOOK_SEGMENT,
  MODEL_SEGMENTS,
  PASCAL_CASE_TSX_PATTERN,
  ROUTE_SEGMENTS,
  SCRIPT_SEGMENTS,
  SERVICE_SEGMENTS,
  STORE_SEGMENTS,
  STYLE_EXTENSIONS,
  TEST_BASENAME_PATTERNS,
  TEST_SEGMENT_PATTERN,
  UTIL_SEGMENTS,
} from '../constants';
import type { FileClassificationValue } from './convention-tables';

export interface ClassifyFileInput {
  /** Repo-relative POSIX path. */
  readonly path: string;
  /** Whether `path` was selected as an entry point (Section 8.6 rule 1). */
  readonly isEntryPoint: boolean;
  /** First lines of the file's content, for the `@generated` header check (rule 7). */
  readonly headerLines: readonly string[];
}

interface PathInfo {
  readonly dirSegmentsLower: readonly string[];
  readonly basename: string;
  readonly basenameLower: string;
  readonly extLower: string;
}

function buildPathInfo(path: string): PathInfo {
  const dir = posixDirname(path);
  const dirSegments = dir === '.' || dir === '' ? [] : splitPosixSegments(dir);
  const basename = posixBasename(path);
  return {
    dirSegmentsLower: dirSegments.map((segment) => segment.toLowerCase()),
    basename,
    basenameLower: basename.toLowerCase(),
    extLower: posixExtLower(path),
  };
}

/** Deepest-first scan for an exact (case-insensitive) segment match. */
function hasSegmentIn(dirSegmentsLower: readonly string[], set: readonly string[]): boolean {
  for (let i = dirSegmentsLower.length - 1; i >= 0; i -= 1) {
    if (set.includes(dirSegmentsLower[i] ?? '')) {
      return true;
    }
  }
  return false;
}

/** Deepest-first scan for a segment matching `pattern`. */
function hasSegmentMatching(dirSegmentsLower: readonly string[], pattern: RegExp): boolean {
  for (let i = dirSegmentsLower.length - 1; i >= 0; i -= 1) {
    if (pattern.test(dirSegmentsLower[i] ?? '')) {
      return true;
    }
  }
  return false;
}

function isTestFile(info: PathInfo): boolean {
  if (hasSegmentMatching(info.dirSegmentsLower, TEST_SEGMENT_PATTERN)) {
    return true;
  }
  return TEST_BASENAME_PATTERNS.some((pattern) => pattern.test(info.basename));
}

function isGeneratedFile(info: PathInfo, headerLines: readonly string[]): boolean {
  const headerText = headerLines.slice(0, GENERATED_HEADER_CHECK_LINES).join('\n');
  if (GENERATED_HEADER_MARKERS.some((marker) => headerText.includes(marker))) {
    return true;
  }
  return GENERATED_BASENAME_INFIXES.some((infix) => info.basenameLower.includes(`.${infix}.`));
}

function isConfigFile(info: PathInfo): boolean {
  if (CONFIG_FILENAMES.includes(info.basenameLower)) {
    return true;
  }
  if (CONFIG_EXTENSIONS.includes(info.extLower)) {
    return true;
  }
  return hasSegmentIn(info.dirSegmentsLower, [CONFIG_SEGMENT]);
}

/** Rules 8-16: one classification per directory-segment convention, in order. */
function classifyBySegmentRules(info: PathInfo): FileClassificationValue | null {
  if (hasSegmentIn(info.dirSegmentsLower, ROUTE_SEGMENTS)) {
    return 'route';
  }
  if (hasSegmentIn(info.dirSegmentsLower, CONTROLLER_SEGMENTS)) {
    return 'controller';
  }
  if (hasSegmentIn(info.dirSegmentsLower, SERVICE_SEGMENTS)) {
    return 'service';
  }
  if (hasSegmentIn(info.dirSegmentsLower, MODEL_SEGMENTS)) {
    return 'model';
  }
  if (hasSegmentIn(info.dirSegmentsLower, COMPONENT_SEGMENTS) || PASCAL_CASE_TSX_PATTERN.test(info.basename)) {
    return 'component';
  }
  if (HOOK_BASENAME_PATTERN.test(info.basename) || hasSegmentIn(info.dirSegmentsLower, [HOOK_SEGMENT])) {
    return 'hook';
  }
  if (hasSegmentIn(info.dirSegmentsLower, STORE_SEGMENTS)) {
    return 'store';
  }
  if (hasSegmentIn(info.dirSegmentsLower, UTIL_SEGMENTS)) {
    return 'util';
  }
  if (hasSegmentIn(info.dirSegmentsLower, SCRIPT_SEGMENTS)) {
    return 'script';
  }
  return null;
}

/** Classifies one file per Section 8.6's 18 ordered rules. */
export function classifyFile(input: ClassifyFileInput): FileClassificationValue {
  const info = buildPathInfo(input.path);

  if (input.isEntryPoint) {
    return 'entrypoint';
  }
  if (isTestFile(info)) {
    return 'test';
  }
  if (hasSegmentIn(info.dirSegmentsLower, FIXTURE_SEGMENTS)) {
    return 'fixture';
  }
  if (STYLE_EXTENSIONS.includes(info.extLower)) {
    return 'style';
  }
  if (DOCS_EXTENSIONS.includes(info.extLower) || hasSegmentIn(info.dirSegmentsLower, [DOCS_SEGMENT])) {
    return 'docs';
  }
  if (isConfigFile(info)) {
    return 'config';
  }
  if (isGeneratedFile(info, input.headerLines)) {
    return 'generated';
  }

  const segmentClassification = classifyBySegmentRules(info);
  if (segmentClassification !== null) {
    return segmentClassification;
  }
  if (ASSET_EXTENSIONS.includes(info.extLower)) {
    return 'asset';
  }
  return 'unknown';
}
