import type { AnalysisResult } from '@onboard/contract';

/**
 * Test-only synthetic `AnalysisResult` builder for lazy-materialization
 * tests (`collapse.test.ts`, `graph-model.test.ts`). Schema-shaped but NOT
 * zod-validated (same pragmatic choice `bench/graph/generate-synthetic-graph.ts`
 * makes for its own bench fixture — never shipped, only ever fed to
 * `graph-model.ts`/`collapse.ts` functions that read a handful of specific
 * fields).
 *
 * Builds a NESTED directory tree — `src`, `src/modN` (depth 2), and
 * `src/modN/nested` (depth 3) — rather than the flat one the bench fixture
 * uses, so tests can exercise "a directory nested inside another collapsed
 * directory stays hidden until ITS OWN parent is expanded," not just a
 * single collapse level.
 */

function buildFile(path: string, index: number): AnalysisResult['files'][number] {
  return {
    path,
    language: 'ts',
    classification: 'service',
    moduleId: null,
    sizeBytes: 100,
    lineCount: 10,
    contentHash: index.toString(16).padStart(64, '0'),
    symbolCount: 1,
    inDegree: 0,
    outDegree: 0,
    pageRank: 0,
    importance: 0.5,
    importanceRank: index + 1,
    isParsed: true,
    skipReason: null,
  };
}

interface DirectoriesAndFiles {
  readonly directories: AnalysisResult['directories'];
  readonly files: AnalysisResult['files'];
}

function buildModuleDirectory(modPath: string, filesPerModule: number): AnalysisResult['directories'][number] {
  return {
    path: modPath,
    parentPath: 'src',
    fileCount: 1,
    descendantFileCount: filesPerModule,
    dominantClassification: 'service',
  };
}

function buildNestedDirectory(nestedPath: string, modPath: string, filesPerModule: number): AnalysisResult['directories'][number] {
  return {
    path: nestedPath,
    parentPath: modPath,
    fileCount: filesPerModule - 1,
    descendantFileCount: filesPerModule - 1,
    dominantClassification: 'service',
  };
}

function buildDirectoriesAndFiles(moduleCount: number, filesPerModule: number): DirectoriesAndFiles {
  const directories: AnalysisResult['directories'][number][] = [
    {
      path: 'src',
      parentPath: null,
      fileCount: 0,
      descendantFileCount: moduleCount * filesPerModule,
      dominantClassification: 'service',
    },
  ];
  const files: AnalysisResult['files'][number][] = [];

  for (let moduleIndex = 0; moduleIndex < moduleCount; moduleIndex += 1) {
    const modPath = `src/mod${moduleIndex}`;
    const nestedPath = `${modPath}/nested`;
    directories.push(buildModuleDirectory(modPath, filesPerModule));
    directories.push(buildNestedDirectory(nestedPath, modPath, filesPerModule));

    files.push(buildFile(`${modPath}/index.ts`, files.length));
    for (let fileIndex = 1; fileIndex < filesPerModule; fileIndex += 1) {
      files.push(buildFile(`${nestedPath}/file${fileIndex}.ts`, files.length));
    }
  }

  return { directories, files };
}

/** A simple reading-order chain: each file "imports" the one built just before it. */
function buildSequentialEdges(files: AnalysisResult['files']): AnalysisResult['edges'] {
  const edges: AnalysisResult['edges'][number][] = [];
  for (let index = 1; index < files.length; index += 1) {
    const from = files[index];
    const to = files[index - 1];
    if (from === undefined || to === undefined) {
      continue;
    }
    edges.push({ fromPath: from.path, toPath: to.path, specifier: `./${to.path}`, line: 1, kind: 'static', isTypeOnly: false });
  }
  return edges;
}

export function buildLargeSyntheticResult(moduleCount: number, filesPerModule: number): AnalysisResult {
  const { directories, files } = buildDirectoriesAndFiles(moduleCount, filesPerModule);
  const edges = buildSequentialEdges(files);

  return {
    schemaVersion: 1,
    fingerprint: '0'.repeat(64),
    repo: {
      id: '0000000000000000',
      name: 'synthetic-lazy-fixture',
      rootPathHash: '0'.repeat(64),
      detectedType: 'Synthetic test fixture',
      sourceRoots: ['src'],
      workspacePackages: [],
    },
    stats: {
      filesScanned: files.length,
      filesIgnored: 0,
      filesParsed: files.length,
      filesSkipped: 0,
      symbolCount: files.length,
      edgeCount: edges.length,
      externalDependencyCount: 0,
      unresolvedImportCount: 0,
      cycleCount: 0,
      orphanCount: 0,
    },
    stack: { manifests: [], languages: [], dependencies: [] },
    entryPoints: [],
    files,
    directories,
    edges,
    externalDependencies: [],
    unresolvedImports: [],
    graph: { cycles: [], orphanPaths: [], componentCount: 1 },
    importantFilePaths: files.slice(0, 5).map((file) => file.path),
    roadmap: { steps: [] },
    modules: [],
    symbols: [],
    diagnostics: [],
  } as unknown as AnalysisResult;
}
