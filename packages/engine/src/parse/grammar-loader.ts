/**
 * @onboard/engine — WASM grammar loading (Section 4, Section 14 "known hard
 * parts" #1, Section 6.1's `grammarFingerprint`).
 *
 * The grammar directory is ALWAYS a caller-supplied parameter — never a
 * hardcoded path. Grammars ship as Tauri `resources` (not embedded in the
 * compiled sidecar binary), and the Rust shell passes `--grammars-dir
 * "<resolved path>"` at runtime (Phase 5); tests pass `packages/engine/
 * grammars` directly. There is no fallback path anywhere in this module.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Language, Parser } from 'web-tree-sitter';
// `type: 'file'` (not a bare specifier + the library's own internal
// `new URL('tree-sitter.wasm', import.meta.url)` lookup) is required so
// `bun build --compile` actually embeds this asset: inside a compiled
// binary, `web-tree-sitter`'s own runtime-WASM lookup resolves to a virtual
// `B:\~BUN\root\tree-sitter.wasm` path that plain `node:fs`/`fetch` cannot
// read, so `Parser.init()` fails with ENOENT on every call — silently
// degrading every parse to `PARSE_FAILED` rather than throwing (see
// `docs/DECISIONS.md`). `Bun.file(path).arrayBuffer()` IS able to read the
// embedded asset back out; handing those bytes to `Parser.init({
// wasmBinary })` bypasses the library's own broken file lookup entirely.
import TREE_SITTER_WASM_PATH from 'web-tree-sitter/tree-sitter.wasm' with { type: 'file' };
import { sha256Hex } from '../util/hash';
import type { SupportedLanguageId } from './language-parser';

const GRAMMAR_FILE_NAMES: Readonly<Record<SupportedLanguageId, string>> = {
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
};

const SUPPORTED_LANGUAGE_IDS: readonly SupportedLanguageId[] = [
  'javascript',
  'typescript',
  'tsx',
  'python',
];

/** Thrown when a grammar `.wasm` file is missing or fails to load as a `Language`. */
export class GrammarLoadError extends Error {
  readonly code = 'E_GRAMMAR_LOAD_FAILED' as const;
  readonly languageId: SupportedLanguageId;
  readonly filePath: string;

  constructor(languageId: SupportedLanguageId, filePath: string, cause: unknown) {
    super(`Failed to load grammar '${languageId}' from '${filePath}': ${String(cause)}`);
    this.name = 'GrammarLoadError';
    this.languageId = languageId;
    this.filePath = filePath;
  }
}

/** Loads and caches `Language` instances for a single `grammarsDir`. */
export interface GrammarLoader {
  getLanguage(languageId: SupportedLanguageId): Promise<Language>;
}

function grammarFilePath(grammarsDir: string, languageId: SupportedLanguageId): string {
  return join(grammarsDir, GRAMMAR_FILE_NAMES[languageId]);
}

async function loadLanguage(grammarsDir: string, languageId: SupportedLanguageId): Promise<Language> {
  const filePath = grammarFilePath(grammarsDir, languageId);
  let bytes: Buffer;
  try {
    bytes = readFileSync(filePath);
  } catch (error) {
    throw new GrammarLoadError(languageId, filePath, error);
  }
  try {
    return await Language.load(new Uint8Array(bytes));
  } catch (error) {
    throw new GrammarLoadError(languageId, filePath, error);
  }
}

/**
 * PROCESS-GLOBAL, not per-loader, and that distinction is the whole point.
 *
 * `Parser` is a module singleton over ONE Emscripten WASM runtime, so
 * `Parser.init()` initializes shared global state. This promise used to live
 * inside `createGrammarLoader`, which memoized it PER LOADER — correct for the
 * `Language` cache below (that genuinely depends on `grammarsDir`) and wrong
 * for this (which does not). Two loaders created concurrently therefore each
 * called `Parser.init()`, the second re-initialized the runtime while the
 * first's `Language.load()` was in flight, and the language came back as
 * version 0:
 *
 *     Incompatible language version 0. Compatibility range 13 through 15
 *
 * Every file in the losing run then failed to parse, so its symbols, imports
 * and edges vanished and its diagnostics grew — which is precisely the
 * divergence measured between two overlapping `analyze()` calls (107 differing
 * leaves; see `docs/DECISIONS.md`).
 *
 * Note the shape: this module's header already records an earlier
 * `Parser.init()` defect that "silently degrad[ed] every parse to
 * `PARSE_FAILED` rather than throwing". Same function, same silent
 * degradation, second time — which is why `parse-concurrency.test.ts` now
 * pins it instead of a comment.
 */
let globalInitPromise: Promise<void> | null = null;

function ensureParserInitialized(): Promise<void> {
  globalInitPromise ??= Bun.file(TREE_SITTER_WASM_PATH)
    .arrayBuffer()
    .then((wasmBinary) => Parser.init({ wasmBinary }));
  return globalInitPromise;
}

/**
 * Creates a loader scoped to `grammarsDir`. Each language's `Language` is
 * loaded and cached at most once per loader, so the parser pool never reloads
 * a WASM grammar once it has been requested (schema.sql's
 * `idx_file_cache_lang` comment). The runtime initialization those loads
 * depend on is shared across every loader in the process — see above.
 */
export function createGrammarLoader(grammarsDir: string): GrammarLoader {
  const cache = new Map<SupportedLanguageId, Promise<Language>>();

  async function ensureInitialized(): Promise<void> {
    await ensureParserInitialized();
  }

  return {
    async getLanguage(languageId: SupportedLanguageId): Promise<Language> {
      await ensureInitialized();
      let entry = cache.get(languageId);
      if (entry === undefined) {
        entry = loadLanguage(grammarsDir, languageId);
        cache.set(languageId, entry);
      }
      return entry;
    },
  };
}

/**
 * `grammarFingerprint = sha256(concat(sorted grammar file hashes))` (Section
 * 6.1). Computed from the same `grammarsDir` the loader reads from, so the
 * cache is invalidated whenever the vendored `.wasm` bytes change.
 */
export function computeGrammarFingerprint(grammarsDir: string): string {
  const fileHashes = SUPPORTED_LANGUAGE_IDS.map((languageId) =>
    sha256Hex(readFileSync(grammarFilePath(grammarsDir, languageId))),
  ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sha256Hex(fileHashes.join(''));
}
