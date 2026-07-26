/**
 * Hand-authored static blocks for `fixtures/sample-analysis.json`.
 *
 * Split out of `build-fixture.ts` purely to keep both files under the
 * 800-line ceiling. Everything here is authored data, not derived: the
 * derived fields (degrees, PageRank, importance, ranks, fingerprint) are
 * computed by `build-fixture.ts`.
 *
 * Arrays are authored already in the contract's documented sort order
 * (see the paragraph after Section 7.1), which the fixture's sort-order
 * test then re-verifies.
 */

export const REPO = {
  id: '9f3c1a7b2e5d4086',
  name: 'acme-billing-api',
  rootPathHash: 'c1f0b4a9e77d2358a4be6013c9f8d5721ab3e6c40d92f8175e3ca6b0472d19fe',
  detectedType: 'Node.js service with React admin and Python worker',
  sourceRoots: ['src', 'web/src', 'worker'],
  workspacePackages: [],
} as const;

export const STACK = {
  manifests: [
    {
      path: 'package.json',
      kind: 'package.json' as const,
      projectName: 'acme-billing-api',
      version: '2.4.1',
      packageManager: 'npm',
    },
    {
      path: 'worker/requirements.txt',
      kind: 'requirements.txt' as const,
      projectName: null,
      version: null,
      packageManager: 'pip',
    },
  ],
  languages: [
    { language: 'ts' as const, fileCount: 16, lineCount: 950, sharePercent: 66.7 },
    { language: 'tsx' as const, fileCount: 2, lineCount: 161, sharePercent: 8.3 },
    { language: 'json' as const, fileCount: 2, lineCount: 53, sharePercent: 8.3 },
    { language: 'js' as const, fileCount: 1, lineCount: 3, sharePercent: 4.2 },
    { language: 'md' as const, fileCount: 1, lineCount: 62, sharePercent: 4.2 },
    { language: 'py' as const, fileCount: 1, lineCount: 61, sharePercent: 4.2 },
  ],
  dependencies: [
    {
      name: 'express',
      versionSpec: '^4.19.2',
      ecosystem: 'npm' as const,
      scope: 'runtime' as const,
      inferredRole: 'HTTP server framework',
      importedByCount: 4,
    },
    {
      name: 'pg',
      versionSpec: '^8.12.0',
      ecosystem: 'npm' as const,
      scope: 'runtime' as const,
      inferredRole: 'PostgreSQL driver',
      importedByCount: 1,
    },
    {
      name: 'react',
      versionSpec: '^19.0.0',
      ecosystem: 'npm' as const,
      scope: 'runtime' as const,
      inferredRole: 'UI library',
      importedByCount: 2,
    },
    {
      name: 'react-dom',
      versionSpec: '^19.0.0',
      ecosystem: 'npm' as const,
      scope: 'runtime' as const,
      inferredRole: 'UI library renderer',
      importedByCount: 1,
    },
    {
      name: 'requests',
      versionSpec: '>=2.31',
      ecosystem: 'pypi' as const,
      scope: 'runtime' as const,
      inferredRole: 'HTTP client',
      importedByCount: 1,
    },
    {
      name: 'typescript',
      versionSpec: '^5.7.3',
      ecosystem: 'npm' as const,
      scope: 'dev' as const,
      inferredRole: 'Type checker',
      importedByCount: 0,
    },
    {
      name: 'zod',
      versionSpec: '^4.4.3',
      ecosystem: 'npm' as const,
      scope: 'runtime' as const,
      inferredRole: 'Schema validation',
      importedByCount: 2,
    },
  ],
};

export const ENTRY_POINTS = [
  { path: 'src/index.ts', rank: 1, evidence: 'package.json#main', kind: 'main' as const },
  { path: 'worker/main.py', rank: 2, evidence: 'python:module-guard', kind: 'main' as const },
  {
    path: 'src/server.ts',
    rank: 3,
    evidence: 'package.json#scripts.start',
    kind: 'server' as const,
  },
  {
    path: 'web/src/App.tsx',
    rank: 4,
    evidence: 'convention:web/src/App.tsx',
    kind: 'convention' as const,
  },
];

