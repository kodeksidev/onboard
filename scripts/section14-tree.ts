/**
 * Parses Section 14's "Directory layout" tree out of the build prompt and
 * diffs it against the real repository.
 *
 * Written because a hand-read diff of a 90-line tree is not checkable, and
 * mine was wrong: I reported `docs/` as absent from Section 14 when Section
 * 14 enumerates it with nine files. A batch amendment resting on a hand-built
 * diff needs the diff itself to be mechanical.
 *
 * This module is the shared derivation; `docs:check` consumes it so the
 * enumerated tree and the real tree cannot drift again without failing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const REPO_ROOT = join(import.meta.dir, '..');

const PROMPT_GLOB_DIR = join(REPO_ROOT, 'prompts');

/** Directories whose contents Section 14 summarises rather than enumerates. */
const SUMMARISED_PREFIXES = [
  'packages/engine/fixtures/',
  'packages/engine/test/',
  'packages/engine/dist/',
  'packages/engine/grammars/',
  'packages/contract/dist/',
  'apps/desktop/src/test/',
  'apps/desktop/src-tauri/icons/',
  'apps/desktop/src-tauri/binaries/',
  'apps/desktop/src-tauri/resources/',
  'node_modules/',
];

/** Trees that are build output or vendored input, never hand-authored source. */
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'target',
  '.git',
  'coverage',
  'fixtures',
  'icons',
  'binaries',
  'resources',
  'grammars',
  '__snapshots__',
]);

function promptPath(): string {
  const entries = readdirSync(PROMPT_GLOB_DIR).filter((f) => f.endsWith('.md'));
  const first = entries[0];
  if (first === undefined) {
    throw new Error('no build prompt found under prompts/');
  }
  return join(PROMPT_GLOB_DIR, first);
}

/** Extracts the fenced tree block that follows the `## 14.` heading. */
function section14Block(): readonly string[] {
  const lines = readFileSync(promptPath(), 'utf8').split('\n');
  const start = lines.findIndex((l) => /^##\s*14\./.test(l));
  if (start === -1) {
    throw new Error('Section 14 heading not found');
  }
  const fenceStart = lines.findIndex((l, i) => i > start && l.trim().startsWith('```'));
  const fenceEnd = lines.findIndex((l, i) => i > fenceStart && l.trim().startsWith('```'));
  if (fenceStart === -1 || fenceEnd === -1) {
    throw new Error('Section 14 code fence not found');
  }
  return lines.slice(fenceStart + 1, fenceEnd);
}

/** `a/{b,c}/d` -> [`a/b/d`, `a/c/d`]; handles one group at a time, recursively. */
function expandBraces(token: string): readonly string[] {
  const open = token.indexOf('{');
  if (open === -1) {
    return [token];
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < token.length; i += 1) {
    if (token[i] === '{') depth += 1;
    if (token[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) {
    return [token];
  }
  const prefix = token.slice(0, open);
  const suffix = token.slice(close + 1);
  const inner = token.slice(open + 1, close);
  const parts: string[] = [];
  let buf = '';
  let d = 0;
  for (const ch of inner) {
    if (ch === '{') d += 1;
    if (ch === '}') d -= 1;
    if (ch === ',' && d === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts.flatMap((p) => expandBraces(`${prefix}${p}${suffix}`));
}

/**
 * Rebuilds full paths from the box-drawing tree.
 *
 * Indentation depth is measured in 3-character columns, which is the width
 * the prompt uses for each nesting level. A line without a `├`/`└` marker is
 * a continuation of the previous entry (the prompt wraps long brace groups),
 * so it is appended before parsing.
 */
interface TreeEntry {
  depth: number;
  text: string;
}

/**
 * Folds the raw fenced block into one logical entry per tree node. The prompt
 * wraps long brace groups onto continuation lines padded with the same
 * box-drawing gutter, so a line with no `├`/`└` marker is appended to the
 * previous entry after its leading `│` and spaces are stripped.
 */
function mergeTreeLines(raw: readonly string[]): readonly TreeEntry[] {
  const merged: TreeEntry[] = [];
  for (const line of raw) {
    if (line.trim() === '' || line.trim() === '│') continue;
    const stripped = line.replace(/\s+#.*$/, '');
    const markerIndex = stripped.search(/[├└]/);
    if (markerIndex === -1) {
      const prev = merged[merged.length - 1];
      if (prev !== undefined) {
        prev.text += stripped.replace(/^[\s│]+/, '');
      }
      continue;
    }
    merged.push({
      depth: Math.round(markerIndex / 3),
      text: stripped.slice(markerIndex + 1).replace(/^[─\s]+/, ''),
    });
  }
  return merged;
}

export function enumeratedPaths(): ReadonlySet<string> {
  const merged = mergeTreeLines(section14Block());
  const stack: string[] = [];
  const out = new Set<string>();

  for (const { depth, text } of merged) {
    // A line can hold several space-separated siblings.
    const tokens = text.split(/\s+/).filter((t) => t.length > 0);
    let dirForDepth: string | undefined;
    for (const token of tokens) {
      for (const expanded of expandBraces(token)) {
        const isDir = expanded.endsWith('/');
        const clean = isDir ? expanded.slice(0, -1) : expanded;
        if (clean === '' || clean === 'CodeBase onboarding') continue;
        const parent = stack.slice(0, depth).join('/');
        const full = parent === '' ? clean : `${parent}/${clean}`;
        if (isDir) {
          dirForDepth = clean;
        } else {
          out.add(full);
        }
      }
    }
    stack[depth] = dirForDepth ?? stack[depth] ?? '';
    if (dirForDepth !== undefined) {
      stack.length = depth + 1;
      stack[depth] = dirForDepth;
    }
  }
  return out;
}

/** Every hand-authored file actually in the tree. */
export function actualPaths(): ReadonlySet<string> {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      // Dotfiles ARE enumerated by Section 14 (`.prettierrc`, `.editorconfig`,
      // `.gitignore`), so they must be walked; only VCS/tooling state is skipped.
      if (entry === '.git' || entry === '.claude' || entry === '.vscode') continue;
      if (IGNORED_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      out.add(relative(REPO_ROOT, full).split(sep).join('/'));
    }
  };
  walk(REPO_ROOT);
  return out;
}

export function isSummarised(path: string): boolean {
  return SUMMARISED_PREFIXES.some((p) => path.startsWith(p));
}
