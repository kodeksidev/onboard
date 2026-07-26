// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Section 12's egress chokepoint: packages/engine has NO network capability by
 * construction. These are banned both as bare specifiers and with the `node:`
 * prefix, matching the ban enforced at runtime by src/guard/no-network.ts
 * (Phase 5) and the bundle-scan in `bun run verify:no-network`.
 */
const BANNED_NETWORK_MODULES = [
  'net',
  'node:net',
  'http',
  'node:http',
  'https',
  'node:https',
  'tls',
  'node:tls',
  'dgram',
  'node:dgram',
  'dns',
  'node:dns',
];

const NO_NETWORK_MESSAGE =
  'packages/engine has no network capability by construction (Section 5, Section 12).';

const NO_LOCALE_COMPARE_MESSAGE =
  'localeCompare is locale-sensitive and non-deterministic; sort with `a < b ? -1 : a > b ? 1 : 0` instead (Section 8.8).';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.sqlite',
      'packages/engine/fixtures/**',
      'packages/engine/grammars/**',
      // Vendored fake repos used as TEST INPUT, not source: they exist to be
      // analyzed and are deliberately imperfect. Same rationale as
      // packages/engine/fixtures above.
      'apps/desktop/e2e/fixtures/**',
      'apps/desktop/bench/fixtures/generated/**',
      'apps/desktop/src-tauri/target/**',
      'apps/desktop/src-tauri/binaries/**',
      'apps/desktop/src-tauri/resources/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Section 13 #27 / acceptance criterion 27 — repo-wide, enforced as errors.
    rules: {
      'max-lines': ['error', { max: 800, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: false, skipComments: false }],
      'max-depth': ['error', 4],
    },
  },
  {
    // Test files: `describe(...)` and `test.each(...)` callbacks are suite
    // CONTAINERS, not functions — ESLint cannot tell them apart from real
    // functions, so max-lines-per-function measures the size of a test suite
    // and penalizes thorough testing. Criterion 27's target is production
    // function complexity, so the rule is relaxed here and ONLY here.
    // `max-lines` (800) and `max-depth` (4) stay in force on tests.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
  {
    // Section 12 egress chokepoint + Section 8.8 determinism: packages/engine may
    // never touch the network and may never use locale-sensitive comparison.
    files: ['packages/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: BANNED_NETWORK_MODULES.map((name) => ({
            name,
            message: NO_NETWORK_MESSAGE,
          })),
        },
      ],
      'no-restricted-globals': ['error', { name: 'fetch', message: NO_NETWORK_MESSAGE }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='localeCompare']",
          message: NO_LOCALE_COMPARE_MESSAGE,
        },
      ],
    },
  },
  {
    // Section 8.8: "No Map/Set is ever iterated to produce output... Lint rule
    // no-restricted-syntax bans for...of over a Map/Set inside
    // packages/engine/src/{graph,rank,contract}." A pure-AST selector cannot
    // distinguish a Map/Set from an Array without type information, so this
    // scope bans all `for...of` loops outright, forcing the sorted-array
    // iteration pattern the algorithms in Section 8.3/8.5 rely on. Logged in
    // docs/DECISIONS.md.
    files: ['packages/engine/src/graph/**/*.{ts,tsx}', 'packages/engine/src/rank/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='localeCompare']",
          message: NO_LOCALE_COMPARE_MESSAGE,
        },
        {
          selector: 'ForOfStatement',
          message:
            'for...of is banned in graph/rank to prevent iterating a Map/Set in insertion order; sort keys/values into an array first (Section 8.8).',
        },
      ],
    },
  },
);
