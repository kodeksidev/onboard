/**
 * Authors `fixtures/sample-analysis.json` (Phase 1 deliverable).
 *
 * --- WHAT THIS IS NOT ---
 * This is NOT the engine. It contains no walking, no parsing, and no import
 * resolution. It is a FIXTURE AUTHORING TOOL: the repo shape below is hand
 * authored, and this script only derives the mechanically-implied fields
 * (degrees, PageRank, importance, dense ranks, sort order, fingerprint) so
 * the committed fixture is internally consistent. Phase 4 owns the real
 * implementations of these algorithms and must not import anything here.
 *
 * The reason it exists: the UI (Phases 7-10) develops entirely against this
 * fixture, so `importanceRank` must actually be dense and unique,
 * `importantFilePaths` must actually agree with `importance` ordering, and
 * `stats` must actually match the arrays. Hand-typing ~800 lines of JSON
 * gets those wrong; deriving them cannot.
 *
 * Run: `bun run fixture:emit`
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { AnalysisEnvelope } from '../src/analysis-result';
import { stableStringify } from '../src/stable-stringify';
import {
  CYCLES,
  DIAGNOSTICS,
  DIRECTORIES,
  ENTRY_POINTS,
  EXTERNAL_DEPENDENCIES,
  MODULES,
  ORPHAN_PATHS,
  REPO,
  ROADMAP_STEPS,
  STACK,
  UNRESOLVED_IMPORTS,
} from './fixture-data';
import { SYMBOLS } from './fixture-symbols';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// ---
// HAND-AUTHORED REPO SHAPE --- a 24-file Express API + React admin + Python worker
// ---

const PAGERANK_DAMPING = 0.85;
const PAGERANK_MAX_ITERATIONS = 100;
const PAGERANK_EPSILON = 1e-6;
const PAGERANK_PRECISION = 6;
const W_PAGERANK = 0.55;
const W_IN_DEGREE = 0.3;
const W_ROLE = 0.15;
const TOP_IMPORTANT_FILES = 20;
/** Plausible count of files the walk dropped via .gitignore / HARD_IGNORE_DIRS. */
const FILES_IGNORED_BY_WALK = 118;
/** src/*, web/*, worker/*, and the two orphans form four weakly-connected groups. */
const CONNECTED_COMPONENT_COUNT = 4;

interface FileSpec {
  readonly path: string;
  readonly language: 'ts' | 'tsx' | 'js' | 'jsx' | 'py' | 'json' | 'md' | 'other';
  readonly classification: string;
  readonly moduleId: string | null;
  readonly sizeBytes: number;
  readonly lineCount: number;
  readonly isParsed?: boolean;
  readonly skipReason?: 'binary' | 'too-large' | 'minified' | 'unsupported-language' | 'unreadable';
}

