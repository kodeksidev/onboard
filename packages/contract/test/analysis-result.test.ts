/**
 * Phase 1 gate tests for the frozen contract (Section 7.1).
 *
 * These assert the properties three parallel tracks are about to depend on:
 * the RepoPath regex (acceptance criterion 4), enum closure, the fixture's
 * validity, the fingerprint round-trip, and the documented sort order.
 */
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import {
  AnalysisEnvelope,
  AnalysisResult,
  Cycle,
  Diagnostic,
  EdgeKind,
  Ecosystem,
  EntryPoint,
  FileClassification,
  FileNode,
  Language,
  ManifestInfo,
  RepoPath,
  RoadmapStep,
  SCHEMA_VERSION,
  SymbolKind,
} from '../src/analysis-result';
import { SearchRequest, SearchResponse } from '../src/search';
import { AppError, AppErrorCode } from '../src/error';
import { EngineProgress, EngineReadFileParams, EngineVersionResult } from '../src/rpc';
import { stableStringify } from '../src/stable-stringify';
import { findCycleOrderViolations, findSortOrderViolations } from './sort-order';

import sampleAnalysis from '../fixtures/sample-analysis.json';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

describe('SCHEMA_VERSION', () => {
  test('is frozen at 1 for the v1 contract', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});

describe('RepoPath', () => {
  // Acceptance criterion 4: every emitted path is repo-relative POSIX.
  test.each([
    ['a simple relative file', 'src/index.ts'],
    ['a deeply nested file', 'apps/desktop/src/components/AppShell/AppShell.tsx'],
    ['a bare filename', 'README.md'],
    ['a dotfile', '.gitignore'],
    ['a path containing a space', 'src/my folder/file.ts'],
    ['a path with a dot segment that is not a prefix', 'src/a.b/c.ts'],
  ])('accepts %s', (_label, value) => {
    expect(RepoPath.safeParse(value).success).toBe(true);
  });

  test.each([
    ['a POSIX absolute path', '/etc/passwd'],
    ['a Windows drive path with backslashes', 'C:\\Users\\codex\\file.ts'],
    ['a relative path using backslashes', 'src\\index.ts'],
    ['a single backslash anywhere in the path', 'src/nested\\file.ts'],
    ['a "./"-prefixed path', './src/index.ts'],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(RepoPath.safeParse(value).success).toBe(false);
  });
});

describe('contract enums', () => {
  test.each([
    ['Language', Language, 'ts', 'rust'],
    ['FileClassification', FileClassification, 'service', 'middleware'],
    ['SymbolKind', SymbolKind, 'function', 'trait'],
    ['EdgeKind', EdgeKind, 'static', 'sideways'],
    ['Ecosystem', Ecosystem, 'npm', 'cargo'],
    ['AppErrorCode', AppErrorCode, 'E_PATH_NOT_FOUND', 'E_MADE_UP'],
  ])('%s accepts a known member and rejects an unknown one', (_label, schema, valid, invalid) => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse(invalid).success).toBe(false);
  });
});

describe('field-level constraints', () => {
  test('rejects a contentHash that is not 64 characters', () => {
    const result = FileNode.safeParse({
      path: 'src/index.ts',
      language: 'ts',
      classification: 'entrypoint',
      moduleId: null,
      sizeBytes: 10,
      lineCount: 2,
      contentHash: 'tooshort',
      symbolCount: 0,
      inDegree: 0,
      outDegree: 0,
      pageRank: 0,
      importance: 0,
      importanceRank: 1,
      isParsed: true,
      skipReason: null,
    });
    expect(result.success).toBe(false);
  });

  test('rejects an importance above 1', () => {
    const base = (sampleAnalysis.result.files[0] ?? {}) as Record<string, unknown>;
    expect(FileNode.safeParse({ ...base, importance: 1.5 }).success).toBe(false);
  });

  test('rejects an entry point with rank below 1', () => {
    const result = EntryPoint.safeParse({
      path: 'src/index.ts',
      rank: 0,
      evidence: 'package.json#main',
      kind: 'main',
    });
    expect(result.success).toBe(false);
  });

  test('rejects a cycle with fewer than two paths', () => {
    const result = Cycle.safeParse({ id: 'cycle-1', paths: ['src/a.ts'], edgeCount: 2 });
    expect(result.success).toBe(false);
  });

  test('rejects a roadmap step with an unknown section', () => {
    const base = (sampleAnalysis.result.roadmap.steps[0] ?? {}) as Record<string, unknown>;
    expect(RoadmapStep.safeParse({ ...base, section: 'epilogue' }).success).toBe(false);
  });

  test('rejects a manifest of an unknown kind', () => {
    const result = ManifestInfo.safeParse({
      path: 'Gemfile',
      kind: 'Gemfile',
      projectName: null,
      version: null,
      packageManager: null,
    });
    expect(result.success).toBe(false);
  });

  test('rejects a diagnostic with an unknown severity', () => {
    const result = Diagnostic.safeParse({
      severity: 'critical',
      code: 'PARSE_FAILED',
      path: null,
      message: 'x',
    });
    expect(result.success).toBe(false);
  });

  test('accepts a nullable path on a diagnostic', () => {
    const result = Diagnostic.safeParse({
      severity: 'info',
      code: 'CACHE_REBUILT',
      path: null,
      message: 'Cache rebuilt.',
    });
    expect(result.success).toBe(true);
  });
});