export const DIRECTORIES = [
  {
    path: 'src',
    parentPath: null,
    fileCount: 2,
    descendantFileCount: 17,
    dominantClassification: 'service' as const,
  },
  {
    path: 'src/config',
    parentPath: 'src',
    fileCount: 1,
    descendantFileCount: 1,
    dominantClassification: 'config' as const,
  },
  {
    path: 'src/controllers',
    parentPath: 'src',
    fileCount: 2,
    descendantFileCount: 2,
    dominantClassification: 'controller' as const,
  },
  {
    path: 'src/db',
    parentPath: 'src',
    fileCount: 1,
    descendantFileCount: 1,
    dominantClassification: 'service' as const,
  },
  {
    path: 'src/legacy',
    parentPath: 'src',
    fileCount: 1,
    descendantFileCount: 1,
    dominantClassification: 'unknown' as const,
  },
  {
    path: 'src/models',
    parentPath: 'src',
    fileCount: 1,
    descendantFileCount: 1,
    dominantClassification: 'model' as const,
  },
  {
    path: 'src/routes',
    parentPath: 'src',
    fileCount: 3,
    descendantFileCount: 3,
    dominantClassification: 'route' as const,
  },
  {
    path: 'src/services',
    parentPath: 'src',
    fileCount: 4,
    descendantFileCount: 4,
    dominantClassification: 'service' as const,
  },
  {
    path: 'src/utils',
    parentPath: 'src',
    fileCount: 2,
    descendantFileCount: 2,
    dominantClassification: 'util' as const,
  },
  {
    path: 'web',
    parentPath: null,
    fileCount: 0,
    descendantFileCount: 3,
    dominantClassification: 'component' as const,
  },
  {
    path: 'web/src',
    parentPath: 'web',
    fileCount: 2,
    descendantFileCount: 3,
    dominantClassification: 'component' as const,
  },
  {
    path: 'web/src/components',
    parentPath: 'web/src',
    fileCount: 1,
    descendantFileCount: 1,
    dominantClassification: 'component' as const,
  },
  {
    path: 'worker',
    parentPath: null,
    fileCount: 1,
    descendantFileCount: 1,
    dominantClassification: 'entrypoint' as const,
  },
];

export const EXTERNAL_DEPENDENCIES = [
  {
    packageName: 'express',
    ecosystem: 'npm' as const,
    importedByPaths: [
      'src/routes/auth.routes.ts',
      'src/routes/billing.routes.ts',
      'src/routes/index.ts',
      'src/server.ts',
    ],
  },
  { packageName: 'pg', ecosystem: 'npm' as const, importedByPaths: ['src/db/client.ts'] },
  {
    packageName: 'react',
    ecosystem: 'npm' as const,
    importedByPaths: ['web/src/App.tsx', 'web/src/components/LoginForm.tsx'],
  },
  { packageName: 'requests', ecosystem: 'pypi' as const, importedByPaths: ['worker/main.py'] },
  { packageName: 'sys', ecosystem: 'stdlib' as const, importedByPaths: ['worker/main.py'] },
  {
    packageName: 'zod',
    ecosystem: 'npm' as const,
    importedByPaths: ['src/config/env.ts', 'src/models/user.model.ts'],
  },
];

export const UNRESOLVED_IMPORTS = [
  {
    fromPath: 'src/legacy/old-mailer.ts',
    specifier: '../config/smtp',
    line: 3,
    reason: 'no-match-on-disk' as const,
  },
  {
    fromPath: 'src/services/billing.service.ts',
    specifier: './providers/${providerName}',
    line: 41,
    reason: 'dynamic-expression' as const,
  },
  {
    fromPath: 'worker/main.py',
    specifier: 'analytics.pipeline',
    line: 4,
    reason: 'namespace-package' as const,
  },
];

export const CYCLES = [
  {
    id: 'cycle-1',
    paths: [
      'src/services/auth.service.ts',
      'src/services/session.service.ts',
      'src/services/token.service.ts',
    ],
    edgeCount: 3,
  },
];

export const ORPHAN_PATHS = ['src/legacy/old-mailer.ts', 'web/src/vendor.min.js'];

