/**
 * @onboard/engine — constants (Sections 8.1, 8.3, 8.4, 8.5, 8.6, 6.1).
 *
 * Every literal referenced by the deterministic walk (8.1), PageRank (8.3),
 * importance ranking (8.4), the roadmap derivation (8.5), the file
 * classification rules (8.6), and the per-repo SQLite cache (6.1) lives
 * here as an `UPPER_SNAKE_CASE` export. No later module may inline one of
 * these values — import it from here instead.
 *
 * Raw classification *tables* (segment lists, regexes assembled into an
 * ordered rule set) are re-exported from `classify/convention-tables.ts`,
 * which imports the literal arrays defined below and assembles them into
 * the ordered rule structure `classify-file.ts` evaluates. This file holds
 * only the literal data, never the rule-evaluation logic.
 */

// ---------------------------------------------------------------------------
// Section 8.1 — deterministic filesystem walk
// ---------------------------------------------------------------------------

/** Hard repo ceiling (A16): candidate files after ignore filtering. */
export const MAX_REPO_FILES = 25_000;

/** Directory basenames dropped unconditionally, matched as a whole segment. */
export const HARD_IGNORE_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  '.idea',
  '.vscode',
  'site-packages',
  '.cache',
  '.parcel-cache',
  'bower_components',
];

/** Lockfiles, minified bundles, source maps, and binary/media extensions. */
export const HARD_IGNORE_GLOBS: readonly string[] = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'poetry.lock',
  'Pipfile.lock',
  '**/*.min.js',
  '**/*.map',
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.svg',
  '*.ico',
  '*.webp',
  '*.mp4',
  '*.mov',
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.eot',
  '*.pdf',
  '*.zip',
  '*.tar',
  '*.gz',
  '*.exe',
  '*.dll',
  '*.so',
  '*.dylib',
  '*.wasm',
  '*.bin',
];

/** A file above this size is skipped as `too-large` and never opened for parsing. */
export const MAX_PARSE_BYTES = 1_572_864;

/**
 * Section 10's "File > 2 MB opened in the viewer" edge case (`E_FILE_TOO_LARGE`).
 * Deliberately separate from `MAX_PARSE_BYTES`: this gates `engine.readFile`'s
 * file-viewer path, not parsing/indexing, and the copy table's "2 MB" is a
 * distinct, larger threshold than the 1.5 MB parse-skip limit.
 */
export const MAX_VIEWER_FILE_BYTES = 2 * 1024 * 1024;

/** Number of leading bytes inspected for a NUL byte to detect a `binary` file. */
export const BINARY_CHECK_BYTES = 8192;

/** A line longer than this (in characters) marks the file `minified`. */
export const MINIFIED_MAX_LINE_LENGTH = 5000;

/** A mean line length above this (in characters) marks the file `minified`. */
export const MINIFIED_MEAN_LINE_LENGTH = 400;

// ---------------------------------------------------------------------------
// Section 8.6 — file classification
// ---------------------------------------------------------------------------

/** Rule 2 — test directory segment, matched whole (case-insensitive). */
export const TEST_SEGMENT_PATTERN = /^(__tests__|tests?|spec)$/i;
/** Rule 2 — test basename patterns (JS/TS + two Python conventions). */
export const TEST_BASENAME_PATTERNS: readonly RegExp[] = [
  /\.(test|spec)\.[jt]sx?$/i,
  /^test_.*\.py$/i,
  /.*_test\.py$/i,
];

/** Rule 3 — fixture/mock directory segments. */
export const FIXTURE_SEGMENTS: readonly string[] = ['fixtures', '__fixtures__', 'mocks', '__mocks__'];

/** Rule 4 — stylesheet extensions. */
export const STYLE_EXTENSIONS: readonly string[] = ['css', 'scss', 'sass', 'less', 'styl'];

/** Rule 5 — documentation extensions and directory segment. */
export const DOCS_EXTENSIONS: readonly string[] = ['md', 'mdx', 'rst', 'txt'];
export const DOCS_SEGMENT = 'docs';

