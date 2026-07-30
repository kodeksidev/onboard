/**
 * `lint:check-rules-fire` — every rule this repository configures must still FIRE.
 *
 * `bun run lint` exiting 0 proves the linter ran. It does not prove any
 * particular rule survived. A rule that a major version renamed, split, or moved
 * behind a flag stops firing and reports nothing — indistinguishable, from the
 * outside, from a rule that passed. The ESLint 9 -> 10 upgrade is exactly the
 * event that can do that, and the rules at stake carry acceptance criteria:
 * `max-lines` / `max-lines-per-function` / `max-depth` are criterion 27, and
 * `no-restricted-imports` / `no-restricted-globals` / `no-restricted-syntax` are
 * Section 12's second egress layer and Section 8.8's determinism ban.
 *
 * So each one gets a planted violation and must be reported BY NAME.
 *
 * Scope is derived, not listed: the rule set comes from `eslint.config.js`
 * itself, minus whatever `js.configs.recommended` and `typescript-eslint`'s
 * recommended preset contribute. Configure a new rule without demonstrating it
 * and this fails — the demonstration cannot fall behind the config.
 *
 * The banned-module list is derived the same way, from the config's own
 * `no-restricted-imports` paths, so adding `node:http2` to the ban without
 * proving it is banned is also a failure.
 */
import { ESLint } from 'eslint';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

import repoConfig from '../eslint.config.js';

/** Any file path under here is linted with the engine-scoped rules. */
const ENGINE_FILE = 'packages/engine/src/__lint-probe__.ts';
const GRAPH_FILE = 'packages/engine/src/graph/__lint-probe__.ts';
const REPO_FILE = 'packages/contract/src/__lint-probe__.ts';

interface Demonstration {
  readonly rule: string;
  /** Distinguishes the two scopes that configure `no-restricted-syntax`. */
  readonly label: string;
  readonly filePath: string;
  readonly code: string;
}

function rulesIn(config: unknown): Set<string> {
  const found = new Set<string>();
  const entries = Array.isArray(config) ? config : [config];
  for (const entry of entries) {
    const rules = (entry as { rules?: Record<string, unknown> } | undefined)?.rules;
    if (rules) {
      for (const rule of Object.keys(rules)) found.add(rule);
    }
  }
  return found;
}

/** Rules this repository configures, as opposed to ones a preset brought in. */
function repoConfiguredRules(): Set<string> {
  const preset = new Set([
    ...rulesIn(js.configs.recommended),
    ...rulesIn(tseslint.configs.recommended),
  ]);
  const ours = new Set<string>();
  for (const rule of rulesIn(repoConfig)) {
    if (!preset.has(rule)) ours.add(rule);
  }
  return ours;
}

/** The banned specifiers, read out of the config rather than restated. */
function bannedModules(): string[] {
  for (const entry of repoConfig as { rules?: Record<string, unknown> }[]) {
    const option = entry.rules?.['no-restricted-imports'];
    if (!Array.isArray(option)) continue;
    const paths = (option[1] as { paths?: { name: string }[] } | undefined)?.paths;
    if (paths) return paths.map((p) => p.name);
  }
  return [];
}

/** Nested five deep, one past the configured maximum of four. */
function overMaxDepth(): string {
  const opens = Array.from({ length: 5 }, (_, i) => `${'  '.repeat(i + 1)}if (n > ${i}) {`);
  const closes = Array.from({ length: 5 }, (_, i) => `${'  '.repeat(5 - i)}}`);
  return [
    'export function tooDeep(n: number): number {',
    ...opens,
    '      return n;',
    ...closes,
    '  return 0;',
    '}',
  ].join('\n');
}

function overMaxLinesPerFunction(): string {
  const body = Array.from({ length: 55 }, (_, i) => `  const v${i} = ${i};`);
  return ['export function tooLong(): number {', ...body, '  return 0;', '}'].join('\n');
}

function overMaxLines(): string {
  return Array.from({ length: 850 }, (_, i) => `export const c${i} = ${i};`).join('\n');
}