const FILES: readonly FileSpec[] = [
  {
    path: 'README.md',
    language: 'md',
    classification: 'docs',
    moduleId: null,
    sizeBytes: 2104,
    lineCount: 62,
  },
  {
    path: 'package.json',
    language: 'json',
    classification: 'config',
    moduleId: null,
    sizeBytes: 812,
    lineCount: 34,
  },
  {
    path: 'tsconfig.json',
    language: 'json',
    classification: 'config',
    moduleId: null,
    sizeBytes: 401,
    lineCount: 19,
  },
  {
    path: 'src/config/env.ts',
    language: 'ts',
    classification: 'config',
    moduleId: null,
    sizeBytes: 1440,
    lineCount: 48,
  },
  {
    path: 'src/controllers/auth.controller.ts',
    language: 'ts',
    classification: 'controller',
    moduleId: 'src-controllers',
    sizeBytes: 2610,
    lineCount: 96,
  },
  {
    path: 'src/controllers/billing.controller.ts',
    language: 'ts',
    classification: 'controller',
    moduleId: 'src-controllers',
    sizeBytes: 2288,
    lineCount: 84,
  },
  {
    path: 'src/db/client.ts',
    language: 'ts',
    classification: 'service',
    moduleId: null,
    sizeBytes: 1702,
    lineCount: 58,
  },
  {
    path: 'src/index.ts',
    language: 'ts',
    classification: 'entrypoint',
    moduleId: null,
    sizeBytes: 604,
    lineCount: 22,
  },
  {
    path: 'src/legacy/old-mailer.ts',
    language: 'ts',
    classification: 'unknown',
    moduleId: null,
    sizeBytes: 1890,
    lineCount: 71,
  },
  {
    path: 'src/models/user.model.ts',
    language: 'ts',
    classification: 'model',
    moduleId: null,
    sizeBytes: 2015,
    lineCount: 77,
  },
  {
    path: 'src/routes/auth.routes.ts',
    language: 'ts',
    classification: 'route',
    moduleId: 'src-routes',
    sizeBytes: 1188,
    lineCount: 41,
  },
  {
    path: 'src/routes/billing.routes.ts',
    language: 'ts',
    classification: 'route',
    moduleId: 'src-routes',
    sizeBytes: 1067,
    lineCount: 37,
  },
  {
    path: 'src/routes/index.ts',
    language: 'ts',
    classification: 'route',
    moduleId: 'src-routes',
    sizeBytes: 486,
    lineCount: 14,
  },
  {
    path: 'src/server.ts',
    language: 'ts',
    classification: 'service',
    moduleId: null,
    sizeBytes: 1932,
    lineCount: 68,
  },
  {
    path: 'src/services/auth.service.ts',
    language: 'ts',
    classification: 'service',
    moduleId: 'src-services',
    sizeBytes: 3944,
    lineCount: 148,
  },
  {
    path: 'src/services/billing.service.ts',
    language: 'ts',
    classification: 'service',
    moduleId: 'src-services',
    sizeBytes: 3120,
    lineCount: 117,
  },
  {
    path: 'src/services/session.service.ts',
    language: 'ts',
    classification: 'service',
    moduleId: 'src-services',
    sizeBytes: 2466,
    lineCount: 92,
  },
  {
    path: 'src/services/token.service.ts',
    language: 'ts',
    classification: 'service',
    moduleId: 'src-services',
    sizeBytes: 2201,
    lineCount: 83,
  },
  {
    path: 'src/utils/format.ts',
    language: 'ts',
    classification: 'util',
    moduleId: 'src-utils',
    sizeBytes: 918,
    lineCount: 36,
  },
  {
    path: 'src/utils/logger.ts',
    language: 'ts',
    classification: 'util',
    moduleId: 'src-utils',
    sizeBytes: 1244,
    lineCount: 45,
  },
  {
    path: 'web/src/App.tsx',
    language: 'tsx',
    classification: 'component',
    moduleId: 'web-src',
    sizeBytes: 1655,
    lineCount: 58,
  },
  {
    path: 'web/src/components/LoginForm.tsx',
    language: 'tsx',
    classification: 'component',
    moduleId: 'web-src',
    sizeBytes: 2740,
    lineCount: 103,
  },
  {
    path: 'web/src/vendor.min.js',
    language: 'js',
    classification: 'generated',
    moduleId: 'web-src',
    sizeBytes: 184320,
    lineCount: 3,
    isParsed: false,
    skipReason: 'minified',
  },
  {
    path: 'worker/main.py',
    language: 'py',
    classification: 'entrypoint',
    moduleId: null,
    sizeBytes: 1508,
    lineCount: 61,
  },
];

interface EdgeSpec {
  readonly fromPath: string;
  readonly toPath: string;
  readonly specifier: string;
  readonly line: number;
  readonly kind: 'static' | 'dynamic' | 'require' | 'reexport' | 'type';
  readonly isTypeOnly?: boolean;
}