/**
 * Rule 6 — config filenames not already caught by extension or segment.
 * Not enumerated verbatim by the spec (gap — see docs/DECISIONS.md): filled
 * with the conventional set of named, extensionless (or non-{json,yaml,
 * yml,toml,ini}) config files a v1 JS/TS/Python repo commonly contains.
 */
export const CONFIG_FILENAMES: readonly string[] = [
  'dockerfile',
  'makefile',
  'procfile',
  'vagrantfile',
  'rakefile',
  '.env',
  '.env.example',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.eslintrc',
  '.eslintignore',
  '.prettierrc',
  '.prettierignore',
  '.babelrc',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.browserslistrc',
  '.dockerignore',
  'webpack.config.js',
  'vite.config.js',
  'vite.config.ts',
  'rollup.config.js',
  'babel.config.js',
  'jest.config.js',
  'tailwind.config.js',
  'postcss.config.js',
];
/** Rule 6 — config extensions and directory segment. */
export const CONFIG_EXTENSIONS: readonly string[] = ['json', 'yaml', 'yml', 'toml', 'ini'];
export const CONFIG_SEGMENT = 'config';

/** Rule 7 — generated-file header markers and number of leading lines checked. */
export const GENERATED_HEADER_MARKERS: readonly string[] = ['@generated', 'DO NOT EDIT'];
export const GENERATED_HEADER_CHECK_LINES = 3;
/** Rule 7 — basename infix markers for `/\.(pb|generated)\./`. */
export const GENERATED_BASENAME_INFIXES: readonly string[] = ['pb', 'generated'];

/** Rules 8-16 — directory segments per classification. */
export const ROUTE_SEGMENTS: readonly string[] = [
  'routes',
  'router',
  'pages',
  'app',
  'api',
  'endpoints',
  'urls',
];
export const CONTROLLER_SEGMENTS: readonly string[] = ['controllers', 'handlers', 'views', 'resources'];
export const SERVICE_SEGMENTS: readonly string[] = ['services', 'usecases', 'domain', 'core', 'business'];
export const MODEL_SEGMENTS: readonly string[] = [
  'models',
  'entities',
  'schemas',
  'migrations',
  'repositories',
  'dao',
];
export const COMPONENT_SEGMENTS: readonly string[] = ['components', 'ui', 'widgets', 'elements'];
/** Rule 12 — PascalCase `.tsx` basename (component convention). */
export const PASCAL_CASE_TSX_PATTERN = /^[A-Z][A-Za-z0-9]*\.tsx$/;
/** Rule 13 — hook basename/segment. */
export const HOOK_BASENAME_PATTERN = /^use[A-Z]/;
export const HOOK_SEGMENT = 'hooks';
export const STORE_SEGMENTS: readonly string[] = ['store', 'stores', 'state', 'reducers', 'slices', 'context'];
export const UTIL_SEGMENTS: readonly string[] = [
  'utils',
  'util',
  'helpers',
  'helper',
  'lib',
  'libs',
  'common',
  'shared',
  'constants',
  'types',
];
export const SCRIPT_SEGMENTS: readonly string[] = ['scripts', 'bin', 'tools', 'cmd'];

/**
 * Rule 17 — asset extensions. Most binary/media extensions never reach
 * classification because `HARD_IGNORE_GLOBS` drops them at the walk boundary
 * (8.1); this table is for text-ish asset formats that are still walked and
 * parsed-skipped rather than ignored outright. Not enumerated verbatim by
 * the spec (gap — see docs/DECISIONS.md).
 */
export const ASSET_EXTENSIONS: readonly string[] = [
  'html',
  'htm',
  'xml',
  'graphql',
  'gql',
  'proto',
  'sql',
  'csv',
  'plist',
];

/** Section 8.6 — module derivation thresholds. */
export const MODULE_MIN_FILES = 3;
export const MAX_MODULES = 40;

// ---------------------------------------------------------------------------
// Section 8.3 — PageRank
// ---------------------------------------------------------------------------

