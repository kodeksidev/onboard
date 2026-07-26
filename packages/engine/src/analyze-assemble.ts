/**
 * @onboard/engine — `analyze()`'s final assembly phase: `FileNode[]`,
 * `DirectoryNode[]`, `SymbolEntry[]`, stats, and the fingerprint. Split out
 * of `analyze.ts` to stay under the 50-line-per-function limit.
 */
import { stableStringify } from '@onboard/contract';
import type { ParsedFile } from './parse/language-parser';
import { buildDirectoryNodes } from './directories';
import { buildSymbolRows } from './index/symbol-index';
import { detectRepoType, computeLanguageStats } from './stack/detect-stack';
import { sha256Hex } from './util/hash';
import { byteCompare } from './util/sort';
import type { PreparedAnalysis } from './analyze';
import type { ComputedAnalysis } from './analyze-rank-phase';
import type { DiagnosticValue } from './analyze-support';

function byPathAsc<T extends { readonly path: string }>(a: T, b: T): number {
  return byteCompare(a.path, b.path);
}

function buildFileNodes(prepared: PreparedAnalysis, computed: ComputedAnalysis, parsedByPath: ReadonlyMap<string, ParsedFile>) {
  return prepared.classified
    .map((f) => ({
      path: f.path,
      language: f.language,
      classification: f.classification,
      moduleId: computed.moduleIdByPath.get(f.path) ?? null,
      sizeBytes: f.sizeBytes,
      lineCount: f.lineCount,
      contentHash: f.contentHash,
      symbolCount: parsedByPath.get(f.path)?.symbols.length ?? 0,
      inDegree: computed.graph.degrees.get(f.path)?.inDegree ?? 0,
      outDegree: computed.graph.degrees.get(f.path)?.outDegree ?? 0,
      pageRank: computed.graph.pageRank.get(f.path) ?? 0,
      importance: computed.importanceByPath.get(f.path)?.importance ?? 0,
      importanceRank: computed.importanceByPath.get(f.path)?.importanceRank ?? 0,
      isParsed: f.isParsed,
      skipReason: f.skipReason,
    }))
    .sort(byPathAsc);
}

function buildSymbolEntries(prepared: PreparedAnalysis, parsedByPath: ReadonlyMap<string, ParsedFile>) {
  return prepared.classified
    .flatMap((f) => buildSymbolRows(f.path, parsedByPath.get(f.path)?.symbols ?? []))
    .map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      path: row.path,
      startLine: row.startLine,
      endLine: row.endLine,
      isExported: row.isExported,
      containerName: row.container,
      signature: row.signature,
    }))
    .sort((a, b) => byteCompare(a.path, b.path) || a.startLine - b.startLine);
}

function buildDiagnostics(prepared: PreparedAnalysis, parseDiagnostics: readonly DiagnosticValue[]): readonly DiagnosticValue[] {
  return [
    ...prepared.walkResult.diagnostics.map(
      (d): DiagnosticValue => ({ severity: 'info', code: d.code, path: d.path, message: 'Skipped to break a symlink loop.' }),
    ),
    ...prepared.readDiagnostics,
    ...prepared.tsconfigDiagnostics.map(
      (d): DiagnosticValue => ({ severity: 'warning', code: d.code, path: d.path, message: 'tsconfig/jsconfig could not be read or parsed.' }),
    ),
    ...parseDiagnostics,
  ].sort((a, b) => byteCompare(a.code, b.code) || byteCompare(a.path ?? '', b.path ?? ''));
}

function buildRepoSection(prepared: PreparedAnalysis, computed: ComputedAnalysis, detectedType: string) {
  return {
    id: prepared.repoId,
    name: prepared.canonicalRoot.split(/[/\\]/).filter(Boolean).at(-1) ?? 'repo',
    rootPathHash: sha256Hex(prepared.canonicalRoot),
    detectedType,
    // '' is `computeModules`'s internal sentinel for "the repo root itself" (Section
    // 8.6's module derivation needs it as a candidate basis); it is never a valid
    // `RepoPath` (min length 1), so it is filtered out of the contract-facing field —
    // an implicit whole-repo root is represented by an EMPTY array, not `['']`.
    sourceRoots: [...computed.sourceRoots].filter((p) => p !== '').sort(byteCompare),
    workspacePackages: prepared.workspacePackages
      .map((p) => ({ name: p.name, dirPath: p.dirPath }))
      .sort((a, b) => byteCompare(a.dirPath, b.dirPath)),
  };
}