const EDGES: readonly EdgeSpec[] = [
  {
    fromPath: 'src/controllers/auth.controller.ts',
    toPath: 'src/services/auth.service.ts',
    specifier: '../services/auth.service',
    line: 3,
    kind: 'static',
  },
  {
    fromPath: 'src/controllers/auth.controller.ts',
    toPath: 'src/utils/format.ts',
    specifier: '@/utils/format',
    line: 4,
    kind: 'static',
  },
  {
    fromPath: 'src/controllers/billing.controller.ts',
    toPath: 'src/services/billing.service.ts',
    specifier: '../services/billing.service',
    line: 3,
    kind: 'static',
  },
  {
    fromPath: 'src/db/client.ts',
    toPath: 'src/config/env.ts',
    specifier: '../config/env',
    line: 2,
    kind: 'static',
  },
  {
    fromPath: 'src/index.ts',
    toPath: 'src/config/env.ts',
    specifier: './config/env',
    line: 2,
    kind: 'static',
  },
  {
    fromPath: 'src/index.ts',
    toPath: 'src/server.ts',
    specifier: './server',
    line: 1,
    kind: 'static',
  },
  {
    fromPath: 'src/models/user.model.ts',
    toPath: 'src/config/env.ts',
    specifier: '../config/env',
    line: 3,
    kind: 'type',
    isTypeOnly: true,
  },
  {
    fromPath: 'src/models/user.model.ts',
    toPath: 'src/db/client.ts',
    specifier: '../db/client',
    line: 2,
    kind: 'static',
  },
  {
    fromPath: 'src/routes/auth.routes.ts',
    toPath: 'src/controllers/auth.controller.ts',
    specifier: '../controllers/auth.controller',
    line: 2,
    kind: 'static',
  },
  {
    fromPath: 'src/routes/billing.routes.ts',
    toPath: 'src/controllers/billing.controller.ts',
    specifier: '../controllers/billing.controller',
    line: 2,
    kind: 'static',
  },
  {
    fromPath: 'src/routes/index.ts',
    toPath: 'src/routes/auth.routes.ts',
    specifier: './auth.routes',
    line: 1,
    kind: 'reexport',
  },
  {
    fromPath: 'src/routes/index.ts',
    toPath: 'src/routes/billing.routes.ts',
    specifier: './billing.routes',
    line: 2,
    kind: 'reexport',
  },
  {
    fromPath: 'src/server.ts',
    toPath: 'src/config/env.ts',
    specifier: './config/env',
    line: 4,
    kind: 'static',
  },
  {
    fromPath: 'src/server.ts',
    toPath: 'src/routes/index.ts',
    specifier: './routes',
    line: 2,
    kind: 'static',
  },
  {
    fromPath: 'src/server.ts',
    toPath: 'src/utils/logger.ts',
    specifier: '@/utils/logger',
    line: 3,
    kind: 'static',
  },
  {
    fromPath: 'src/services/auth.service.ts',
    toPath: 'src/models/user.model.ts',
    specifier: '../models/user.model',
    line: 4,
    kind: 'static',
  },
  {
    fromPath: 'src/services/auth.service.ts',
    toPath: 'src/services/session.service.ts',
    specifier: './session.service',
    line: 2,
    kind: 'static',
  },
  {
    fromPath: 'src/services/auth.service.ts',
    toPath: 'src/utils/logger.ts',
    specifier: '@/utils/logger',
    line: 5,
    kind: 'static',
  },
  {
    fromPath: 'src/services/billing.service.ts',
    toPath: 'src/db/client.ts',
    specifier: '../db/client',
    line: 2,
    kind: 'static',
  },
  {
    fromPath: 'src/services/billing.service.ts',
    toPath: 'src/utils/logger.ts',
    specifier: '@/utils/logger',
    line: 3,
    kind: 'static',
  },
  {
    fromPath: 'src/services/session.service.ts',
    toPath: 'src/services/token.service.ts',
    specifier: './token.service',
    line: 2,
    kind: 'static',
  },
  {
    fromPath: 'src/services/token.service.ts',
    toPath: 'src/services/auth.service.ts',
    specifier: './auth.service',
    line: 2,
    kind: 'static',
  },
  {
    fromPath: 'web/src/App.tsx',
    toPath: 'web/src/components/LoginForm.tsx',
    specifier: './components/LoginForm',
    line: 2,
    kind: 'static',
  },
  {
    fromPath: 'web/src/components/LoginForm.tsx',
    toPath: 'src/utils/format.ts',
    specifier: '@/utils/format',
    line: 3,
    kind: 'static',
  },
];