describe('search contract (Section 7.2)', () => {
  test('applies the documented default limit of 50', () => {
    const parsed = SearchRequest.parse({ repoId: '9f3c1a7b2e5d4086', query: 'auth' });
    expect(parsed.limit).toBe(50);
  });

  test('rejects a repoId that is not 16 characters', () => {
    expect(SearchRequest.safeParse({ repoId: 'abc', query: 'auth' }).success).toBe(false);
  });

  test('rejects a query longer than 200 characters', () => {
    const query = 'a'.repeat(201);
    expect(SearchRequest.safeParse({ repoId: '9f3c1a7b2e5d4086', query }).success).toBe(false);
  });

  test('rejects a limit above 200', () => {
    const request = { repoId: '9f3c1a7b2e5d4086', query: 'auth', limit: 201 };
    expect(SearchRequest.safeParse(request).success).toBe(false);
  });

  test('accepts a well-formed response with no hits', () => {
    const response = {
      query: 'zzz',
      expandedTerms: [],
      droppedTerms: ['db'],
      hits: [],
      totalCandidateCount: 0,
    };
    expect(SearchResponse.safeParse(response).success).toBe(true);
  });

  test('rejects a hit carrying more than five line hits', () => {
    const response = {
      query: 'auth',
      expandedTerms: [],
      droppedTerms: [],
      hits: [
        {
          path: 'src/index.ts',
          score: 1,
          matchKinds: ['content'],
          symbol: null,
          lineHits: Array.from({ length: 6 }, (_unused, index) => ({
            line: index + 1,
            preview: 'x',
          })),
          importance: 0.5,
        },
      ],
      totalCandidateCount: 1,
    };
    expect(SearchResponse.safeParse(response).success).toBe(false);
  });
});

describe('error envelope (Section 7)', () => {
  test('accepts an error with null detail and null path', () => {
    const error = {
      code: 'E_PATH_NOT_FOUND',
      message: 'That folder no longer exists',
      detail: null,
      path: null,
    };
    expect(AppError.safeParse(error).success).toBe(true);
  });

  test('rejects an error missing the detail field entirely', () => {
    const error = { code: 'E_PATH_NOT_FOUND', message: 'x', path: null };
    expect(AppError.safeParse(error).success).toBe(false);
  });
});

describe('sidecar RPC contract (Section 7.3)', () => {
  test('accepts a well-formed engine.version result', () => {
    const result = {
      engineVersion: '0.1.0',
      contractSchemaVersion: 1,
      grammarFingerprint: 'abc123',
    };
    expect(EngineVersionResult.safeParse(result).success).toBe(true);
  });

  test('rejects an engine.readFile param whose path is absolute', () => {
    const params = { repoId: '9f3c1a7b2e5d4086', path: '/etc/passwd', maxBytes: 1024 };
    expect(EngineReadFileParams.safeParse(params).success).toBe(false);
  });

  test('rejects a progress notification with an unknown phase', () => {
    const progress = { phase: 'compiling', processed: 1, total: 2, currentPath: null };
    expect(EngineProgress.safeParse(progress).success).toBe(false);
  });

  test('accepts a progress notification with a null currentPath', () => {
    const progress = { phase: 'walk', processed: 0, total: 24, currentPath: null };
    expect(EngineProgress.safeParse(progress).success).toBe(true);
  });
});

