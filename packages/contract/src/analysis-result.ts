/**
 * @onboard/contract — AnalysisResult schema (Section 7.1, FROZEN at Phase 1).
 *
 * This file transcribes the zod block in Section 7.1 of the build spec
 * verbatim, field for field, type for type. It is the literal source of
 * truth for the engine's output. No later phase may add, rename, retype,
 * or reorder a field here — a genuine change bumps SCHEMA_VERSION and
 * re-runs the Phase 1 gate (Section 7 preamble).
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

/** Repo-relative POSIX path. Never absolute, never backslashes, never './' prefix. */
export const RepoPath = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?!.*\\)(?!\.\/).+$/);

export const Language = z.enum(['ts', 'tsx', 'js', 'jsx', 'py', 'json', 'md', 'other']);

export const FileClassification = z.enum([
  'entrypoint',
  'route',
  'controller',
  'service',
  'model',
  'component',
  'hook',
  'store',
  'util',
  'config',
  'test',
  'fixture',
  'script',
  'docs',
  'style',
  'asset',
  'generated',
  'unknown',
]);

export const SymbolKind = z.enum([
  'function',
  'class',
  'method',
  'const',
  'type',
  'interface',
  'enum',
  'variable',
  'component',
  'hook',
  'route',
]);

export const EdgeKind = z.enum(['static', 'dynamic', 'require', 'reexport', 'type']);

export const Ecosystem = z.enum(['npm', 'pypi', 'stdlib', 'unknown']);

export const ManifestInfo = z.object({
  path: RepoPath,
  kind: z.enum([
    'package.json',
    'requirements.txt',
    'pyproject.toml',
    'setup.py',
    'Pipfile',
    'go.mod',
    'Cargo.toml',
    'pom.xml',
    'composer.json',
  ]),
  projectName: z.string().nullable(),
  version: z.string().nullable(),
  packageManager: z.string().nullable(), // 'bun'|'pnpm'|'npm'|'yarn'|'poetry'|'pip'|null
});

export const DependencyInfo = z.object({
  name: z.string(),
  versionSpec: z.string(),
  ecosystem: Ecosystem,
  scope: z.enum(['runtime', 'dev', 'peer', 'optional']),
  inferredRole: z.string().nullable(), // from the static role table only; null if unknown
  importedByCount: z.number().int().min(0),
});

export const LanguageStat = z.object({
  language: Language,
  fileCount: z.number().int().min(0),
  lineCount: z.number().int().min(0),
  sharePercent: z.number().min(0).max(100), // 1 decimal place
});

export const EntryPoint = z.object({
  path: RepoPath,
  rank: z.number().int().min(1), // 1 = most likely; unique within the array
  evidence: z.string(), // 'package.json#main' | 'package.json#scripts.start'
  // | 'package.json#bin.cli' | 'convention:src/index.ts'
  // | 'python:__main__.py' | 'python:module-guard'
  kind: z.enum(['main', 'bin', 'script', 'convention', 'server', 'test-runner']),
});

export const FileNode = z.object({
  path: RepoPath,
  language: Language,
  classification: FileClassification,
  moduleId: z.string().nullable(),
  sizeBytes: z.number().int().min(0),
  lineCount: z.number().int().min(0),
  contentHash: z.string().length(64),
  symbolCount: z.number().int().min(0),
  inDegree: z.number().int().min(0),
  outDegree: z.number().int().min(0),
  pageRank: z.number().min(0), // exactly 6 decimal places
  importance: z.number().min(0).max(1), // exactly 6 decimal places, Section 8.4
  importanceRank: z.number().int().min(1), // 1-based, dense, unique
  isParsed: z.boolean(),
  skipReason: z
    .enum(['binary', 'too-large', 'minified', 'unsupported-language', 'unreadable'])
    .nullable(),
});

export const DirectoryNode = z.object({
  path: RepoPath,
  parentPath: RepoPath.nullable(),
  fileCount: z.number().int().min(0),
  descendantFileCount: z.number().int().min(0),
  dominantClassification: FileClassification,
});

export const ImportEdge = z.object({
  fromPath: RepoPath,
  toPath: RepoPath,
  specifier: z.string(),
  line: z.number().int().min(1),
  kind: EdgeKind,
  isTypeOnly: z.boolean(),
});

export const ExternalDependencyEdge = z.object({
  packageName: z.string(),
  ecosystem: Ecosystem,
  importedByPaths: z.array(RepoPath), // sorted ascending
});

