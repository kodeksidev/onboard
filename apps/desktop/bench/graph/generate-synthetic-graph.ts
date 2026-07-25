import type { AnalysisResult } from '@onboard/contract';

/**
 * Deterministic synthetic graph generator for `bench:graph` (Section 9 Phase
 * 8's gate names 1,000- and 5,000-node budgets; the real fixture has 24
 * files). `mulberry32` is a fixed, seeded PRNG — same seed, same graph,
 * every run, on every machine (the same determinism discipline the engine
 * itself uses, Section 8.8), so a bench regression is never explained away
 * by "the random graph was different this time."
 */
const SYNTHETIC_GRAPH_SEED = 0x0b0a4d;
const FILES_PER_DIRECTORY = 20;
const MODULE_COUNT = 12;
const MAX_OUTGOING_EDGES_PER_FILE = 3;

const CLASSIFICATIONS: readonly AnalysisResult['files'][number]['classification'][] = [
  'controller',
  'service',
  'model',
  'component',
  'hook',
  'util',
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function directoryPathFor(fileIndex: number): string {
  const moduleIndex = Math.floor(fileIndex / FILES_PER_DIRECTORY) % MODULE_COUNT;
  return `src/mod${moduleIndex}`;
}

function buildDirectories(fileCount: number): AnalysisResult['directories'] {
  const dirCount = Math.min(MODULE_COUNT, Math.ceil(fileCount / FILES_PER_DIRECTORY));
  const directories: AnalysisResult['directories'][number][] = [
    { path: 'src', parentPath: null, fileCount: 0, descendantFileCount: fileCount, dominantClassification: 'service' },
  ];
  for (let index = 0; index < dirCount; index += 1) {
    directories.push({
      path: `src/mod${index}`,
      parentPath: 'src',
      fileCount: FILES_PER_DIRECTORY,
      descendantFileCount: FILES_PER_DIRECTORY,
      dominantClassification: 'service',
    });
  }
  return directories;
}

function buildModules(): AnalysisResult['modules'] {
  return Array.from({ length: MODULE_COUNT }, (_unused, index) => ({
    id: `src-mod${index}`,
    name: `mod${index}`,
    dirPath: `src/mod${index}`,
    purposeByConvention: 'Synthetic bench module.',
    fileCount: FILES_PER_DIRECTORY,
    keyFilePaths: [],
    dependsOnModuleIds: [],
    dependedOnByModuleIds: [],
  }));
}

function buildFiles(fileCount: number, rng: () => number): AnalysisResult['files'] {
  return Array.from({ length: fileCount }, (_unused, index) => {
    const dirPath = directoryPathFor(index);
    const moduleIndex = Math.floor(index / FILES_PER_DIRECTORY) % MODULE_COUNT;
    const importance = rng();
    return {
      path: `${dirPath}/file${index}.ts`,
      language: 'ts' as const,
      classification: CLASSIFICATIONS[index % CLASSIFICATIONS.length] ?? 'util',
      moduleId: `src-mod${moduleIndex}`,
      sizeBytes: 1024,
      lineCount: 40,
      contentHash: index.toString(16).padStart(64, '0'),
      symbolCount: 1,
      inDegree: 0,
      outDegree: 0,
      pageRank: 0,
      importance,
      importanceRank: index + 1,
      isParsed: true,
      skipReason: null,
    };
  });
}

function buildEdges(files: AnalysisResult['files'], rng: () => number): AnalysisResult['edges'] {
  const edges: AnalysisResult['edges'] = [];
  files.forEach((file, index) => {
    if (index === 0) {
      return;
    }
    const edgeCount = Math.floor(rng() * (MAX_OUTGOING_EDGES_PER_FILE + 1));
    for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
      const targetIndex = Math.floor(rng() * index);
      const target = files[targetIndex];
      if (target === undefined) {
        continue;
      }
      edges.push({
        fromPath: file.path,
        toPath: target.path,
        specifier: `./${target.path}`,
        line: edgeIndex + 1,
        kind: 'static',
        isTypeOnly: false,
      });
    }
  });
  return edges;
}

/**
 * Builds a schema-shaped (not zod-validated — this is bench-only, never
 * shipped) `AnalysisResult` with `fileCount` files spread across
 * `MODULE_COUNT` synthetic directories and a deterministic DAG of import
 * edges. Every field `buildGraphElements` (`graph-model.ts`) and
 * `buildGraphStylesheet` actually read is populated realistically; fields
 * they never touch carry minimal valid placeholders.
 */
export function generateSyntheticResult(fileCount: number): AnalysisResult {
  const rng = mulberry32(SYNTHETIC_GRAPH_SEED + fileCount);
  const files = buildFiles(fileCount, rng);
  const edges = buildEdges(files, rng);

  return {
    schemaVersion: 1,
    fingerprint: '0'.repeat(64),
    repo: {
      id: '0000000000000000',
      name: 'synthetic-bench-repo',
      rootPathHash: '0'.repeat(64),
      detectedType: 'Synthetic bench fixture',
      sourceRoots: ['src'],
      workspacePackages: [],
    },
    stats: {
      filesScanned: fileCount,
      filesIgnored: 0,
      filesParsed: fileCount,
      filesSkipped: 0,
      symbolCount: fileCount,
      edgeCount: edges.length,
      externalDependencyCount: 0,
      unresolvedImportCount: 0,
      cycleCount: 0,
      orphanCount: 0,
    },
    stack: { manifests: [], languages: [], dependencies: [] },
    entryPoints: [],
    files,
    directories: buildDirectories(fileCount),
    edges,
    externalDependencies: [],
    unresolvedImports: [],
    graph: { cycles: [], orphanPaths: [], componentCount: 1 },
    importantFilePaths: files.slice(0, 20).map((file) => file.path),
    roadmap: { steps: [] },
    modules: buildModules(),
    symbols: [],
    diagnostics: [],
  };
}