describe('sample-analysis.json fixture', () => {
  test('parses as a valid AnalysisEnvelope', () => {
    expect(() => AnalysisEnvelope.parse(sampleAnalysis)).not.toThrow();
  });

  test('parses as a valid AnalysisResult', () => {
    expect(() => AnalysisResult.parse(sampleAnalysis.result)).not.toThrow();
  });

  test('describes exactly 24 files, as the spec requires of this fixture', () => {
    expect(sampleAnalysis.result.files).toHaveLength(24);
  });

  test('stores a fingerprint that is the sha256 of its own canonical form', () => {
    // Arrange
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    const stored = parsed.fingerprint;

    // Act
    const recomputed = sha256Hex(stableStringify({ ...parsed, fingerprint: '' }));

    // Assert
    expect(recomputed).toBe(stored);
  });

  test('obeys every documented array sort order', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    expect(findSortOrderViolations(parsed)).toEqual([]);
  });

  test('orders cycles by edgeCount descending then first path ascending', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    expect(findCycleOrderViolations(parsed)).toEqual([]);
  });

  test('emits no absolute path, drive letter, or backslash anywhere', () => {
    // Acceptance criterion 4, enforced against the whole document at once.
    const serialized = stableStringify(sampleAnalysis.result);
    const offenders = [...serialized.matchAll(/"[^"]*"/g)]
      .map((match) => match[0].slice(1, -1))
      .filter(
        (value) => value.includes('\\') || /^[A-Za-z]:\//.test(value) || value.startsWith('/'),
      );
    expect(offenders).toEqual([]);
  });

  test('reports stats that agree with the arrays they summarize', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    expect(parsed.stats.filesScanned).toBe(parsed.files.length);
    expect(parsed.stats.symbolCount).toBe(parsed.symbols.length);
    expect(parsed.stats.edgeCount).toBe(parsed.edges.length);
    expect(parsed.stats.cycleCount).toBe(parsed.graph.cycles.length);
    expect(parsed.stats.orphanCount).toBe(parsed.graph.orphanPaths.length);
    expect(parsed.stats.unresolvedImportCount).toBe(parsed.unresolvedImports.length);
    expect(parsed.stats.externalDependencyCount).toBe(parsed.externalDependencies.length);
    expect(parsed.stats.filesParsed + parsed.stats.filesSkipped).toBe(parsed.files.length);
  });

  test('assigns dense, unique importance ranks starting at 1', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    const ranks = parsed.files.map((file) => file.importanceRank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: parsed.files.length }, (_unused, i) => i + 1));
  });

  test('lists importantFilePaths in descending importance order', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    const importanceOf = new Map(parsed.files.map((file) => [file.path, file.importance]));
    const importances = parsed.importantFilePaths.map((path) => importanceOf.get(path) ?? 0);
    const descending = [...importances].sort((a, b) => b - a);
    expect(importances).toEqual(descending);
  });

  test('references only files that exist in the file list', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    const known = new Set(parsed.files.map((file) => file.path));
    const referenced = [
      ...parsed.edges.flatMap((edge) => [edge.fromPath, edge.toPath]),
      ...parsed.entryPoints.map((entry) => entry.path),
      ...parsed.symbols.map((symbol) => symbol.path),
      ...parsed.graph.orphanPaths,
      ...parsed.graph.cycles.flatMap((cycle) => cycle.paths),
      ...parsed.roadmap.steps.map((step) => step.path),
      ...parsed.importantFilePaths,
    ];
    expect(referenced.filter((path) => !known.has(path))).toEqual([]);
  });

  test('covers every roadmap section so the UI can render each variant', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    const sections = new Set(parsed.roadmap.steps.map((step) => step.section));
    expect([...sections].sort()).toEqual([
      'core',
      'entry',
      'leaf-utility',
      'supporting',
      'unreached',
    ]);
  });

  test('contains at least one cycle, one orphan, and one unresolved import', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    expect(parsed.graph.cycles.length).toBeGreaterThan(0);
    expect(parsed.graph.orphanPaths.length).toBeGreaterThan(0);
    expect(parsed.unresolvedImports.length).toBeGreaterThan(0);
  });

  test('rotates each cycle so its lexicographically smallest path is first', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    for (const cycle of parsed.graph.cycles) {
      const smallest = [...cycle.paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
      expect(cycle.paths[0]).toBe(smallest);
    }
  });

  test('marks the skipped file as unparsed with a skipReason', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    const skipped = parsed.files.filter((file) => !file.isParsed);
    expect(skipped.length).toBeGreaterThan(0);
    for (const file of skipped) {
      expect(file.skipReason).not.toBeNull();
      expect(file.importance).toBe(0);
    }
  });

  test('gives every parsed file a null skipReason', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    for (const file of parsed.files.filter((file) => file.isParsed)) {
      expect(file.skipReason).toBeNull();
    }
  });

  test('points every file moduleId at a module that exists', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    const moduleIds = new Set(parsed.modules.map((module) => module.id));
    const dangling = parsed.files
      .map((file) => file.moduleId)
      .filter((id): id is string => id !== null && !moduleIds.has(id));
    expect(dangling).toEqual([]);
  });

  test('exposes at least three module cards for the module map', () => {
    expect(sampleAnalysis.result.modules.length).toBeGreaterThanOrEqual(3);
  });

  test('never emits an absolute repo path, only a hash of one', () => {
    const parsed = AnalysisResult.parse(sampleAnalysis.result);
    expect(parsed.repo.rootPathHash).toHaveLength(64);
    expect(JSON.stringify(parsed.repo)).not.toContain('C:');
  });
});

describe('AnalysisEnvelope', () => {
  test('keeps timings outside the fingerprinted result', () => {
    const parsed = AnalysisEnvelope.parse(sampleAnalysis);
    expect(parsed.timings.totalMs).toBeGreaterThan(0);
    expect(Object.keys(parsed.result)).not.toContain('timings');
  });

  test('rejects an envelope whose result fails validation', () => {
    const broken = {
      ...sampleAnalysis,
      result: { ...sampleAnalysis.result, schemaVersion: 2 },
    };
    expect(AnalysisEnvelope.safeParse(broken).success).toBe(false);
  });
});