export const UnresolvedImport = z.object({
  fromPath: RepoPath,
  specifier: z.string(),
  line: z.number().int().min(1),
  reason: z.enum([
    'no-match-on-disk',
    'alias-unmapped',
    'outside-repo',
    'dynamic-expression',
    'namespace-package',
  ]),
});

export const Cycle = z.object({
  id: z.string(), // 'cycle-1', 'cycle-2', ... by rank order
  paths: z.array(RepoPath).min(2), // rotated so the lexicographically smallest is first
  edgeCount: z.number().int().min(2),
});

export const SymbolEntry = z.object({
  id: z.string(),
  name: z.string(),
  kind: SymbolKind,
  path: RepoPath,
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  isExported: z.boolean(),
  containerName: z.string().nullable(),
  signature: z.string().max(200).nullable(),
});

export const RoadmapStep = z.object({
  order: z.number().int().min(1),
  path: RepoPath,
  companionPaths: z.array(RepoPath), // other members of the same cycle group, sorted
  section: z.enum(['entry', 'core', 'supporting', 'leaf-utility', 'unreached']),
  why: z.string(), // deterministic template output, Section 8.5
  dependsOnPaths: z.array(RepoPath), // sorted, capped at 8
  dependedOnByCount: z.number().int().min(0),
});

export const ModuleCard = z.object({
  id: z.string(), // slug of dirPath, e.g. 'src-api-billing'
  name: z.string(),
  dirPath: RepoPath,
  purposeByConvention: z.string(), // from the static convention table only
  fileCount: z.number().int().min(0),
  keyFilePaths: z.array(RepoPath), // top 5 by importance, sorted by rank
  dependsOnModuleIds: z.array(z.string()),
  dependedOnByModuleIds: z.array(z.string()),
});

export const Diagnostic = z.object({
  severity: z.enum(['info', 'warning', 'error']),
  code: z.string(), // e.g. 'PARSE_FAILED', 'TSCONFIG_UNREADABLE'
  path: RepoPath.nullable(),
  message: z.string(),
});

export const AnalysisResult = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  fingerprint: z.string().length(64), // sha256 of canonical JSON with this field ''
  repo: z.object({
    id: z.string().length(16),
    name: z.string(),
    rootPathHash: z.string().length(64), // absolute path is NEVER emitted
    detectedType: z.string(), // e.g. 'Node.js service', 'React application',
    // 'Python package', 'Monorepo (3 workspaces)'
    sourceRoots: z.array(RepoPath),
    workspacePackages: z.array(z.object({ name: z.string(), dirPath: RepoPath })),
  }),
  stats: z.object({
    filesScanned: z.number().int().min(0),
    filesIgnored: z.number().int().min(0),
    filesParsed: z.number().int().min(0),
    filesSkipped: z.number().int().min(0),
    symbolCount: z.number().int().min(0),
    edgeCount: z.number().int().min(0),
    externalDependencyCount: z.number().int().min(0),
    unresolvedImportCount: z.number().int().min(0),
    cycleCount: z.number().int().min(0),
    orphanCount: z.number().int().min(0),
  }),
  stack: z.object({
    manifests: z.array(ManifestInfo),
    languages: z.array(LanguageStat),
    dependencies: z.array(DependencyInfo),
  }),
  entryPoints: z.array(EntryPoint),
  files: z.array(FileNode),
  directories: z.array(DirectoryNode),
  edges: z.array(ImportEdge),
  externalDependencies: z.array(ExternalDependencyEdge),
  unresolvedImports: z.array(UnresolvedImport),
  graph: z.object({
    cycles: z.array(Cycle),
    orphanPaths: z.array(RepoPath),
    componentCount: z.number().int().min(0),
  }),
  importantFilePaths: z.array(RepoPath), // top 20, importance desc
  roadmap: z.object({ steps: z.array(RoadmapStep) }),
  modules: z.array(ModuleCard),
  symbols: z.array(SymbolEntry),
  diagnostics: z.array(Diagnostic),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;

/** Non-deterministic data lives OUT here and is never snapshotted. */
export const AnalysisEnvelope = z.object({
  result: AnalysisResult,
  engineVersion: z.string(),
  timings: z.object({
    walkMs: z.number(),
    parseMs: z.number(),
    resolveMs: z.number(),
    graphMs: z.number(),
    totalMs: z.number(),
    cacheHitCount: z.number().int(),
  }),
});
export type AnalysisEnvelope = z.infer<typeof AnalysisEnvelope>;
