/**
 * @onboard/engine — `analyze()`: walk -> hash -> classify -> parse -> resolve
 * -> graph -> rank -> assemble a validated `AnalysisResult` (Section 9 Phase 4).
 *
 * This is the first place every earlier phase's pieces are wired together
 * end to end. It is the composition root — nothing here is meant to be
 * reused piecemeal; per-concern logic lives in the modules it imports. Split
 * across `analyze.ts` (orchestration) and `analyze-support.ts`/`analyze-assemble.ts`
 * (phase implementations) to stay under the 800-line / 50-line-per-function
 * limits a single monolithic file could not meet.
 */
import { realpathSync } from 'node:fs';
import { AnalysisResult, SCHEMA_VERSION } from '@onboard/contract';
import type { AnalysisResult as AnalysisResultValue } from '@onboard/contract';
import { walk, type WalkFs } from './walk/walk';
import { classifyFile } from './classify/classify-file';
import { discoverWorkspacePackages, type WorkspacePackage } from './resolve/workspaces';
import { discoverTsconfigs } from './resolve/tsconfig-paths';
import { discoverPackageImports, type NodeResolutionContext } from './resolve/node-resolution';
import { discoverPythonPackageRoots, type PythonResolutionContext } from './resolve/python-resolution';
import type { ResolverContext } from './resolve/resolve-import';
import { PYTHON_STDLIB_MODULES } from './resolve/python-stdlib';
import { detectManifests, type DependencyInfoValue, type ManifestInfoValue } from './stack/manifests';
import { detectEntryPoints, type EntryPointValue } from './stack/entry-points';
import { computeRepoId } from './util/hash';
import type { CacheStore } from './cache/cache-store';
import { processOneFile, readFileText, runParsePhase, type DiagnosticValue, type ProcessedFile } from './analyze-support';
import { computeGraphAndRanking, type ComputedAnalysis } from './analyze-rank-phase';
import { assembleAnalysisResult } from './analyze-assemble';

export interface AnalyzeOptions {
  readonly repoRootAbs: string;
  readonly excludeGlobs?: readonly string[];
  readonly grammarsDir: string;
  readonly engineVersion: string;
  readonly cacheStore?: CacheStore;
  /**
   * Test/verification-only override for the walk's filesystem access (e.g.
   * `scripts/verify-determinism.ts`'s shuffled-`readdir` check, Section 8.8).
   * Never set by the sidecar in normal operation.
   */
  readonly walkFs?: Partial<WalkFs>;
}

export type ClassificationValue = AnalysisResultValue['files'][number]['classification'];

export interface ClassifiedFile extends ProcessedFile {
  readonly classification: ClassificationValue;
}

export interface PreparedAnalysis {
  readonly canonicalRoot: string;
  readonly repoId: string;
  readonly walkResult: ReturnType<typeof walk>;
  readonly readDiagnostics: readonly DiagnosticValue[];
  readonly workspacePackages: readonly WorkspacePackage[];
  readonly entryPoints: readonly EntryPointValue[];
  readonly classified: readonly ClassifiedFile[];
  readonly processedFiles: readonly ProcessedFile[];
  readonly manifests: readonly ManifestInfoValue[];
  readonly dependencies: readonly DependencyInfoValue[];
  readonly resolverContext: ResolverContext;
  readonly tsconfigDiagnostics: readonly { readonly code: string; readonly path: string }[];
}

function processAllFiles(
  repoRootAbs: string,
  walkFiles: readonly { path: string; sizeBytes: number }[],
): { files: readonly ProcessedFile[]; diagnostics: readonly DiagnosticValue[] } {
  const files: ProcessedFile[] = [];
  const diagnostics: DiagnosticValue[] = [];
  walkFiles.forEach((f) => {
    const { file, diagnostic } = processOneFile(repoRootAbs, f.path, f.sizeBytes);
    files.push(file);
    if (diagnostic !== null) {
      diagnostics.push(diagnostic);
    }
  });
  return { files, diagnostics };
}