const CRITERION_27_DEMOS: readonly Demonstration[] = [
  { rule: 'max-depth', label: 'repo-wide', filePath: REPO_FILE, code: overMaxDepth() },
  {
    rule: 'max-lines-per-function',
    label: 'repo-wide',
    filePath: REPO_FILE,
    code: overMaxLinesPerFunction(),
  },
  { rule: 'max-lines', label: 'repo-wide', filePath: REPO_FILE, code: overMaxLines() },
];

const EGRESS_DEMOS: readonly Demonstration[] = [
  {
    rule: 'no-restricted-globals',
    label: 'engine: fetch',
    filePath: ENGINE_FILE,
    code: 'export async function go(): Promise<unknown> {\n  return fetch("https://example.com");\n}\n',
  },
  {
    rule: 'no-restricted-syntax',
    label: 'engine: localeCompare',
    filePath: ENGINE_FILE,
    code: 'export function cmp(a: string, b: string): number {\n  return a.localeCompare(b);\n}\n',
  },
  {
    rule: 'no-restricted-syntax',
    label: 'graph/rank: for...of',
    filePath: GRAPH_FILE,
    code: 'export function walk(xs: string[]): void {\n  for (const x of xs) {\n    void x;\n  }\n}\n',
  },
];

function buildDemonstrations(): Demonstration[] {
  return [
    ...CRITERION_27_DEMOS,
    ...EGRESS_DEMOS,
    // One per banned specifier, derived from the config's own list.
    ...bannedModules().map((name) => ({
      rule: 'no-restricted-imports',
      label: `engine: ${name}`,
      filePath: ENGINE_FILE,
      code: `import * as banned from '${name}';\nexport const used = banned;\n`,
    })),
  ];
}

/** Lints each planted violation; returns the demonstrations that stayed silent. */
async function silentDemonstrations(demos: readonly Demonstration[]): Promise<string[]> {
  const eslint = new ESLint();
  const silent: string[] = [];

  for (const demo of demos) {
    const [result] = await eslint.lintText(demo.code, { filePath: demo.filePath });
    const fired = (result?.messages ?? []).some((message) => message.ruleId === demo.rule);
    console.log(`  ${fired ? 'FIRES ' : 'SILENT'}  ${demo.rule}  (${demo.label})`);
    if (!fired) silent.push(`${demo.rule} (${demo.label})`);
  }

  return silent;
}

function refusals(configured: ReadonlySet<string>): string | null {
  if (configured.size === 0) {
    return 'no repo-configured rules derived from eslint.config.js — the scan is broken';
  }
  if (bannedModules().length === 0) {
    return 'no banned modules derived from no-restricted-imports — the scan is broken';
  }
  return null;
}

async function run(): Promise<number> {
  const configured = repoConfiguredRules();
  const refusal = refusals(configured);
  if (refusal) {
    console.error(`REFUSING: ${refusal}`);
    return 1;
  }

  const demonstrations = buildDemonstrations();
  console.log(
    `lint:check-rules-fire — ${configured.size} repo-configured rule(s), ` +
      `${demonstrations.length} planted violation(s)`,
  );

  const silent = await silentDemonstrations(demonstrations);
  if (silent.length > 0) {
    console.error(
      '\nFAILED — configured rules that did NOT fire on a deliberate violation:\n  ' +
        silent.join('\n  ') +
        '\n\nA rule that an upgrade turned into a no-op reports nothing, which looks ' +
        'exactly like a rule passing. (A pure RENAME is caught by ESLint itself, ' +
        'which refuses an unknown rule id — this covers the quieter case.)',
    );
    return 1;
  }

  // Completeness: a rule this repo configures but never demonstrates is a rule
  // whose survival nobody is checking. This is what stops the demonstration set
  // from falling behind eslint.config.js.
  const demonstrated = new Set(demonstrations.map((d) => d.rule));
  const undemonstrated = [...configured].filter((rule) => !demonstrated.has(rule)).sort();
  if (undemonstrated.length > 0) {
    console.error(
      '\nFAILED — rules configured in eslint.config.js with no planted violation:\n  ' +
        undemonstrated.join('\n  ') +
        '\n\nAdd one to buildDemonstrations() so the next major cannot drop it silently.',
    );
    return 1;
  }

  console.log('every repo-configured rule fires on a deliberate violation');
  return 0;
}

process.exit(await run());