const ROLE_BOOST: Readonly<Record<string, number>> = {
  entrypoint: 1.0,
  route: 0.8,
  controller: 0.8,
  service: 0.8,
  store: 0.8,
  model: 0.6,
  component: 0.6,
  hook: 0.6,
  util: 0.3,
  config: 0.3,
};

// ---
// DERIVATION (mirrors Sections 8.3/8.4 so the fixture is self-consistent)
// ---

function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function roundFixed(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function computePageRank(
  paths: readonly string[],
  edges: readonly EdgeSpec[],
): Map<string, number> {
  const order = [...paths].sort(byteCompare);
  const outLinks = new Map<string, string[]>();
  for (const path of order) {
    const targets = edges
      .filter((edge) => edge.fromPath === path && edge.toPath !== path)
      .map((edge) => edge.toPath);
    outLinks.set(path, [...new Set(targets)].sort(byteCompare));
  }

  const count = order.length;
  let rank = new Map(order.map((path) => [path, 1 / count]));

  for (let iteration = 0; iteration < PAGERANK_MAX_ITERATIONS; iteration += 1) {
    let danglingMass = 0;
    for (const path of order) {
      if ((outLinks.get(path) ?? []).length === 0) danglingMass += rank.get(path) ?? 0;
    }
    const base = (1 - PAGERANK_DAMPING) / count + (PAGERANK_DAMPING * danglingMass) / count;
    const next = new Map(order.map((path) => [path, base]));

    for (const path of order) {
      const targets = outLinks.get(path) ?? [];
      if (targets.length === 0) continue;
      const share = (rank.get(path) ?? 0) / targets.length;
      for (const target of targets) {
        next.set(target, (next.get(target) ?? 0) + PAGERANK_DAMPING * share);
      }
    }

    let delta = 0;
    for (const path of order) delta += Math.abs((next.get(path) ?? 0) - (rank.get(path) ?? 0));
    rank = next;
    if (delta < PAGERANK_EPSILON) break;
  }

  return new Map(order.map((path) => [path, roundFixed(rank.get(path) ?? 0, PAGERANK_PRECISION)]));
}

function normalize(value: number, min: number, max: number): number {
  return max === min ? 0 : (value - min) / (max - min);
}

/** Every authored array, placed into the contract's documented sort order. */
function buildSortedBlocks() {
  return {
    symbols: [...SYMBOLS].sort((a, b) => byteCompare(a.path, b.path) || a.startLine - b.startLine),
    directories: [...DIRECTORIES].sort((a, b) => byteCompare(a.path, b.path)),
    unresolvedImports: [...UNRESOLVED_IMPORTS].sort(
      (a, b) => byteCompare(a.fromPath, b.fromPath) || a.line - b.line,
    ),
    externalDependencies: [...EXTERNAL_DEPENDENCIES]
      .map((dependency) => ({
        ...dependency,
        importedByPaths: [...dependency.importedByPaths].sort(byteCompare),
      }))
      .sort((a, b) => byteCompare(a.packageName, b.packageName)),
    diagnostics: [...DIAGNOSTICS].sort(
      (a, b) => byteCompare(a.code, b.code) || byteCompare(a.path ?? '', b.path ?? ''),
    ),
    entryPoints: [...ENTRY_POINTS].sort((a, b) => a.rank - b.rank),
    roadmapSteps: [...ROADMAP_STEPS].sort((a, b) => a.order - b.order),
    modules: [...MODULES].sort((a, b) => byteCompare(a.dirPath, b.dirPath)),
    orphanPaths: [...ORPHAN_PATHS].sort(byteCompare),
    cycles: [...CYCLES].sort(
      (a, b) => b.edgeCount - a.edgeCount || byteCompare(a.paths[0] ?? '', b.paths[0] ?? ''),
    ),
    stack: {
      ...STACK,
      manifests: [...STACK.manifests].sort((a, b) => byteCompare(a.path, b.path)),
      dependencies: [...STACK.dependencies].sort((a, b) => byteCompare(a.name, b.name)),
    },
  };
}

interface ScoredFile {
  readonly file: FileSpec;
  readonly isParsed: boolean;
  readonly pageRank: number;
  readonly inDegree: number;
  readonly outDegree: number;
  readonly importance: number;
}

const inDegreeOf = (path: string): number => EDGES.filter((edge) => edge.toPath === path).length;
const outDegreeOf = (path: string): number => EDGES.filter((edge) => edge.fromPath === path).length;

/** Applies Section 8.4's weighted importance formula to every file. */
function scoreFiles(sortedFiles: readonly FileSpec[]): ScoredFile[] {
  const pageRanks = computePageRank(
    sortedFiles.map((file) => file.path),
    EDGES,
  );
  const parsedFiles = sortedFiles.filter((file) => file.isParsed !== false);
  const parsedPageRanks = parsedFiles.map((file) => pageRanks.get(file.path) ?? 0);
  const parsedInDegrees = parsedFiles.map((file) => inDegreeOf(file.path));
  const minPageRank = Math.min(...parsedPageRanks);
  const maxPageRank = Math.max(...parsedPageRanks);
  const minInDegree = Math.min(...parsedInDegrees);
  const maxInDegree = Math.max(...parsedInDegrees);

  return sortedFiles.map((file) => {
    const isParsed = file.isParsed !== false;
    const pageRank = pageRanks.get(file.path) ?? 0;
    const inDegree = inDegreeOf(file.path);
    const rawImportance = isParsed
      ? W_PAGERANK * normalize(pageRank, minPageRank, maxPageRank) +
        W_IN_DEGREE * normalize(inDegree, minInDegree, maxInDegree) +
        W_ROLE * (ROLE_BOOST[file.classification] ?? 0)
      : 0;
    return {
      file,
      isParsed,
      pageRank: isParsed ? pageRank : 0,
      inDegree,
      outDegree: outDegreeOf(file.path),
      importance: roundFixed(Math.min(Math.max(rawImportance, 0), 1), 6),
    };
  });
}

/**
 * Section 8.4's ranking order: importance desc -> inDegree desc ->
 * lineCount desc -> path asc, with unparsed files after every parsed file.
 */
function rankFiles(scored: readonly ScoredFile[]): ScoredFile[] {
  return [...scored].sort((a, b) => {
    if (a.isParsed !== b.isParsed) return a.isParsed ? -1 : 1;
    if (a.importance !== b.importance) return b.importance - a.importance;
    if (a.inDegree !== b.inDegree) return b.inDegree - a.inDegree;
    if (a.file.lineCount !== b.file.lineCount) return b.file.lineCount - a.file.lineCount;
    return byteCompare(a.file.path, b.file.path);
  });
}

function toFileNodes(scored: readonly ScoredFile[], rankOf: ReadonlyMap<string, number>) {
  return scored.map((entry) => ({
    path: entry.file.path,
    language: entry.file.language,
    classification: entry.file.classification,
    moduleId: entry.file.moduleId,
    sizeBytes: entry.file.sizeBytes,
    lineCount: entry.file.lineCount,
    contentHash: sha256Hex(`fixture-content:${entry.file.path}`),
    symbolCount: SYMBOLS.filter((symbol) => symbol.path === entry.file.path).length,
    inDegree: entry.inDegree,
    outDegree: entry.outDegree,
    pageRank: entry.pageRank,
    importance: entry.importance,
    importanceRank: rankOf.get(entry.file.path) ?? 1,
    isParsed: entry.isParsed,
    skipReason: entry.file.skipReason ?? null,
  }));
}

/** Edges normalized (isTypeOnly defaulted) and sorted per the contract. */
function buildEdges() {
  return [...EDGES]
    .map((edge) => ({
      fromPath: edge.fromPath,
      toPath: edge.toPath,
      specifier: edge.specifier,
      line: edge.line,
      kind: edge.kind,
      isTypeOnly: edge.isTypeOnly ?? false,
    }))
    .sort(
      (a, b) =>
        byteCompare(a.fromPath, b.fromPath) ||
        a.line - b.line ||
        byteCompare(a.specifier, b.specifier),
    );
}

/** Derives the file nodes, their ranking, and the top-N list in one pass. */
function buildFileSection() {
  const sortedFiles = [...FILES].sort((a, b) => byteCompare(a.path, b.path));
  const scored = scoreFiles(sortedFiles);
  const ranked = rankFiles(scored);
  const rankOf = new Map(ranked.map((entry, index) => [entry.file.path, index + 1]));
  return {
    files: toFileNodes(scored, rankOf),
    importantFilePaths: ranked.slice(0, TOP_IMPORTANT_FILES).map((entry) => entry.file.path),
  };
}

type SortedBlocks = ReturnType<typeof buildSortedBlocks>;
type FileNodes = ReturnType<typeof buildFileSection>['files'];
type Edges = ReturnType<typeof buildEdges>;

/**
 * Counts derived from the arrays themselves, so `stats` can never drift from
 * the data it summarizes (asserted by the fixture's stats-agreement test).
 */
function buildStats(files: FileNodes, edges: Edges, blocks: SortedBlocks) {
  return {
    filesScanned: files.length,
    filesIgnored: FILES_IGNORED_BY_WALK,
    filesParsed: files.filter((file) => file.isParsed).length,
    filesSkipped: files.filter((file) => !file.isParsed).length,
    symbolCount: blocks.symbols.length,
    edgeCount: edges.length,
    externalDependencyCount: blocks.externalDependencies.length,
    unresolvedImportCount: blocks.unresolvedImports.length,
    cycleCount: blocks.cycles.length,
    orphanCount: blocks.orphanPaths.length,
  };
}

function main(): void {
  const { files, importantFilePaths } = buildFileSection();
  const edges = buildEdges();
  // Sorting happens in buildSortedBlocks() rather than trusting the authored
  // order, so a hand-edit to fixture-data.ts can never silently produce an
  // out-of-order fixture that the UI would then be written against.
  const blocks = buildSortedBlocks();

  writeEnvelope({
    schemaVersion: 1 as const,
    fingerprint: '',
    repo: REPO,
    stats: buildStats(files, edges, blocks),
    stack: blocks.stack,
    entryPoints: blocks.entryPoints,
    files,
    directories: blocks.directories,
    edges,
    externalDependencies: blocks.externalDependencies,
    unresolvedImports: blocks.unresolvedImports,
    graph: {
      cycles: blocks.cycles,
      orphanPaths: blocks.orphanPaths,
      componentCount: CONNECTED_COMPONENT_COUNT,
    },
    importantFilePaths,
    roadmap: { steps: blocks.roadmapSteps },
    modules: blocks.modules,
    symbols: blocks.symbols,
    diagnostics: blocks.diagnostics,
  });
}

/**
 * Seals the result with its real fingerprint, wraps it in the envelope,
 * validates the whole thing against the frozen schema, and writes it.
 * Validating BEFORE writing means a malformed fixture can never reach disk.
 */
function writeEnvelope(result: Record<string, unknown>): void {
  const fingerprint = sha256Hex(stableStringify({ ...result, fingerprint: '' }));
  const envelope = {
    result: { ...result, fingerprint },
    engineVersion: '0.1.0',
    timings: {
      walkMs: 41,
      parseMs: 268,
      resolveMs: 57,
      graphMs: 12,
      totalMs: 402,
      cacheHitCount: 0,
    },
  };

  AnalysisEnvelope.parse(envelope);

  const outputPath = join(import.meta.dir, '..', 'fixtures', 'sample-analysis.json');
  Bun.write(outputPath, `${JSON.stringify(envelope, null, 2)}\n`);
  console.log(`fixture:emit wrote ${outputPath} (fingerprint ${fingerprint})`);
}

export { byteCompare, computePageRank };

if (import.meta.main) {
  main();
}