function buildResolverContext(
  existingPaths: ReadonlySet<string>,
  readFile: (p: string) => string | null,
  workspacePackages: readonly WorkspacePackage[],
  pyManifestNames: ReadonlySet<string>,
): { context: ResolverContext; tsconfigDiagnostics: PreparedAnalysis['tsconfigDiagnostics'] } {
  const tsconfigPaths = [...existingPaths].filter(
    (p) => p === 'tsconfig.json' || p === 'jsconfig.json' || p.endsWith('/tsconfig.json') || p.endsWith('/jsconfig.json'),
  );
  const tsconfigDiscovery = discoverTsconfigs({ tsconfigPaths, readFile });
  const packageImports = discoverPackageImports(existingPaths, readFile);
  const pythonPackageRoots = discoverPythonPackageRoots({ existingPaths, readFile });
  const directories = new Set<string>(['']);
  existingPaths.forEach((p) => {
    if (p.includes('/')) {
      directories.add(p.slice(0, p.lastIndexOf('/')));
    }
  });

  const node: NodeResolutionContext = {
    existingPathSet: existingPaths,
    tsconfigs: tsconfigDiscovery.configs,
    packageImports,
    workspacePackages,
  };
  const python: PythonResolutionContext = {
    existingPathSet: existingPaths,
    directories,
    packageRoots: pythonPackageRoots,
    stdlibModules: PYTHON_STDLIB_MODULES,
    manifestPackageNames: pyManifestNames,
  };
  return { context: { node, python }, tsconfigDiagnostics: tsconfigDiscovery.diagnostics };
}

/** Walk, hash/skip/classify, and stack/resolver-context discovery — everything before parsing. */
function prepareAnalysis(options: AnalyzeOptions): PreparedAnalysis {
  const canonicalRoot = realpathSync(options.repoRootAbs);
  const repoId = computeRepoId(canonicalRoot);
  const walkResult = walk(options.repoRootAbs, {
    ...(options.excludeGlobs === undefined ? {} : { excludeGlobs: options.excludeGlobs }),
    ...(options.walkFs === undefined ? {} : { fs: options.walkFs }),
  });
  const existingPaths = new Set(walkResult.files.map((f) => f.path));
  const readFile = (relPosix: string): string | null => readFileText(options.repoRootAbs, relPosix);

  const { files: processedFiles, diagnostics: readDiagnostics } = processAllFiles(options.repoRootAbs, walkResult.files);

  const workspacePackages = discoverWorkspacePackages({ existingPaths, readFile });
  const entryPoints = detectEntryPoints({ existingPaths, readFile, workspacePackages });
  const entryPointPaths = new Set(entryPoints.map((e) => e.path));

  const classified: ClassifiedFile[] = processedFiles.map((f) => ({
    ...f,
    classification: classifyFile({
      path: f.path,
      isEntryPoint: entryPointPaths.has(f.path),
      headerLines: f.headerLines,
    }) as ClassificationValue,
  }));

  const { manifests, dependencies } = detectManifests({ existingPaths, readFile });
  const pyManifestNames = new Set(dependencies.filter((d) => d.ecosystem === 'pypi').map((d) => d.name));
  const { context: resolverContext, tsconfigDiagnostics } = buildResolverContext(
    existingPaths,
    readFile,
    workspacePackages,
    pyManifestNames,
  );

  return {
    canonicalRoot,
    repoId,
    walkResult,
    readDiagnostics,
    workspacePackages,
    entryPoints,
    classified,
    processedFiles,
    manifests,
    dependencies,
    resolverContext,
    tsconfigDiagnostics,
  };
}

/** Runs the full walk -> parse -> resolve -> graph -> rank pipeline, returning a validated `AnalysisResult`. */
export async function analyze(options: AnalyzeOptions): Promise<AnalysisResultValue> {
  const prepared = prepareAnalysis(options);
  const { parsedByPath, diagnostics: parseDiagnostics } = await runParsePhase(
    prepared.processedFiles,
    options.grammarsDir,
    options.engineVersion,
    SCHEMA_VERSION,
    options.cacheStore,
  );
  const computed: ComputedAnalysis = computeGraphAndRanking(prepared, parsedByPath);
  const finalResult = assembleAnalysisResult(prepared, computed, parsedByPath, parseDiagnostics);
  return AnalysisResult.parse(finalResult);
}