export const PAGERANK_DAMPING = 0.85;
export const PAGERANK_MAX_ITERATIONS = 100;
export const PAGERANK_EPSILON = 1e-6;
export const PAGERANK_PRECISION = 6;

// ---------------------------------------------------------------------------
// Section 8.4 — importance ranking
// ---------------------------------------------------------------------------

export const W_PAGERANK = 0.55;
export const W_IN_DEGREE = 0.3;
export const W_ROLE = 0.15;

/** `roleBoost` classification buckets, checked top to bottom (first match wins). */
export const ROLE_BOOST_HIGH = 0.8;
export const ROLE_BOOST_HIGH_CLASSIFICATIONS: readonly string[] = ['route', 'controller', 'service', 'store'];
export const ROLE_BOOST_MEDIUM = 0.6;
export const ROLE_BOOST_MEDIUM_CLASSIFICATIONS: readonly string[] = ['model', 'component', 'hook'];
export const ROLE_BOOST_LOW = 0.3;
export const ROLE_BOOST_LOW_CLASSIFICATIONS: readonly string[] = ['util', 'config'];
export const ROLE_BOOST_ENTRYPOINT = 1.0;

export const TOP_IMPORTANT_FILES = 20;

// ---------------------------------------------------------------------------
// Section 8.5 — "start here" roadmap derivation
// ---------------------------------------------------------------------------

export const MAX_ROADMAP_SEEDS = 5;
export const MAX_ROADMAP_DEPTH = 12;
export const MAX_UNREACHED_STEPS = 10;
export const ROADMAP_TARGET_LENGTH = 12;
export const ROADMAP_MAX_LENGTH = 25;
export const ROADMAP_DEPENDS_ON_CAP = 8;
/** Section 8.5 step 5's leaf-utility segment set (a literal list, distinct from `UTIL_SEGMENTS`). */
export const ROADMAP_LEAF_UTILITY_SEGMENTS: readonly string[] = [
  'utils',
  'util',
  'helpers',
  'helper',
  'lib',
  'libs',
  'constants',
  'types',
  'config',
];
export const ROADMAP_LEAF_UTILITY_CLASSIFICATIONS: readonly string[] = ['util', 'config'];

// ---------------------------------------------------------------------------
// Section 6.1 — per-repo SQLite cache
// ---------------------------------------------------------------------------

/** `PRAGMA user_version` / `schema_meta['cacheSchemaVersion']`. */
export const CACHE_SCHEMA_VERSION = 1;

/** Cap on `token_index.lines_json` entries per (token, path) pair. */
export const MAX_LINES_PER_TOKEN = 20;

/** `repoId = sha256(canonicalAbsoluteRepoPath).slice(0, REPO_ID_HEX_LENGTH)`. */
export const REPO_ID_HEX_LENGTH = 16;

/** Length of a full lowercase-hex sha256 digest. */
export const SHA256_HEX_LENGTH = 64;

// ---------------------------------------------------------------------------
// Section 8.7 — "where is X?" search and ranking
// ---------------------------------------------------------------------------

export const MIN_SEARCH_TERM_LENGTH = 3;
export const EXPANSION_DECAY = 0.6;
export const MAX_SEARCH_CANDIDATES = 2000;

export const W_SYMBOL_EXACT = 100;
export const W_SYMBOL_PREFIX = 60;
export const W_SYMBOL_SUBSTRING = 30;
export const W_FILENAME_EXACT = 45;
export const W_FILENAME_SUBSTR = 20;
export const W_PATH_SEGMENT = 15;
export const W_CONTENT_CAP = 24;
export const W_EXPORTED_BONUS = 8;
export const W_IMPORTANCE = 25;
export const P_TEST = -20;
export const P_GENERATED = -30;
export const P_FIXTURE = -15;

export const SEARCH_SCORE_PRECISION = 3;
/** Max `lineHits` per `SearchHit` (Section 8.7 step 6). */
export const MAX_LINE_HITS = 5;
/** Max characters of a `lineHits[].preview` (Section 8.7 step 6). */
export const LINE_HIT_PREVIEW_MAX_CHARS = 200;