function buildStatsSection(prepared: PreparedAnalysis, computed: ComputedAnalysis, symbolCount: number) {
  return {
    filesScanned: prepared.classified.length,
    filesIgnored: prepared.walkResult.filesIgnoredCount,
    filesParsed: prepared.classified.filter((f) => f.isParsed).length,
    filesSkipped: prepared.classified.filter((f) => f.skipReason !== null).length,
    symbolCount,
    edgeCount: computed.resolution.edges.length,
    externalDependencyCount: computed.resolution.externalDependencies.length,
    unresolvedImportCount: computed.resolution.unresolvedImports.length,
    cycleCount: computed.cycles.length,
    orphanCount: computed.orphanPaths.length,
  };
}

function buildDependenciesWithCounts(prepared: PreparedAnalysis, computed: ComputedAnalysis) {
  return prepared.dependencies
    .map((dep) => ({
      ...dep,
      importedByCount: computed.resolution.externalImportedByPaths.get(`${dep.ecosystem}:${dep.name}`)?.size ?? 0,
    }))
    .sort((a, b) => byteCompare(a.name, b.name));
}

/** Assembles the full `AnalysisResult` (pre-`.parse()`) and computes its fingerprint. */
export function assembleAnalysisResult(
  prepared: PreparedAnalysis,
  computed: ComputedAnalysis,
  parsedByPath: ReadonlyMap<string, ParsedFile>,
  parseDiagnostics: readonly DiagnosticValue[],
) {
  const languages = computeLanguageStats(prepared.classified.map((f) => ({ language: f.language, lineCount: f.lineCount })));
  const detectedType = detectRepoType({
    manifests: prepared.manifests,
    dependencies: prepared.dependencies,
    workspacePackageCount: prepared.workspacePackages.length,
  });
  const symbols = buildSymbolEntries(prepared, parsedByPath);

  const resultWithoutFingerprint = {
    schemaVersion: 1 as const,
    fingerprint: '',
    repo: buildRepoSection(prepared, computed, detectedType),
    stats: buildStatsSection(prepared, computed, symbols.length),
    stack: {
      manifests: [...prepared.manifests].sort(byPathAsc),
      languages,
      dependencies: buildDependenciesWithCounts(prepared, computed),
    },
    entryPoints: [...prepared.entryPoints].sort((a, b) => a.rank - b.rank),
    files: buildFileNodes(prepared, computed, parsedByPath),
    directories: buildDirectoryNodes(prepared.classified.map((f) => ({ path: f.path, classification: f.classification }))),
    edges: [...computed.resolution.edges].sort(
      (a, b) => byteCompare(a.fromPath, b.fromPath) || a.line - b.line || byteCompare(a.specifier, b.specifier),
    ),
    externalDependencies: [...computed.resolution.externalDependencies].sort((a, b) => byteCompare(a.packageName, b.packageName)),
    unresolvedImports: [...computed.resolution.unresolvedImports].sort(
      (a, b) => byteCompare(a.fromPath, b.fromPath) || a.line - b.line,
    ),
    graph: { cycles: computed.cycles, orphanPaths: computed.orphanPaths, componentCount: computed.sccs.length },
    importantFilePaths: computed.importantFilePaths,
    roadmap: { steps: computed.roadmapSteps },
    modules: computed.modules,
    symbols,
    diagnostics: buildDiagnostics(prepared, parseDiagnostics),
  };

  const fingerprint = sha256Hex(stableStringify({ ...resultWithoutFingerprint, fingerprint: '' }));
  return { ...resultWithoutFingerprint, fingerprint };
}