export const ROADMAP_STEPS = [
  {
    order: 1,
    path: 'src/index.ts',
    companionPaths: [],
    section: 'entry' as const,
    why: 'Entry point (package.json#main). Start reading here.',
    dependsOnPaths: ['src/config/env.ts', 'src/server.ts'],
    dependedOnByCount: 0,
  },
  {
    order: 2,
    path: 'worker/main.py',
    companionPaths: [],
    section: 'entry' as const,
    why: 'Entry point (python:module-guard). Start reading here.',
    dependsOnPaths: [],
    dependedOnByCount: 0,
  },
  {
    order: 3,
    path: 'src/server.ts',
    companionPaths: [],
    section: 'core' as const,
    why: 'service used by 1 files; reached directly from index.ts.',
    dependsOnPaths: ['src/config/env.ts', 'src/routes/index.ts', 'src/utils/logger.ts'],
    dependedOnByCount: 1,
  },
  {
    order: 4,
    path: 'src/routes/index.ts',
    companionPaths: [],
    section: 'core' as const,
    why: 'route used by 1 files; reached directly from server.ts.',
    dependsOnPaths: ['src/routes/auth.routes.ts', 'src/routes/billing.routes.ts'],
    dependedOnByCount: 1,
  },
  {
    order: 5,
    path: 'src/controllers/auth.controller.ts',
    companionPaths: [],
    section: 'core' as const,
    why: 'controller used by 1 files; reached directly from auth.routes.ts.',
    dependsOnPaths: ['src/services/auth.service.ts', 'src/utils/format.ts'],
    dependedOnByCount: 1,
  },
  {
    order: 6,
    path: 'src/services/auth.service.ts',
    companionPaths: ['src/services/session.service.ts', 'src/services/token.service.ts'],
    section: 'core' as const,
    why: 'Part of a 3-file import cycle; read these together.',
    dependsOnPaths: [
      'src/models/user.model.ts',
      'src/services/session.service.ts',
      'src/utils/logger.ts',
    ],
    dependedOnByCount: 2,
  },
  {
    order: 7,
    path: 'src/services/billing.service.ts',
    companionPaths: [],
    section: 'supporting' as const,
    why: 'service in src/services; imported by 1 files.',
    dependsOnPaths: ['src/db/client.ts', 'src/utils/logger.ts'],
    dependedOnByCount: 1,
  },
  {
    order: 8,
    path: 'src/models/user.model.ts',
    companionPaths: [],
    section: 'supporting' as const,
    why: 'model in src/models; imported by 1 files.',
    dependsOnPaths: ['src/config/env.ts', 'src/db/client.ts'],
    dependedOnByCount: 1,
  },
  {
    order: 9,
    path: 'src/db/client.ts',
    companionPaths: [],
    section: 'supporting' as const,
    why: 'service in src/db; imported by 2 files.',
    dependsOnPaths: ['src/config/env.ts'],
    dependedOnByCount: 2,
  },
  {
    order: 10,
    path: 'src/config/env.ts',
    companionPaths: [],
    section: 'supporting' as const,
    why: 'Imported by 4 files (rank #3 by centrality) â€” the hub of src/config.',
    dependsOnPaths: [],
    dependedOnByCount: 4,
  },
  {
    order: 11,
    path: 'src/utils/logger.ts',
    companionPaths: [],
    section: 'leaf-utility' as const,
    why: 'Leaf utility imported by 3 files; read last, for reference.',
    dependsOnPaths: [],
    dependedOnByCount: 3,
  },
  {
    order: 12,
    path: 'src/utils/format.ts',
    companionPaths: [],
    section: 'leaf-utility' as const,
    why: 'Leaf utility imported by 2 files; read last, for reference.',
    dependsOnPaths: [],
    dependedOnByCount: 2,
  },
  {
    order: 13,
    path: 'src/legacy/old-mailer.ts',
    companionPaths: [],
    section: 'unreached' as const,
    why: 'Not reached from any entry point â€” likely dead code or a separate tool.',
    dependsOnPaths: [],
    dependedOnByCount: 0,
  },
];

export const MODULES = [
  {
    id: 'src-controllers',
    name: 'controllers',
    dirPath: 'src/controllers',
    purposeByConvention: 'Request handlers that translate HTTP into service calls.',
    fileCount: 2,
    keyFilePaths: ['src/controllers/auth.controller.ts', 'src/controllers/billing.controller.ts'],
    dependsOnModuleIds: ['src-services', 'src-utils'],
    dependedOnByModuleIds: ['src-routes'],
  },
  {
    id: 'src-routes',
    name: 'routes',
    dirPath: 'src/routes',
    purposeByConvention: 'URL-to-handler mapping and router composition.',
    fileCount: 3,
    keyFilePaths: [
      'src/routes/index.ts',
      'src/routes/auth.routes.ts',
      'src/routes/billing.routes.ts',
    ],
    dependsOnModuleIds: ['src-controllers'],
    dependedOnByModuleIds: [],
  },
  {
    id: 'src-services',
    name: 'services',
    dirPath: 'src/services',
    purposeByConvention: 'Business logic and orchestration between models and controllers.',
    fileCount: 4,
    keyFilePaths: [
      'src/services/auth.service.ts',
      'src/services/billing.service.ts',
      'src/services/session.service.ts',
      'src/services/token.service.ts',
    ],
    dependsOnModuleIds: ['src-utils'],
    dependedOnByModuleIds: ['src-controllers'],
  },
  {
    id: 'src-utils',
    name: 'utils',
    dirPath: 'src/utils',
    purposeByConvention: 'Shared helpers with no domain knowledge.',
    fileCount: 2,
    keyFilePaths: ['src/utils/logger.ts', 'src/utils/format.ts'],
    dependsOnModuleIds: [],
    dependedOnByModuleIds: ['src-controllers', 'src-services', 'web-src'],
  },
  {
    id: 'web-src',
    name: 'src',
    dirPath: 'web/src',
    purposeByConvention: 'React admin interface source root.',
    fileCount: 3,
    keyFilePaths: ['web/src/components/LoginForm.tsx', 'web/src/App.tsx'],
    dependsOnModuleIds: ['src-utils'],
    dependedOnByModuleIds: [],
  },
];

export const DIAGNOSTICS = [
  {
    severity: 'info' as const,
    code: 'ENCODING_LOSSY',
    path: 'src/legacy/old-mailer.ts',
    message: 'File contained bytes that are not valid UTF-8; decoded with replacement characters.',
  },
  {
    severity: 'warning' as const,
    code: 'PARSE_FAILED',
    path: 'web/src/vendor.min.js',
    message: 'File was skipped before parsing because it is minified.',
  },
  {
    severity: 'info' as const,
    code: 'SYMLINK_OUTSIDE_REPO',
    path: 'web/node_modules',
    message: 'Symlink points outside the repository root and was not followed.',
  },
  {
    severity: 'warning' as const,
    code: 'TSCONFIG_UNREADABLE',
    path: 'web/tsconfig.json',
    message: 'tsconfig.json could not be parsed; path aliases from it were ignored.',
  },
];
