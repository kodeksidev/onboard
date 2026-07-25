# BUILD PROMPT — "Onboard": a local-first desktop app that instantly onboards a developer to any codebase

You are building this from an empty directory. Read the entire prompt before writing code. Every decision below is already made — do not re-open any of them, do not ask questions, do not substitute alternatives. Where you find a gap, choose the most conventional option, implement it, and add a line to `docs/DECISIONS.md`.

---

## 1. Objective

Build **Onboard**, an installable desktop application that a developer points at any local repository to get an instant, accurate onboarding map: what the project is, its stack, its entry points, its most important files, an interactive dependency graph, a module map, a guided "start here" reading roadmap, and a "where is X handled?" search that jumps to exact files and line numbers. The core is **100% deterministic static analysis with zero AI and zero network access**; the same repository in always produces byte-identical JSON out. AI is a fully optional layer the user switches on by pasting an API key in Settings, and the app is completely useful — the whole roadmap, graph, module map, and search — without any AI at all. The product exists because developers run it on proprietary code they are legally forbidden to upload anywhere; the guarantee that **the code never leaves the user's machine** is not a feature, it is the architecture, and it is enforced structurally rather than promised in a README.

---

## 2. Assumptions & constraints (ASSUMPTIONS)

Every item below is a binding decision. Items marked **[user]** came from the requirements interview; the rest are decisions made for you, each with its reason.

**From the user — non-negotiable:**

| # | Decision | Source |
|---|---|---|
| A1 | Engine language is **TypeScript**, shipped as a standalone package reusable as a future npm CLI without modification. | [user] |
| A2 | v1 ships **JS/TS/TSX + Python grammars only**. Go, Rust, Java land in v2 behind the identical `LanguageParser` interface. | [user] |
| A3 | v1 ships **unsigned / ad-hoc installers**. Code signing and macOS notarization are documented in `docs/SIGNING.md` but are explicitly out of scope. | [user] |
| A4 | v1 ships exactly **two AI adapters: Anthropic and Ollama**. DeepSeek and generic OpenAI-compatible are v2 against the same interface. | [user] |
| A5 | Static mode makes **no network calls whatsoever**. AI is off unless a key is stored **and** the master toggle is on. | [user] |
| A6 | Mode indicator strings are frozen verbatim: `🔒 Static mode · no network · nothing leaves this machine` and `☁️ AI mode · <provider>/<model> · snippets sent to <provider>`. | [user] |
| A7 | AI answers **never cite a file path that is not in the symbol/file index**. A citation that fails verification suppresses the answer. | [user] |
| A8 | Engine, Rust shell, and React UI are three separate ownership domains that communicate only through the frozen JSON contract. | [user] |

**Decisions made for you:**

| # | Decision | Reason |
|---|---|---|
| A9 | The engine ships as a **Bun-compiled single-file sidecar binary** (`bun build --compile`), one per target triple, spawned by the Rust shell over stdio JSON-RPC. | The Tauri webview has no Node APIs, cannot spawn workers with filesystem access, and would block on parsing 10k files. Bun gives one self-contained binary per OS with **built-in SQLite** (no native `.node` module to package) and cross-compiles all three targets from a single CI runner. |
| A10 | Cache storage uses `bun:sqlite` behind a `CacheStore` interface; a `node:sqlite` implementation is the v2 npm-CLI adapter. | Keeps A1's npm-reuse promise open without shipping two code paths in v1. |
| A11 | Graph rendering is **Cytoscape.js** (canvas, compound nodes, `fcose` layout, `expand-collapse` extension), not React Flow. | React Flow renders each node as DOM; it degrades badly past ~1k nodes. Cytoscape draws to canvas, has native compound-node collapse for the directory clustering requirement, and runs headless in tests. |
| A12 | Content search is an **in-engine inverted token index in SQLite**, not a bundled ripgrep binary and not SQLite FTS5. | No third binary to package across three OSes, no dependency on FTS5 being compiled in, fully deterministic, and it stores exact line numbers. |
| A13 | The file viewer is **CodeMirror 6, read-only**, not Shiki/Prism. | CodeMirror virtualizes rendering, so a 20k-line file opens instantly; it also gives line-number gutters, jump-to-line, in-file find, and keyboard navigation for free. |
| A14 | Snapshot fixtures are **hand-authored repos vendored into the repository** under `packages/engine/fixtures/`, not pinned git SHAs. | Tests must run with zero network, which is the same guarantee the product makes. Vendored fixtures also let us plant cycles, orphans, alias imports, nested `.gitignore` negations, and fake secrets on purpose. |
| A15 | Package manager and test runner for TS is **Bun workspaces + `bun test`** for `contract`/`engine`; **Vitest 3** for the React app. | Bun is already a hard dependency (A9); the engine's tests must run on the same runtime that ships. The UI never touches `bun:sqlite`, so Vitest + jsdom is the lighter fit. |
| A16 | Hard repo ceiling: **25,000 candidate files** after ignore filtering. Above it, a named error state asks the user to pick a subdirectory. | Bounds memory and keeps the 10k-file performance budget meaningful. |
| A17 | Single-window application, English-only UI, light + dark themes following OS preference, no telemetry of any kind, no auto-update in v1. | Telemetry contradicts the privacy guarantee; auto-update requires signing (A3). |
| A18 | On Linux with no Secret Service / KWallet available, keys are **never written to disk** — the UI offers a session-only in-memory key. | Writing a plaintext key to `~/.config` would break the security model to save a click. |
| A19 | E2E via `tauri-driver` + WebdriverIO on **Windows and Linux only**; macOS has no WebDriver support in Tauri. macOS is covered by manual smoke checklist `docs/MACOS_SMOKE.md`. | Honest gap, documented rather than faked. |
| A20 | License `MIT`, product name `Onboard`, bundle identifier `dev.onboard.app`. | Needed by `tauri.conf.json`; nothing depends on a different value. |
| A21 | Minimum OS: macOS 12, Windows 10 1809 (WebView2 required), Ubuntu 22.04 / equivalent glibc 2.35. | Tauri 2's floor. |
| A22 | The development machine is **Windows 11 with a path containing a space** (`C:\Users\codex\Desktop\ElevateUrBox\CodeBase onboarding`). Every script, CI step, and spawn call must quote paths, and every path in engine output is repo-relative POSIX. | Backslashes and unquoted spaces are the single most likely cause of a determinism or spawn failure here. |

**Coding constraints (from the user's global rules — enforce in CI, do not restate in code comments):** immutable data (never mutate inputs; return new objects), KISS/DRY/YAGNI, files ≤ 800 lines and typically 200–400, functions < 50 lines, nesting ≤ 4 levels with early returns, explicit error handling at every level with no silent swallows, schema validation at every system boundary, `camelCase`/`PascalCase`/`UPPER_SNAKE_CASE`/`use*` naming with `is|has|should|can` boolean prefixes, no magic numbers, TDD (RED → GREEN → REFACTOR), AAA test structure with behavior-describing test names, **≥ 80% line and branch coverage per package**, conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`).

**Agent ownership (strict — a phase may not be executed by the wrong owner):**

- `ts-engine` owns `packages/contract` and `packages/engine`. Never touches Rust, React, or network code.
- `rust-tauri` owns `apps/desktop/src-tauri`. Owns the sidecar lifecycle, the OS keychain, the redaction boundary, and **the single network egress chokepoint**. Never writes analysis logic or React components.
- `react-ui` owns `apps/desktop/src`. Consumes engine JSON through Tauri commands. Never performs analysis, never makes a network call.
- Reviewers run after every phase: `typescript-reviewer` (engine/contract), `react-reviewer` (UI), `code-reviewer` (Rust and cross-cutting), `agent-security` (Phases 12–13), `agent-devops` (Phases 0, 14), `agent-docs` (Phase 15), `tdd-guide` at the start of every implementation phase.

---

## 3. Non-goals

Do not build any of the following. If you find yourself writing one, stop and delete it.

1. Go, Rust, Java, C#, Ruby, PHP, or C/C++ grammars. v1 is JS/TS/TSX + Python (A2).
2. DeepSeek, OpenAI, Azure, Bedrock, or any adapter beyond Anthropic and Ollama (A4).
3. Code signing, notarization, stapling, auto-update, or an app-store submission (A3).
4. A published npm CLI, a `npx onboard` entry point, or a web-hosted version. The engine is *shaped* for reuse; it is not *distributed* in v1.
5. Git history analysis, blame, churn metrics, PR integration, or any VCS feature beyond reading `.gitignore`.
6. Editing, refactoring, or writing files inside the analyzed repository. Onboard is strictly read-only on user code.
7. Call-graph analysis, type inference, dead-code proof, or cross-file symbol resolution beyond import edges. The graph is file → file.
8. Multi-repo workspaces, remote repos, cloning by URL, or SSH/network filesystems as a supported target.
9. Telemetry, crash reporting, analytics, "anonymous usage stats", or update checks (A17).
10. Server-side anything. There is no backend.
11. Streaming token-by-token AI rendering, AI-driven refactoring suggestions, or AI writing to the index.
12. Custom themes, plugin systems, or user-authored analyzers.

---

## 4. Tech stack

Pin these exact major/minor versions in the manifests. One line of justification each.

**Toolchain**
- **Bun 1.2.x** — workspace manager, TS runtime, test runner, and the `--compile` cross-target sidecar builder (A9).
- **TypeScript 5.7** with `"strict": true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — the contract is only worth freezing if the compiler enforces it.
- **Rust 1.82+ (stable)** — required floor for Tauri 2.
- **Node 22 LTS** — CI only, for the Vite/Vitest toolchain; never a runtime dependency of the shipped app.

**Engine (`packages/engine`, `packages/contract`)**
- **zod 4.x** — one schema source for runtime validation and `z.toJSONSchema()` export of the frozen contract.
- **web-tree-sitter 0.25.x** + WASM grammars **tree-sitter-javascript 0.23.x**, **tree-sitter-typescript 0.23.x** (both `typescript` and `tsx` grammars), **tree-sitter-python 0.23.x** — one parser API across languages; the WASM grammars are OS-independent, which removes native-module packaging from the sidecar entirely.
- **`bun:sqlite`** (built in) — per-repo content-hash cache, symbol table, and inverted token index with zero native dependencies (A9, A10).
- **ignore 6.x** — correct `.gitignore` semantics including negation and nesting; hand-rolling this is a known bug farm.
- **No `dependency-cruiser` / `madge`.** Their resolvers walk `node_modules` and vary by environment, which breaks the determinism requirement. Resolution is implemented in-engine (Section 8.2) against explicitly enumerated rules.

**Desktop shell (`apps/desktop/src-tauri`)**
- **Tauri 2.5.x** — small binaries, native filesystem access, per-window CSP and a capability allowlist that makes static mode *structurally* incapable of network access.
- **tauri-plugin-shell 2.x** — sidecar spawn, scoped to exactly one binary name.
- **tauri-plugin-dialog 2.x** — native folder picker; the webview never sees an absolute path it did not receive from a user action.
- **tauri-plugin-store 2.x** — non-secret settings JSON.
- **keyring 3.6** (Rust crate) — OS keychain: Keychain on macOS, Credential Manager on Windows, Secret Service on Linux (A18 fallback).
- **reqwest 0.12** with `rustls-tls`, no default features — the *only* HTTP client in the entire codebase, in the *only* module allowed to make requests.
- **serde / serde_json 1.x**, **tokio 1.x** (`rt-multi-thread`, `process`, `io-util`, `time`) — sidecar supervision and IPC.

**Frontend (`apps/desktop/src`)**
- **React 19.x + Vite 7.x** — Tauri's reference frontend pairing; fast HMR against the mock IPC layer.
- **Tailwind CSS 4.1 + shadcn/ui** — utility styling plus accessible unstyled primitives (dialog, popover, command palette, tabs) so keyboard navigation is correct by default.
- **cytoscape 3.31**, **cytoscape-fcose 2.2**, **cytoscape-expand-collapse 4.1** — canvas graph, force layout that respects compound nodes, directory collapse/expand (A11).
- **CodeMirror 6** (`@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lang-javascript`, `@codemirror/lang-python`, `@codemirror/lang-json`, `@codemirror/lang-markdown`, `@codemirror/search`) — virtualized read-only viewer (A13).
- **@tanstack/react-virtual 3.x** — virtualized symbol/search/file lists.
- **zustand 5.x** — one small store per domain (`repoStore`, `graphStore`, `settingsStore`); Redux is overkill and Context re-renders the graph.

**Testing / CI**
- **`bun test`** — engine + contract unit, integration, snapshot, and coverage.
- **Vitest 3 + @testing-library/react + jsdom** — UI unit/component tests.
- **WebdriverIO 9 + tauri-driver** — E2E on Windows and Linux (A19).
- **fast-check 3.x** — property tests for the redaction pass and the ranking comparator.
- **GitHub Actions** — matrix build (`macos-14`, `windows-2022`, `ubuntu-22.04`).

---

## 5. Architecture

Three processes, three ownership domains, one frozen contract. The engine is the brain; the shell is the only thing that touches the network or secrets; the UI only renders.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Onboard.app  (single Tauri window)                                          │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  WEBVIEW  — React 19 + TS + Tailwind + shadcn/ui      owner: react-ui   │  │
│  │  CSP: default-src 'self'; connect-src 'self' ipc: http://ipc.localhost  │  │
│  │       (no remote origin is reachable from here, in any mode, ever)      │  │
│  │                                                                        │  │
│  │  RepoPicker · OverviewPanel · DependencyGraph(Cytoscape)                │  │
│  │  RoadmapPanel · ModuleMap · WhereIsSearch · FileViewer(CodeMirror)      │  │
│  │  SettingsDialog · ModeIndicator                                         │  │
│  └───────────────────────────────┬────────────────────────────────────────┘  │
│              Tauri IPC (typed commands + events, zod-validated both sides)    │
│  ┌───────────────────────────────▼────────────────────────────────────────┐  │
│  │  RUST CORE  — Tauri 2                              owner: rust-tauri   │  │
│  │  commands/  analyze, search, read_file, settings, ai_*                 │  │
│  │  sidecar/   spawn · supervise · stdio JSON-RPC · progress fan-out      │  │
│  │  secrets/   OS keychain (keyring 3.6) — keys never hit disk or logs    │  │
│  │  privacy/   redaction pass  →  payload caps  →  citation verifier      │  │
│  │  ai/http.rs ◄══ THE ONLY reqwest CLIENT IN THE REPOSITORY ═══════════► │  │
│  └───────────────────────────────┬────────────────────────────────────────┘  │
└──────────────────────────────────┼───────────────────────────────────────────┘
                stdio, newline-delimited JSON-RPC 2.0 (UTF-8)
   ┌──────────────────────────────▼─────────────────────────────────────────┐
   │  ENGINE SIDECAR  — onboard-engine-<triple>       owner: ts-engine       │
   │  Bun single-file binary. NO network capability by construction:         │
   │  `fetch` and node:net/http/https/tls/dgram are stubbed to throw at boot │
   │  and banned by lint + a build-time bundle scan.                         │
   │                                                                        │
   │   walk/ ──► parse/ ──► index/ ──► resolve/ ──► graph/ ──► rank/ ──►     │
   │  (gitignore) (tree-sitter (symbols,  (per-lang  (PageRank,  (roadmap,   │
   │              WASM, pool)   tokens)    rules)     SCC)        modules)   │
   │                            │                                           │
   │                            ▼                                           │
   │                  cache/ bun:sqlite  <appData>/onboard/cache/<id>.sqlite │
   │                            │                                           │
   │                            ▼   AnalysisResult (zod-validated, stable-   │
   │                                sorted, fingerprinted)                   │
   └────────────────────────────┬───────────────────────────────────────────┘
                                │ read-only
                    ┌───────────▼────────────┐
                    │  THE USER'S REPOSITORY │
                    └────────────────────────┘

  AI PATH (only when key stored AND toggle on):
  UI asks → Rust picks files via engine search → Rust redacts → Rust caps
  → reqwest → Anthropic (api.anthropic.com) or Ollama (127.0.0.1:11434)
  → Rust verifies every cited path exists in the index → UI renders.
  The engine is never in this path. The webview never is either.
```

**Responsibilities, hard boundaries:**

- **Engine** turns a directory into `AnalysisResult` and answers `search`. It reads the user's repo and its own SQLite cache. It has no concept of AI, providers, keys, or HTTP.
- **Rust core** owns everything the engine is not allowed to have: process lifecycle, dialogs, secrets, network. It validates every payload crossing both of its boundaries.
- **UI** owns pixels, keyboard, and state. Given a `AnalysisResult` fixture it renders fully with no shell and no engine — this is what lets Phases 7–10 run in parallel with 2–6.

---

## 6. Data model

### 6.1 Per-repo cache — `<appDataDir>/onboard/cache/<repoId>.sqlite`

`repoId = sha256(canonicalAbsoluteRepoPath).slice(0, 16)` (lowercase hex). The absolute path itself is never persisted in the cache and never appears in `AnalysisResult`.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;              -- CACHE_SCHEMA_VERSION

CREATE TABLE schema_meta (
  key   TEXT PRIMARY KEY,             -- 'cacheSchemaVersion' | 'engineVersion'
                                      -- | 'grammarFingerprint' | 'contractSchemaVersion'
  value TEXT NOT NULL
);

CREATE TABLE file_cache (
  path           TEXT PRIMARY KEY,    -- repo-relative POSIX, e.g. 'src/api/user.ts'
  content_hash   TEXT NOT NULL,       -- sha256 of raw bytes, lowercase hex
  size_bytes     INTEGER NOT NULL,
  line_count     INTEGER NOT NULL,
  language       TEXT NOT NULL,       -- 'ts'|'tsx'|'js'|'jsx'|'py'|'json'|'md'|'other'
  classification TEXT NOT NULL,       -- FileClassification enum, Section 8.6
  is_parsed      INTEGER NOT NULL,    -- 0 = skipped (binary/too large/minified)
  skip_reason    TEXT,                -- null when is_parsed = 1
  parsed_json    TEXT NOT NULL        -- ParsedFile JSON: raw imports + symbols + tokens
);
CREATE INDEX idx_file_cache_hash ON file_cache(content_hash);
-- Reason: incremental re-analysis compares stored hash to freshly computed hash in one
-- indexed lookup per file; without it the warm-run budget (Section 10) is unreachable.
CREATE INDEX idx_file_cache_lang ON file_cache(language);
-- Reason: the parser pool batches work per language to avoid reloading WASM grammars.

CREATE TABLE symbol (
  id            TEXT PRIMARY KEY,     -- sha1(path + '#' + name + '#' + startLine)[:16]
  path          TEXT NOT NULL REFERENCES file_cache(path) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  name_lower    TEXT NOT NULL,
  kind          TEXT NOT NULL,        -- function|class|method|const|type|interface|enum
                                      -- |variable|component|hook|route
  start_line    INTEGER NOT NULL,     -- 1-based, inclusive
  end_line      INTEGER NOT NULL,     -- 1-based, inclusive
  is_exported   INTEGER NOT NULL,
  container     TEXT,                 -- enclosing class/function name, null at top level
  signature     TEXT                  -- normalized, max 200 chars, null if unavailable
);
CREATE INDEX idx_symbol_name_lower ON symbol(name_lower);
-- Reason: "where is X?" scores exact/prefix/substring symbol matches first; this is the
-- hot path of the app's everyday feature.
CREATE INDEX idx_symbol_path ON symbol(path, start_line);
-- Reason: the file viewer's symbol outline needs one ordered range scan per file.

CREATE TABLE import_edge (
  from_path    TEXT NOT NULL REFERENCES file_cache(path) ON DELETE CASCADE,
  specifier    TEXT NOT NULL,         -- raw source text, e.g. '@/lib/db' or '..models'
  line         INTEGER NOT NULL,
  to_path      TEXT,                  -- repo-relative POSIX, null when unresolved/external
  to_external  TEXT,                  -- package name when external, else null
  kind         TEXT NOT NULL,         -- static|dynamic|require|reexport|type
  is_type_only INTEGER NOT NULL,
  PRIMARY KEY (from_path, specifier, line)
);
CREATE INDEX idx_import_edge_to ON import_edge(to_path);
-- Reason: in-degree, PageRank iteration, and the "importers of this file" panel all
-- traverse edges in the reverse direction.

CREATE TABLE token_index (
  token     TEXT NOT NULL,            -- lowercase, length >= 3, identifier- or word-split
  path      TEXT NOT NULL REFERENCES file_cache(path) ON DELETE CASCADE,
  count     INTEGER NOT NULL,
  lines_json TEXT NOT NULL,           -- ascending int array, capped at MAX_LINES_PER_TOKEN=20
  PRIMARY KEY (token, path)
);
CREATE INDEX idx_token_index_token ON token_index(token);
-- Reason: content search resolves a query term to candidate files with one index seek
-- instead of scanning the repo; this replaces a bundled ripgrep (A12).

CREATE TABLE analysis_result (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  fingerprint    TEXT NOT NULL,       -- sha256 of canonical JSON, fingerprint field excluded
  result_json    TEXT NOT NULL
);
-- Reason for the single-row CHECK: a repo has exactly one current result; this makes
-- "serve the warm result" a primary-key read with no ordering ambiguity.
```

**Cache invalidation.** On open, read `schema_meta`. If `cacheSchemaVersion != 1`, or `engineVersion` differs from the running binary's version, or `grammarFingerprint` differs from `sha256(concat(sorted grammar file hashes))`, or `contractSchemaVersion != SCHEMA_VERSION`, then **delete the database file and recreate it**. Never migrate: `parsed_json` layout is version-coupled and a partial migration is a determinism hazard. If the file is unreadable or `PRAGMA integrity_check` fails, delete and recreate, and surface the `ERR_CACHE_CORRUPT` info state (Section 10).

### 6.2 Settings — `<appConfigDir>/onboard/settings.json` (tauri-plugin-store)

```jsonc
{
  "settingsVersion": 1,
  "recentRepos": [ { "displayName": "acme-api", "path": "C:/code/acme-api", "lastOpenedIso": "2026-07-25" } ],
  "excludeGlobs": ["**/*.snap"],
  "theme": "system",                 // "system" | "light" | "dark"
  "ai": {
    "isEnabled": false,              // master toggle; false unless user turned it on
    "provider": "anthropic",         // "anthropic" | "ollama"
    "model": "claude-sonnet-4-5",    // free text; ollama default "llama3.1:8b"
    "ollamaBaseUrl": "http://127.0.0.1:11434",
    "hasStoredKey": false            // mirror flag only — the key itself is NEVER here
  }
}
```

Secrets: the API key lives only in the OS keychain under service `dev.onboard.app`, account `ai.<provider>.apiKey`. It is never written to `settings.json`, never logged, never included in an error message, and never sent to the webview — `get_settings` returns `hasStoredKey: boolean`, never the value. `recentRepos[].path` is the one place an absolute path is persisted, and it stays in the Rust/config layer, never in engine output.

---

## 7. API / interface contract — **FROZEN**

**This contract is frozen at the end of Phase 1. No later phase may add, rename, retype, or reorder a field.** If a phase discovers it genuinely needs a change, it stops, raises it as a blocking issue, bumps `SCHEMA_VERSION`, and re-runs Phase 1's gate — it does not edit the schema in passing. Engine and UI are built in parallel against this and nothing else.

### 7.1 `packages/contract/src/analysis-result.ts` (zod 4 — this is the literal source of truth)

```ts
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

/** Repo-relative POSIX path. Never absolute, never backslashes, never './' prefix. */
export const RepoPath = z.string().min(1).regex(/^(?!\/)(?!.*\\)(?!\.\/).+$/);

export const Language = z.enum(['ts', 'tsx', 'js', 'jsx', 'py', 'json', 'md', 'other']);

export const FileClassification = z.enum([
  'entrypoint', 'route', 'controller', 'service', 'model', 'component', 'hook',
  'store', 'util', 'config', 'test', 'fixture', 'script', 'docs', 'style',
  'asset', 'generated', 'unknown',
]);

export const SymbolKind = z.enum([
  'function', 'class', 'method', 'const', 'type', 'interface',
  'enum', 'variable', 'component', 'hook', 'route',
]);

export const EdgeKind = z.enum(['static', 'dynamic', 'require', 'reexport', 'type']);

export const Ecosystem = z.enum(['npm', 'pypi', 'stdlib', 'unknown']);

export const ManifestInfo = z.object({
  path: RepoPath,
  kind: z.enum(['package.json', 'requirements.txt', 'pyproject.toml', 'setup.py',
                'Pipfile', 'go.mod', 'Cargo.toml', 'pom.xml', 'composer.json']),
  projectName: z.string().nullable(),
  version: z.string().nullable(),
  packageManager: z.string().nullable(),   // 'bun'|'pnpm'|'npm'|'yarn'|'poetry'|'pip'|null
});

export const DependencyInfo = z.object({
  name: z.string(),
  versionSpec: z.string(),
  ecosystem: Ecosystem,
  scope: z.enum(['runtime', 'dev', 'peer', 'optional']),
  inferredRole: z.string().nullable(),     // from the static role table only; null if unknown
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
  rank: z.number().int().min(1),           // 1 = most likely; unique within the array
  evidence: z.string(),                    // 'package.json#main' | 'package.json#scripts.start'
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
  pageRank: z.number().min(0),             // exactly 6 decimal places
  importance: z.number().min(0).max(1),    // exactly 6 decimal places, Section 8.4
  importanceRank: z.number().int().min(1), // 1-based, dense, unique
  isParsed: z.boolean(),
  skipReason: z.enum(['binary', 'too-large', 'minified', 'unsupported-language',
                      'unreadable']).nullable(),
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
  importedByPaths: z.array(RepoPath),      // sorted ascending
});

export const UnresolvedImport = z.object({
  fromPath: RepoPath,
  specifier: z.string(),
  line: z.number().int().min(1),
  reason: z.enum(['no-match-on-disk', 'alias-unmapped', 'outside-repo',
                  'dynamic-expression', 'namespace-package']),
});

export const Cycle = z.object({
  id: z.string(),                          // 'cycle-1', 'cycle-2', ... by rank order
  paths: z.array(RepoPath).min(2),         // rotated so the lexicographically smallest is first
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
  companionPaths: z.array(RepoPath),       // other members of the same cycle group, sorted
  section: z.enum(['entry', 'core', 'supporting', 'leaf-utility', 'unreached']),
  why: z.string(),                         // deterministic template output, Section 8.5
  dependsOnPaths: z.array(RepoPath),       // sorted, capped at 8
  dependedOnByCount: z.number().int().min(0),
});

export const ModuleCard = z.object({
  id: z.string(),                          // slug of dirPath, e.g. 'src-api-billing'
  name: z.string(),
  dirPath: RepoPath,
  purposeByConvention: z.string(),         // from the static convention table only
  fileCount: z.number().int().min(0),
  keyFilePaths: z.array(RepoPath),         // top 5 by importance, sorted by rank
  dependsOnModuleIds: z.array(z.string()),
  dependedOnByModuleIds: z.array(z.string()),
});

export const Diagnostic = z.object({
  severity: z.enum(['info', 'warning', 'error']),
  code: z.string(),                        // e.g. 'PARSE_FAILED', 'TSCONFIG_UNREADABLE'
  path: RepoPath.nullable(),
  message: z.string(),
});

export const AnalysisResult = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  fingerprint: z.string().length(64),      // sha256 of canonical JSON with this field ''
  repo: z.object({
    id: z.string().length(16),
    name: z.string(),
    rootPathHash: z.string().length(64),   // absolute path is NEVER emitted
    detectedType: z.string(),              // e.g. 'Node.js service', 'React application',
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
  importantFilePaths: z.array(RepoPath),   // top 20, importance desc
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
    walkMs: z.number(), parseMs: z.number(), resolveMs: z.number(),
    graphMs: z.number(), totalMs: z.number(), cacheHitCount: z.number().int(),
  }),
});
```

**Array sort order (part of the contract, asserted by tests):** `files`, `directories`, `symbols`(then `startLine`), `unresolvedImports`(then `line`), `externalDependencies`(by `packageName`), `graph.orphanPaths`, `diagnostics`(by `code`, then `path`) — all ascending by `path` using `Intl`-free byte comparison (`a < b`). `edges` — ascending by `fromPath`, then `line`, then `specifier`. `entryPoints` — ascending by `rank`. `importantFilePaths` and `roadmap.steps` — by their own rank/order fields. `stack.dependencies` — by `name`. `modules` — by `dirPath`. `graph.cycles` — by `edgeCount` desc, then `paths[0]` asc.

### 7.2 Search contract — `packages/contract/src/search.ts`

```ts
export const SearchRequest = z.object({
  repoId: z.string().length(16),
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(200).default(50),
});

export const SearchHit = z.object({
  path: RepoPath,
  score: z.number(),                         // 3 decimal places
  matchKinds: z.array(z.enum(['symbol-exact', 'symbol-prefix', 'symbol-substring',
                              'filename-exact', 'filename-substring', 'path-segment',
                              'content'])),
  symbol: SymbolEntry.nullable(),            // best-scoring symbol hit in this file
  lineHits: z.array(z.object({ line: z.number().int().min(1), preview: z.string().max(200) }))
             .max(5),
  importance: z.number().min(0).max(1),
});

export const SearchResponse = z.object({
  query: z.string(),
  expandedTerms: z.array(z.string()),        // shown in the UI so ranking is explainable
  droppedTerms: z.array(z.string()),         // terms < 3 chars, surfaced as a notice
  hits: z.array(SearchHit),
  totalCandidateCount: z.number().int().min(0),
});
```

### 7.3 Sidecar JSON-RPC (Rust ⇄ engine, stdio, newline-delimited JSON-RPC 2.0)

| Method | Params | Result | Notes |
|---|---|---|---|
| `engine.version` | `{}` | `{ engineVersion, contractSchemaVersion, grammarFingerprint }` | Called at spawn; a mismatch aborts with `E_ENGINE_VERSION_MISMATCH`. |
| `engine.analyze` | `{ repoPath, appDataDir, excludeGlobs, isForceRefresh }` | `AnalysisEnvelope` | Emits `engine.progress` notifications while running. |
| `engine.search` | `SearchRequest` | `SearchResponse` | Requires a completed analysis for `repoId`. |
| `engine.readFile` | `{ repoId, path, maxBytes }` | `{ path, language, lineCount, isTruncated, content }` | Path is confined to the repo root; `..` and escaping symlinks are rejected. |
| `engine.snippets` | `{ repoId, paths, maxLinesPerFile, maxBytesPerFile }` | `{ snippets: [{ path, startLine, endLine, content }] }` | The only source of text the AI path may use. |
| `engine.shutdown` | `{}` | `{}` | Flushes SQLite WAL and exits 0. |

Notification `engine.progress`: `{ phase: 'walk'|'parse'|'resolve'|'graph'|'rank'|'persist', processed: number, total: number, currentPath: string|null }`, emitted at most every 100 ms.

### 7.4 Tauri commands (webview ⇄ Rust)

| Command | Request | Response | Error codes |
|---|---|---|---|
| `pick_repo_folder` | `{}` | `{ path: string \| null }` | — |
| `analyze_repo` | `{ path, isForceRefresh }` | `AnalysisEnvelope` | `E_PATH_NOT_FOUND`, `E_NOT_A_DIRECTORY`, `E_PERMISSION_DENIED`, `E_NO_SUPPORTED_FILES`, `E_REPO_TOO_LARGE`, `E_ENGINE_CRASHED`, `E_ENGINE_TIMEOUT`, `E_ANALYSIS_IN_PROGRESS` |
| `search_repo` | `SearchRequest` | `SearchResponse` | `E_NO_ANALYSIS`, `E_ENGINE_CRASHED` |
| `read_repo_file` | `{ repoId, path }` | `{ path, language, lineCount, isTruncated, content }` | `E_FILE_TOO_LARGE`, `E_PATH_ESCAPES_REPO`, `E_PERMISSION_DENIED` |
| `get_settings` | `{}` | `Settings` (with `hasStoredKey`, never the key) | — |
| `update_settings` | `Partial<Settings>` | `Settings` | `E_INVALID_SETTINGS` |
| `store_ai_key` | `{ provider, apiKey }` | `{ isStored: boolean, isSessionOnly: boolean }` | `E_KEYCHAIN_UNAVAILABLE` |
| `clear_ai_key` | `{ provider }` | `{}` | — |
| `test_ai_key` | `{ provider, model }` | `{ isOk: true, latencyMs, modelEcho }` | `E_AI_KEY_INVALID`, `E_AI_NETWORK`, `E_AI_OLLAMA_UNREACHABLE`, `E_AI_MODEL_NOT_FOUND`, `E_AI_RATE_LIMITED` |
| `ai_project_summary` | `{ repoId }` | `{ markdown, citedPaths, sentFileCount, sentByteCount }` | `E_AI_DISABLED`, `E_AI_*`, `E_AI_CITATION_REJECTED` |
| `ai_explain_module` | `{ repoId, moduleId }` | same shape | same |
| `ai_ask` | `{ repoId, question }` | same shape | same |

Events emitted to the webview: `onboard://analysis-progress` (mirrors `engine.progress`), `onboard://analysis-error`, `onboard://mode-changed`.

**Error envelope, identical everywhere (Rust `AppError`, TS `AppError`):**

```ts
export const AppError = z.object({
  code: z.string(),          // one of the enumerated E_* codes above
  message: z.string(),       // user-facing, from the copy table in Section 10 — never raw
  detail: z.string().nullable(), // developer detail; logged locally, shown behind "Details"
  path: z.string().nullable(),
});
```
No error message ever contains an API key, a keychain value, an absolute path outside the chosen repo, or a raw provider response body.

---

## 8. Core algorithms

Constants live in `packages/engine/src/constants.ts` as `UPPER_SNAKE_CASE` exports. No literal below may appear inline in logic.

### 8.1 Deterministic filesystem walk

```
WALK(repoRoot, excludeGlobs) -> FileRecord[]
  1. stack := [repoRoot]; out := []; visitedRealPaths := Set()
  2. while stack not empty:
     a. dir := stack.pop()
     b. realDir := realpath(dir)
        if visitedRealPaths.has(realDir): continue        # symlink loop guard
        visitedRealPaths.add(realDir)
     c. entries := readdir(dir)
        SORT entries ASCENDING by raw name using byte comparison (NOT locale-aware)
     d. ignoreStack := ignoreStack ++ parse(dir/'.gitignore') if present
        # `ignore` pkg; nested files and '!' negations both honored, deepest file wins
     e. for entry in entries (sorted):
          rel := toPosix(relative(repoRoot, entry))        # backslashes -> '/'
          if isIgnored(rel, ignoreStack) or matchesAny(rel, HARD_IGNORE_DIRS)
             or matchesAny(rel, excludeGlobs): filesIgnored++; continue
          if isDirectory: stack.push(entry)                # pushed in reverse-sorted order
          else: out.push({ rel, sizeBytes })
  3. if out.length > MAX_REPO_FILES (25000): throw E_REPO_TOO_LARGE
  4. SORT out ASCENDING by rel; return out
```
`HARD_IGNORE_DIRS` = `node_modules, .git, .hg, .svn, dist, build, out, target, vendor, coverage, .next, .nuxt, .turbo, .venv, venv, __pycache__, .pytest_cache, .mypy_cache, .tox, .idea, .vscode, site-packages, .cache, .parcel-cache, bower_components`.
`HARD_IGNORE_GLOBS` = lockfiles (`package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb, poetry.lock, Pipfile.lock`), `**/*.min.js`, `**/*.map`, and binary/media extensions (`png jpg jpeg gif svg ico webp mp4 mov woff woff2 ttf eot pdf zip tar gz exe dll so dylib wasm bin`).
Skip rules: `sizeBytes > MAX_PARSE_BYTES (1_572_864)` → `too-large`; any byte 0x00 in the first 8 KB → `binary`; `maxLineLength > 5000 || meanLineLength > 400` → `minified`. Skipped files still appear in `files[]` with `isParsed: false`.
**Complexity:** O(F log F) time from the per-directory sort, O(D) space for the stack. Step 4's global sort is the guarantee the contract's ordering rests on.

### 8.2 Import resolution — exact rules per language

Resolution is pure: `(fromPath, specifier, resolverContext) -> Resolution`. Same inputs, same output, no filesystem probing outside the pre-built `existingPathSet` (built once from the walk in step 8.1, so probing order cannot affect results).

**JS / TS / TSX**
1. Load every `tsconfig.json` / `jsconfig.json` found in the walk; follow `extends` chains up to 8 levels; merge `compilerOptions.baseUrl` and `paths`. An unreadable or cyclic config emits diagnostic `TSCONFIG_UNREADABLE` and is skipped, never thrown.
2. Choose the config for `fromPath`: the one in the nearest ancestor directory. Ties impossible (one per directory).
3. Relative specifier (`./`, `../`): candidate base = `normalize(dirname(fromPath) + '/' + specifier)`.
4. `paths` alias: for each pattern in `paths`, sorted by (number of non-wildcard characters desc, pattern asc), if the specifier matches, substitute each target in declared order to produce candidate bases.
5. `imports` field (`#alias`) in the nearest `package.json`: same substitution.
6. For each candidate base, try in this exact order and take the first hit in `existingPathSet`:
   `base` → `base + .ts` → `.tsx` → `.mts` → `.cts` → `.d.ts` → `.js` → `.jsx` → `.mjs` → `.cjs` → `.json` → `base/index.ts` → `/index.tsx` → `/index.mts` → `/index.js` → `/index.jsx` → `/index.mjs` → `/index.json`.
7. Bare specifier: if it matches a workspace package name (from `package.json#workspaces`, `pnpm-workspace.yaml`, or `lerna.json`), resolve against that package's `exports` → `module` → `main` → `index.*`, then continue at step 6. Otherwise it is **external**: record `packageName` = first segment (or first two for `@scope/name`) and stop. **Never descend into `node_modules`.**
8. No match → `UnresolvedImport` with reason `no-match-on-disk` (or `alias-unmapped` when an alias matched but no target existed).
9. `import(...)` with a non-literal argument → `dynamic-expression`; recorded, not resolved. `import type` / `export type` → edge with `isTypeOnly: true`, kind `type`. `export * from './x'` → kind `reexport`.

**Python**
1. Package roots, ordered by path length desc then path asc: every directory containing `__init__.py` that has no `__init__.py` parent (i.e. package tops), plus `src/` if present, plus every `[tool.poetry].packages` / `[tool.setuptools].packages` dir, plus the repo root.
2. Absolute `import a.b.c` / `from a.b import c`: for each root in order, try `<root>/a/b/c.py`, then `<root>/a/b/c/__init__.py`, then (for the `from` form) `<root>/a/b.py` and `<root>/a/b/__init__.py` when `c` is a symbol rather than a module. First hit wins.
3. Relative `from ..y import z`: dots `n` → walk `n-1` directories up from `dirname(fromPath)`, then apply step 2's suffix rules to `y`.
4. A directory that resolves without an `__init__.py` (PEP 420 namespace package) is recorded as `namespace-package` unresolved unless a concrete `.py` file matched.
5. Unmatched top-level name in `PYTHON_STDLIB_MODULES` (a static, versioned list committed at `packages/engine/src/resolve/python-stdlib.ts`) → external with ecosystem `stdlib`; otherwise external with ecosystem `pypi` if it appears in a manifest, else `unknown`.
6. `__future__`, conditional imports inside `try/except ImportError`, and `importlib.import_module('literal')` are resolved with the same rules; non-literal `importlib` calls → `dynamic-expression`.

**Complexity:** O(E · K) where K ≤ 17 candidate suffixes; all membership tests are O(1) set lookups.

### 8.3 PageRank

```
PAGERANK(nodes, edges) -> Map<path, number>
  N := nodes.length; if N == 0 return {}
  order := nodes sorted ascending by path            # fixes accumulation order
  outLinks[u] := unique set of resolved targets of u, sorted ascending
  rank[u] := 1 / N  for all u
  for iter in 1..PAGERANK_MAX_ITERATIONS (100):
      danglingMass := sum(rank[u] for u where outLinks[u] is empty)
      next[u] := (1 - PAGERANK_DAMPING) / N + PAGERANK_DAMPING * danglingMass / N
      for u in order:                                # deterministic outer order
          share := rank[u] / |outLinks[u]|           # skipped when outLinks empty
          for v in outLinks[u]:                      # deterministic inner order
              next[v] += share
      delta := sum(|next[u] - rank[u]|) over order
      rank := next
      if delta < PAGERANK_EPSILON (1e-6): break
  return { u: roundFixed(rank[u], PAGERANK_PRECISION = 6) for u in order }
```
`PAGERANK_DAMPING = 0.85`. `roundFixed(x, d) = Number(x.toFixed(d))`. Self-edges are dropped before ranking. Duplicate edges collapse to one. **Complexity:** O(I · (V + E)) time, I ≤ 100; O(V) space.

**Why this is deterministic:** the outer loop iterates a sorted array (not a `Map`), the inner loop iterates a sorted array, so every floating-point addition happens in the same sequence on every machine; the iteration count is bounded and the result is rounded to 6 decimals before it ever reaches JSON.

### 8.4 Importance ranking ("most important files")

```
IMPORTANCE(file) :=
    W_PAGERANK   (0.55) * norm(pageRank)
  + W_IN_DEGREE  (0.30) * norm(inDegree)
  + W_ROLE       (0.15) * roleBoost(file)

norm(x) := 0 when max == min, else (x - min) / (max - min), over parsed files only
roleBoost := 1.00 if classification == 'entrypoint'
             0.80 if classification in {route, controller, service, store}
             0.60 if classification in {model, component, hook}
             0.30 if classification in {util, config}
             0.00 otherwise
importance := roundFixed(score, 6), clamped to [0,1]
```
Ranking order: `importance` desc → `inDegree` desc → `lineCount` desc → `path` asc. `importanceRank` is 1-based and dense; ties are impossible because `path` is unique. `importantFilePaths` = first `TOP_IMPORTANT_FILES = 20` entries. Files with `isParsed: false` get `importance = 0` and rank after all parsed files. **Complexity:** O(V log V).

### 8.5 "Start here" roadmap derivation

```
ROADMAP(files, edges, entryPoints, importance) -> RoadmapStep[]
  1. SCC := tarjan(graph)                     # nodes visited in sorted-path order,
                                              # neighbors in sorted order
     Each SCC becomes one group. representative := member with highest importance
     (tie: path asc). companionPaths := remaining members, sorted asc.
     -> this is how cycles are handled: a cycle is ONE step, never a loop in the reading path.
  2. DAG := condensation of SCC; edge A->B when any member of A imports any member of B;
     deduplicated; adjacency lists sorted by representative path.
  3. seeds := SCCs containing an entryPoint, ordered by that entryPoint's rank asc,
     capped at MAX_ROADMAP_SEEDS = 5. If entryPoints is empty, seeds := the single SCC
     with the highest importance representative.
  4. LAYERED BFS following importer -> imported (you read the entry, then its dependencies):
     L0 := seeds
     L(k+1) := { B : A in L(k), A->B in DAG, B unassigned }
     within a layer, order by importance desc -> inDegree desc -> path asc
     stop at MAX_ROADMAP_DEPTH = 12 layers; anything deeper joins layer 12.
  5. LEAF EXTRACTION: an assigned SCC is a leaf utility when
     outDegree_DAG == 0 AND (classification in {util, config} OR
     any path segment in {utils, util, helpers, helper, lib, libs, constants, types, config}).
     Remove it from its layer; it will be appended in step 7.
  6. UNREACHED: SCCs never assigned (orphans / dead code) -> section 'unreached',
     ordered importance desc -> path asc, capped at MAX_UNREACHED_STEPS = 10.
  7. Concatenate: seeds (section 'entry')
                  ++ layers 1..2 (section 'core')
                  ++ layers 3..12 (section 'supporting')
                  ++ leaf utilities, importance desc (section 'leaf-utility')
                  ++ unreached (section 'unreached')
  8. TRIM to ROADMAP_TARGET_LENGTH = 12, hard cap ROADMAP_MAX_LENGTH = 25:
     keep every 'entry' step; fill remaining slots from the concatenated list in
     importance-desc order; then RESTORE the concatenation order among the kept set.
  9. Assign order := 1..n. Attach dependsOnPaths (resolved targets, sorted, capped at 8)
     and dependedOnByCount (in-degree of the representative).
 10. why := template chosen by the FIRST matching rule:
     entry                -> "Entry point ({evidence}). Start reading here."
     companionPaths > 0   -> "Part of a {k}-file import cycle; read these together."
     importanceRank <= 3  -> "Imported by {inDegree} files (rank #{importanceRank} by centrality) — the hub of {moduleName}."
     section == 'core'    -> "{classification} used by {inDegree} files; reached directly from {previousStepFileName}."
     section=='leaf-utility'->"Leaf utility imported by {inDegree} files; read last, for reference."
     section == 'unreached'->"Not reached from any entry point — likely dead code or a separate tool."
     default              -> "{classification} in {moduleName}; imported by {inDegree} files."
```
**Complexity:** Tarjan O(V + E); layering O(V + E); sorting O(V log V). Space O(V + E).

### 8.6 File classification (first matching rule wins, evaluated top to bottom)

```
1. path in entryPointPaths                                      -> entrypoint
2. segment matches /^(__tests__|tests?|spec)$/ or basename matches
   /\.(test|spec)\.[jt]sx?$/ or /^test_.*\.py$/ or /.*_test\.py$/  -> test
3. segment in {fixtures, __fixtures__, mocks, __mocks__}         -> fixture
4. basename matches /\.(css|scss|sass|less|styl)$/               -> style
5. basename matches /\.(md|mdx|rst|txt)$/ or segment == 'docs'    -> docs
6. basename in CONFIG_FILENAMES or ext in {.json,.yaml,.yml,.toml,.ini}
   or segment == 'config'                                        -> config
7. file header contains '@generated' or 'DO NOT EDIT' in first 3 lines
   or basename matches /\.(pb|generated)\./                       -> generated
8. segment in {routes, router, pages, app, api, endpoints, urls}  -> route
9. segment in {controllers, handlers, views, resources}           -> controller
10. segment in {services, usecases, domain, core, business}       -> service
11. segment in {models, entities, schemas, migrations, repositories, dao} -> model
12. segment in {components, ui, widgets, elements} or basename is PascalCase .tsx -> component
13. basename matches /^use[A-Z]/ or segment == 'hooks'            -> hook
14. segment in {store, stores, state, reducers, slices, context}  -> store
15. segment in {utils, util, helpers, helper, lib, libs, common, shared, constants, types} -> util
16. segment in {scripts, bin, tools, cmd}                          -> script
17. ext in ASSET_EXTENSIONS                                        -> asset
18. otherwise                                                      -> unknown
```
Segment matching is case-insensitive and considers **every** path segment, checking the deepest segment first. **Modules** are directories at depth 1–2 below each `sourceRoot` containing ≥ `MODULE_MIN_FILES = 3` parsed files; a file belongs to its deepest qualifying ancestor; module count is capped at `MAX_MODULES = 40`, with the smallest merged into a synthetic `other` module. `purposeByConvention` comes from a static `Record<string, string>` table keyed by lowercased directory name; unknown names get `"{n} files; no directory convention matched."`.

### 8.7 "Where is X?" search and ranking

```
SEARCH(query, limit) -> SearchResponse
  1. terms := lowercase(query).split(/[^a-z0-9_]+/).filter(nonEmpty)
     droppedTerms := terms with length < MIN_SEARCH_TERM_LENGTH (3); remove them
     if terms is empty -> return empty response with droppedTerms populated
  2. expanded := for each term t: KEYWORD_MAP[t] ?? []          # weight * EXPANSION_DECAY
     expandedTerms := union, sorted asc
  3. candidates := union of
       symbol rows where name_lower = t | LIKE t% | LIKE %t%    (per term, direct + expanded)
       files whose basename-without-ext contains t
       files with any path segment equal to t
       token_index rows where token = t
  4. score(file) := sum over (term, weightFactor) of:
       W_SYMBOL_EXACT     100  if any symbol name_lower == term
       W_SYMBOL_PREFIX     60  else if any symbol name_lower startsWith term
       W_SYMBOL_SUBSTRING  30  else if any symbol name_lower includes term
       W_FILENAME_EXACT    45  if basename-without-ext == term
       W_FILENAME_SUBSTR   20  else if basename-without-ext includes term
       W_PATH_SEGMENT      15  if any directory segment == term
       W_CONTENT           min(4 * log2(1 + occurrences), W_CONTENT_CAP = 24)
       W_EXPORTED_BONUS     8  if the best symbol hit is exported
     then, once per file:
       + W_IMPORTANCE      25 * importance
       + P_TEST           -20  if classification == 'test'
       + P_GENERATED      -30  if classification == 'generated'
       + P_FIXTURE        -15  if classification == 'fixture'
     weightFactor = 1.0 for a direct term, EXPANSION_DECAY = 0.6 for an expanded term.
     score := roundFixed(max(score, 0), 3)
  5. sort by score desc -> importance desc -> path asc; take `limit`
  6. lineHits := first 5 lines from token_index.lines_json across all terms,
     sorted asc, each with a preview trimmed to 200 chars with the match kept in frame
```
`KEYWORD_MAP` is a frozen `Record<string, readonly string[]>` in `packages/engine/src/search/keyword-map.ts`, seeded with at minimum: `auth → [auth, login, logout, session, token, jwt, oauth, credential, signin, authenticate, authorize, permission]`, `payment → [payment, pay, stripe, checkout, invoice, billing, charge, subscription, refund]`, `database → [db, database, sql, query, orm, prisma, sequelize, sqlalchemy, migration, schema, repository]`, `routing → [route, router, endpoint, path, url, handler, controller, view]`, `config → [config, settings, env, environment, options, dotenv]`, `logging → [log, logger, logging, winston, pino, tracing, telemetry]`, `cache → [cache, redis, memcached, ttl, invalidate]`, `email → [email, mail, smtp, sendgrid, ses, mailer, template]`, `upload → [upload, file, multipart, s3, storage, blob, attachment]`, `i18n → [i18n, locale, translation, intl, language, translate]`, `permissions → [permission, role, rbac, acl, policy, scope, grant]`, `queue → [queue, job, worker, task, celery, bull, cron, schedule]`, `websocket → [websocket, ws, socket, realtime, subscribe, publish]`, `testing → [test, spec, mock, fixture, stub, assert]`, `error → [error, exception, throw, catch, handler, fallback, retry]`. Users extend it via `<appConfigDir>/onboard/keywords.json` (same shape), merged at query time with user entries taking precedence on key collision. **Complexity:** O(T · C log C) where T = term count and C = candidate files, bounded by `MAX_SEARCH_CANDIDATES = 2000`.

### 8.8 Determinism enforcement — the sources of nondeterminism and their fixes

| Source | Fix |
|---|---|
| Filesystem readdir order (differs macOS/Windows/ext4) | Every `readdir` result is byte-sorted before use (8.1 step 2c); final file list re-sorted globally. |
| `Map`/`Set` insertion-order iteration | No `Map`/`Set` is ever iterated to produce output. Serialization always goes through `[...map.keys()].sort()`. Lint rule `no-restricted-syntax` bans `for...of` over a `Map`/`Set` inside `packages/engine/src/{graph,rank,contract}`. |
| Floating-point accumulation order in PageRank | Fixed sorted iteration order + fixed iteration cap + `roundFixed(x, 6)` before serialization (8.3). |
| Absolute paths / drive letters / separators | `toPosixRelative()` at the walk boundary; `RepoPath` zod regex rejects absolute paths and backslashes; the absolute root appears only as `rootPathHash`. |
| Timestamps, durations, PIDs, hostnames | Excluded from `AnalysisResult` by construction; live only in `AnalysisEnvelope.timings`, which is never snapshotted. |
| Parallel worker completion order | Workers return `(index, ParsedFile)`; results are written into a pre-sized array by index, never appended. |
| Cache hit vs cold parse producing different output | `verify:determinism` runs each fixture cold, then warm, and asserts identical `fingerprint`. |
| JSON key order | `stableStringify()` (recursively sorted keys, no whitespace) is the only serializer used for `fingerprint` and for snapshot writing. |
| Locale-sensitive comparison | All sorts use `a < b ? -1 : a > b ? 1 : 0`. `localeCompare` is banned by lint in `packages/engine`. |
| Env-dependent resolution | Resolution probes an in-memory `existingPathSet` built from the sorted walk, never the live filesystem (8.2). |

**Fingerprint:** `fingerprint = sha256(stableStringify({...result, fingerprint: ''}))`. The determinism test asserts fingerprint equality across: two consecutive cold runs; cold vs warm; and a run with the walk's sort deliberately shuffled by an injected comparator (proving the global re-sort actually saves us).

### 8.9 Redaction pass (runs in Rust, `src-tauri/src/privacy/redact.rs`, before **any** outbound byte)

```
REDACT(snippets) -> RedactedSnippets | Err(E_AI_PAYLOAD_UNSAFE)
  R1 FILE EXCLUSION (whole file dropped, never sent):
     basename == '.env' or startsWith('.env.')
     ext in {pem, key, p12, pfx, jks, keystore, ppk, asc, gpg}
     basename matches /^id_(rsa|dsa|ecdsa|ed25519)/
     basename matches /^(secrets?|credentials?)\./
     path matched any user excludeGlob
  R2 LINE RULES, applied in this fixed order, each replacing the matched VALUE with
     the literal string `<redacted>` while preserving the line's prefix and line count:
     1. PEM blocks: every line between BEGIN .* PRIVATE KEY and END .* PRIVATE KEY
        (inclusive) becomes `<redacted>` — one output line per input line
     2. AWS access key id        AKIA[0-9A-Z]{16}
     3. GitHub token             gh[pousr]_[A-Za-z0-9]{36,}
     4. Slack token              xox[abpsr]-[A-Za-z0-9-]{10,}
     5. Stripe live key          (sk|rk|pk)_live_[A-Za-z0-9]{16,}
     6. Google API key           AIza[0-9A-Za-z_-]{35}
     7. OpenAI key               sk-[A-Za-z0-9]{20,}
     8. Anthropic key            sk-ant-[A-Za-z0-9_-]{20,}
     9. JWT                      eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}
    10. Connection string        [a-z][a-z0-9+.-]*://[^\s:@/]+:[^\s@/]+@   (userinfo only)
    11. Assignment heuristic     (?i)\b\w*(KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL
                                 |PRIVATE|AUTH)\w*\s*[:=]\s*["']?([^\s"',;]{8,})["']?
    12. High-entropy literal     quoted string, length >= 24, >= 3 character classes,
                                 Shannon entropy >= 4.0 bits/char
  R3 IDEMPOTENCE CHECK: re-run R2 on the output. If ANY rule still matches, abort the
     entire request with E_AI_PAYLOAD_UNSAFE. Never send a partially-redacted payload.
  R4 CAPS (enforced after redaction, before send):
     per file  <= AI_MAX_LINES_PER_FILE 200 and AI_MAX_BYTES_PER_FILE 8192
     total     <= AI_MAX_FILES 24 and AI_MAX_TOTAL_BYTES 98304
     overflow: keep highest-ranked files first (search score desc, then path asc),
     drop the tail, and report sentFileCount / sentByteCount to the UI
  R5 The exact payload (post-redaction, post-cap) is written to the local session
     transcript so the user can inspect precisely what left the machine.
```
Redaction preserves line counts exactly, so any line number the model cites still maps to the real file. **Complexity:** O(L · R) with L lines and R = 12 rules; regexes are pre-compiled once with `once_cell::Lazy`.

### 8.10 AI citation verification

```
VERIFY(answerMarkdown, indexedPaths) -> Ok(answer) | Err(E_AI_CITATION_REJECTED)
  1. extract candidate paths: backtick spans and markdown links matching
     /[\w.\-/]+\.(ts|tsx|js|jsx|mjs|cjs|py|json|md|toml|yaml|yml)(:\d+)?/
  2. normalize each to repo-relative POSIX
  3. if any candidate is NOT in indexedPaths -> reject the WHOLE answer, return the
     offending path in AppError.path. Never show a partially-verified answer.
  4. rewrite each verified citation into a clickable token `[[path:line]]` the UI
     renders as a jump link
```
This is the mechanical enforcement of "never invents a path not in the index." **Complexity:** O(A) in answer length.

---

## 9. Roadmap

Phases are sequential unless marked parallel. Every phase: `tdd-guide` first (write failing tests), implement, then the named reviewer, then a conventional commit. A phase is not done until its **Done when** command exits 0.

**Phase 0 — Scaffold & toolchain** · owner `agent-devops`
Goal: an empty-but-verifiable monorepo. Files: `package.json` (Bun workspaces `packages/*`, `apps/*`), `bunfig.toml`, `tsconfig.base.json`, `.editorconfig`, `.gitignore`, `eslint.config.js` (with `no-restricted-imports` banning `node:net|http|https|tls|dgram|dns` and `no-restricted-globals` banning `fetch` inside `packages/engine`), `.prettierrc`, `.github/workflows/ci.yml`, `packages/contract/`, `packages/engine/`, `apps/desktop/` stubs, `docs/DECISIONS.md`. Deps: none.
**Done when:** `bun install && bun run verify` exits 0 (`verify` = `typecheck && lint && test`), and CI green on all three OS runners.

**Phase 1 — FREEZE THE CONTRACT** · owner `ts-engine` · **gate for everything else**
Goal: `packages/contract` exports every schema in Section 7 plus `stableStringify`, `SCHEMA_VERSION`, and `AppError`. Generate `packages/contract/dist/analysis-result.schema.json` via `z.toJSONSchema`. Add `packages/contract/fixtures/sample-analysis.json` — a hand-written, schema-valid `AnalysisEnvelope` for a 24-file fake repo, which is what the UI develops against for Phases 7–10. Deps: Phase 0.
**Done when:** `bun test --filter @onboard/contract` passes with 100% schema-branch coverage; `bun run contract:emit` regenerates a byte-identical JSON Schema (drift check); `AnalysisResult.parse(sample-analysis.json.result)` succeeds; commit tagged `contract-v1` with message `feat: freeze AnalysisResult schema v1`.

> **After Phase 1, three tracks run in parallel: A (2→5, `ts-engine`), B (6, `rust-tauri`), C (7→10, `react-ui`).** They converge at Phase 11.

**Phase 2 — Engine: walk, classify, hash, cache** · `ts-engine`
Goal: Section 8.1 + 8.6 + the SQLite layer. Files: `src/walk/{walk.ts,gitignore.ts,skip-rules.ts}`, `src/classify/{classify-file.ts,convention-tables.ts}`, `src/cache/{cache-store.ts,sqlite-cache-store.ts,schema.sql}`, `src/constants.ts`, `src/util/{posix-path.ts,stable-stringify.ts,hash.ts}`, plus `fixtures/{node-express,react-app,python-flask,mixed-monorepo,kitchen-sink}/`. Deps: Phase 1.
**Done when:** `bun test packages/engine/test/walk` passes, including: nested `.gitignore` with a `!negation`, a symlink loop, a path containing a space, a CRLF file, a 2 MB file skipped as `too-large`, and a minified file skipped as `minified`; walk output is identical across two runs with a shuffled `readdir` stub.

**Phase 3 — Engine: parsing, symbols, tokens** · `ts-engine`
Goal: web-tree-sitter WASM loading, a worker pool, and extraction of raw imports + symbols + tokens per file for JS/TS/TSX/Python. Files: `src/parse/{parser-pool.ts,grammar-loader.ts,language-parser.ts,ts-parser.ts,python-parser.ts,queries/*.scm}`, `src/index/{symbol-index.ts,token-index.ts}`. Deps: Phase 2.
**Done when:** `bun test packages/engine/test/parse` passes; every symbol kind in `SymbolKind` is produced by at least one fixture; parse of `kitchen-sink` produces zero unhandled exceptions and ≥ 1 `PARSE_FAILED` diagnostic for its deliberately broken file; grammar WASM loads from a directory passed by flag, not from a hardcoded path.

**Phase 4 — Engine: resolve, graph, rank, roadmap, modules** · `ts-engine`
Goal: Sections 8.2–8.6, producing a full validated `AnalysisResult`. Files: `src/resolve/{resolve-import.ts,tsconfig-paths.ts,node-resolution.ts,python-resolution.ts,python-stdlib.ts,workspaces.ts}`, `src/graph/{build-graph.ts,pagerank.ts,tarjan-scc.ts,cycles.ts,orphans.ts}`, `src/rank/{importance.ts,roadmap.ts,modules.ts}`, `src/analyze.ts`. Deps: Phase 3.
**Done when:** `bun test packages/engine/test/analyze` passes; snapshot files exist for all 5 fixtures under `test/__snapshots__/`; `bun run verify:determinism` (cold-vs-cold, cold-vs-warm, shuffled-walk — 15 fingerprint comparisons) exits 0; `AnalysisResult.parse()` succeeds on every fixture; engine coverage ≥ 80% lines and branches.

**Phase 5 — Engine: search + JSON-RPC sidecar + compiled binaries** · `ts-engine`
Goal: Section 8.7 plus the stdio server and cross-compiled binaries. Files: `src/search/{search.ts,ranking.ts,keyword-map.ts}`, `src/rpc/{server.ts,methods.ts,progress.ts}`, `src/guard/no-network.ts` (stubs `globalThis.fetch` and the node net modules to throw `EngineNetworkBlockedError` at boot), `src/main.ts`, `scripts/build-sidecar.ts`. Deps: Phase 4.
**Done when:** `bun run build:sidecar` emits `onboard-engine-x86_64-pc-windows-msvc.exe`, `-aarch64-apple-darwin`, `-x86_64-apple-darwin`, `-x86_64-unknown-linux-gnu`; `bun run test:rpc` drives the built binary over stdio through analyze → search → readFile → shutdown; `bun run verify:no-network` passes both the bundle static scan (no `fetch(`/`node:http`/`node:net` in the emitted bundle) and, on Linux CI, a full fixture analysis executed under `unshare -rn`.

**Phase 6 — Rust shell: sidecar, IPC, settings, keychain, lockdown** · `rust-tauri`
Goal: every command in Section 7.4 except the `ai_*` family. Files: `src-tauri/src/{main.rs,lib.rs}`, `src-tauri/src/commands/{analyze.rs,search.rs,read_file.rs,settings.rs}`, `src-tauri/src/sidecar/{spawn.rs,rpc.rs,supervisor.rs}`, `src-tauri/src/secrets/keychain.rs`, `src-tauri/src/error.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`. Deps: Phase 1 (develops against `sample-analysis.json`), integrates the real binary once Phase 5 lands. Sidecar supervision: restart at most `SIDECAR_MAX_RESTARTS = 3` per session, `SIDECAR_ANALYZE_TIMEOUT_SECS = 600`, `SIDECAR_RPC_TIMEOUT_SECS = 30`; one analysis at a time per repo (`E_ANALYSIS_IN_PROGRESS`).
**Done when:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passes; `cargo clippy -- -D warnings` clean; a test asserts `tauri.conf.json` CSP contains no remote origin and `capabilities/default.json` grants no `http:` permission; a test asserts a killed sidecar produces `E_ENGINE_CRASHED` with the copy from Section 10 and restarts once; path-escape test proves `read_repo_file` rejects `../../etc/passwd` and a symlink pointing outside the repo.

**Phase 7 — UI: shell, picker, progress, overview, mode indicator** · `react-ui`
Goal: the app frame rendering entirely from `sample-analysis.json` through `src/ipc/mock-ipc.ts` (selected by `VITE_IPC=mock`). Files: `src/App.tsx`, `src/ipc/{ipc.ts,tauri-ipc.ts,mock-ipc.ts}`, `src/state/{repoStore.ts,settingsStore.ts}`, `src/components/{AppShell,RepoPicker,AnalysisProgress,OverviewPanel,ModeIndicator,EmptyState,ErrorState}/`, `src/copy/messages.ts` (every string from Section 10, one place). Deps: Phase 1.
**Done when:** `bun run --filter @onboard/desktop test` passes; `VITE_IPC=mock bun run dev` renders the overview with no backend; a test asserts `ModeIndicator` renders exactly `🔒 Static mode · no network · nothing leaves this machine` when `ai.isEnabled === false`, for every combination of `hasStoredKey`.

**Phase 8 — UI: dependency graph** · `react-ui`
Goal: Cytoscape view with compound directory nodes, `fcose` layout, expand/collapse, node size by `importance`, color by `moduleId`, click → highlight dependencies + dependents, focus search, and full keyboard navigation. Files: `src/components/DependencyGraph/{DependencyGraph.tsx,useCytoscape.ts,graph-model.ts,graph-style.ts,collapse.ts,keyboard-nav.ts,GraphListFallback.tsx}`. Rules: auto-collapse all directories at depth ≥ 2 when node count > `GRAPH_AUTO_COLLAPSE_THRESHOLD = 600`; `hideEdgesOnViewport: true`, `textureOnViewport: true`, labels hidden below zoom 0.35, `pixelRatio: 1` above 2000 nodes; `animate: false` whenever `prefers-reduced-motion` is set. Keyboard: `Tab` enters, `↑/↓` move by importance rank, `[`/`]` step to dependents/dependencies, `Enter` opens the file, `/` focuses search, `Esc` exits; every focus change announced via `aria-live="polite"`; `GraphListFallback` renders the same data as a semantic table for screen readers. Deps: Phase 7.
**Done when:** UI tests pass; `bun run bench:graph` reports first-paint ≤ 1500 ms at 1000 nodes and p95 scripted-pan frame time ≤ 22 ms at 1000 nodes / ≤ 33 ms at 5000 nodes; an axe-core test on the graph panel reports zero violations.

**Phase 9 — UI: roadmap + module map** · `react-ui`
Goal: the roadmap as a numbered step list **and** as a highlighted route through the graph; module cards. Files: `src/components/RoadmapPanel/{RoadmapPanel.tsx,RoadmapStepCard.tsx,useRoadmapRoute.ts}`, `src/components/ModuleMap/{ModuleMap.tsx,ModuleCardView.tsx}`. Deps: Phase 8.
**Done when:** clicking step *n* focuses and centers that node in the graph (asserted by a test on the Cytoscape mock); the route overlay renders exactly `steps.length - 1` connector segments; module cards render `keyFilePaths` as working jump links.

**Phase 10 — UI: "where is X?" search + file viewer** · `react-ui`
Goal: the everyday feature plus the CodeMirror viewer with imports/importers in-context. Files: `src/components/WhereIsSearch/{WhereIsSearch.tsx,SearchResultRow.tsx,useSearch.ts}`, `src/components/FileViewer/{FileViewer.tsx,useCodeMirror.ts,SymbolOutline.tsx,ImportsPanel.tsx}`. Search is debounced at `SEARCH_DEBOUNCE_MS = 180`, results virtualized, `↑/↓/Enter` navigable, and the expanded terms are displayed so ranking is explainable. Deps: Phase 7.
**Done when:** UI tests pass; a test asserts a result click opens the file **at the hit line**; a 20,000-line fixture file renders in ≤ 400 ms (measured, asserted).

**Phase 11 — Integration & performance** · `rust-tauri` + `react-ui`
Goal: real IPC end-to-end, E2E suite, and the benchmark gate. Files: `apps/desktop/e2e/{picker.spec.ts,graph.spec.ts,search.spec.ts,errors.spec.ts}`, `wdio.conf.ts`, `bench/{run-bench.ts,budgets.json}`, `bench/fixtures/generate-synthetic-repo.ts` (deterministic seed, emits 1k- and 10k-file repos). Deps: Phases 5, 6, 10.
**Done when:** `bun run e2e` green on Windows and Linux; `bun run bench` exits 0 against every budget in Section 10's performance table; a manual pass of `docs/MACOS_SMOKE.md` is recorded.

**Phase 12 — AI layer (optional, off by default)** · `rust-tauri` + `react-ui`, audited by `agent-security`
Goal: Settings AI section, keychain storage, Anthropic + Ollama adapters, redaction, caps, citation verification. Files: `src-tauri/src/ai/{mod.rs,provider.rs,anthropic.rs,ollama.rs,http.rs,prompt.rs,transcript.rs}`, `src-tauri/src/privacy/{redact.rs,caps.rs,verify_citations.rs}`, `src-tauri/src/commands/ai.rs`, `src/components/Settings/{SettingsDialog.tsx,AiSettingsSection.tsx,TestKeyButton.tsx}`, `src/components/AiPanel/{ProjectSummary.tsx,ModuleExplanation.tsx,AskPanel.tsx,SentPayloadDisclosure.tsx}`. The `AiProvider` trait is `async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse, AppError>` and `async fn test(&self) -> Result<TestResult, AppError>` — nothing provider-specific leaks past it. Rate limits: `AI_MAX_REQUESTS_PER_MINUTE = 10`, `AI_MAX_CONCURRENT = 1`. Deps: Phase 11.
**Done when:** `cargo test ai::` and `cargo test privacy::` pass, including a redaction corpus of ≥ 30 planted fake secrets (one per rule, plus 5 negatives that must survive intact) with a fast-check property test asserting idempotence; a test asserts every `ai_*` command returns `E_AI_DISABLED` when the toggle is off *or* no key is stored; a test asserts an answer citing `src/does-not-exist.ts` is rejected wholesale; a test asserts a 400 KB snippet set is capped to ≤ 98,304 bytes and ≤ 24 files; the mode indicator switches to `☁️ AI mode · <provider>/<model> · snippets sent to <provider>` with the real provider and model interpolated.

**Phase 13 — Security audit & fixes** · `agent-security` (read-only) then owning agents
Goal: full audit against the threat model; every CRITICAL and HIGH resolved. Files: `docs/SECURITY_AUDIT.md` plus fixes in place. Deps: Phase 12.
**Done when:** `docs/SECURITY_AUDIT.md` lists zero open CRITICAL and zero open HIGH findings; `cargo audit` and `bun audit` report no unpatched high-severity advisories.

**Phase 14 — Packaging (unsigned)** · `agent-devops`
Goal: installers for all three OSes plus the documented signing path. Files: `.github/workflows/release.yml`, `src-tauri/tauri.conf.json` bundle config (sidecar registered as `externalBin`, WASM grammars as `resources`), `docs/SIGNING.md`, `docs/INSTALL.md`. Deps: Phase 13.
**Done when:** a tagged CI run publishes `Onboard_<version>_x64.dmg`, `Onboard_<version>_aarch64.dmg`, `Onboard_<version>_x64-setup.exe`, `Onboard_<version>_x64_en-US.msi`, `Onboard_<version>_amd64.AppImage`, `Onboard_<version>_amd64.deb`; each artifact launches, picks a folder, and renders a graph on a clean VM; `docs/INSTALL.md` documents the exact Gatekeeper (`xattr -dr com.apple.quarantine`) and SmartScreen ("More info → Run anyway") steps.

**Phase 15 — Documentation** · `agent-docs`
Goal: `README.md` (what it is, install, the privacy model stated plainly, how to optionally enable AI, how to extend `keywords.json`), `docs/ARCHITECTURE.md`, `docs/ENGINE_CONTRACT.md`, `docs/PRIVACY.md`, `docs/V2_BACKLOG.md` (Go/Rust/Java grammars, DeepSeek + OpenAI-compatible adapters, signing/notarization, npm CLI). Deps: Phase 14.
**Done when:** `bun run docs:check` passes (no dead relative links, every `E_*` code documented, every constant in `constants.ts` referenced by name in at least one doc).

---

## 10. Edge cases & failure modes

Every "expected behavior" below that includes UI copy is the **literal string** to ship, defined once in `src/copy/messages.ts`.

| Case | Expected behavior | How it's tested |
|---|---|---|
| No repo chosen yet | Empty state: **"No repository open"** / "Choose a folder to map. Nothing is uploaded — analysis runs entirely on this machine." Button "Choose folder". | `EmptyState` unit test + `e2e/picker.spec.ts` |
| Chosen folder deleted before analysis | `E_PATH_NOT_FOUND` → **"That folder no longer exists"** / "Onboard could not find {name}. It may have been moved, renamed, or deleted." Action "Choose another folder". | `cargo test commands::analyze::path_not_found` |
| Folder unreadable (OS permission) | `E_PERMISSION_DENIED` → **"Onboard can't read this folder"** / "The operating system denied read access to {name}. Grant read permission, or pick a folder you own." | Rust integration test with a chmod-000 dir (Linux/macOS), ACL-denied dir (Windows) |
| Repo has no JS/TS/Python files | `E_NO_SUPPORTED_FILES` → **"No supported source files found"** / "Onboard v1 reads JavaScript, TypeScript, and Python. This folder has none outside ignored paths. Go and Rust support is planned." | Engine test on an empty fixture + UI state test |
| Repo exceeds 25,000 files | `E_REPO_TOO_LARGE` → **"This repository is too large to map in one pass"** / "{n} source files exceed the 25,000-file limit. Pick a subdirectory such as src/ to map a slice of it." Action "Choose a subfolder". | Engine test with a stubbed walk count |
| Single file > 1.5 MB | Skipped, `skipReason: 'too-large'`, listed in a "Skipped files" disclosure; analysis succeeds. | `test/walk/skip-rules.test.ts` |
| Minified / generated file | Skipped as `minified`; if it slips through classification it gets `P_GENERATED` in search. | `kitchen-sink` fixture snapshot |
| Binary file with a source extension | NUL byte in first 8 KB → `skipReason: 'binary'`. | `test/walk/skip-rules.test.ts` |
| Non-UTF-8 / Latin-1 file | Decoded with `utf-8` lossy replacement; diagnostic `ENCODING_LOSSY`; never throws. | fixture with 0xFF bytes |
| CRLF line endings | Line numbers count `\n`; hashing uses raw bytes, so CRLF and LF versions of the same file differ — this is correct and asserted. | `test/util/hash.test.ts` |
| Symlink loop | `realpath` visited-set breaks the loop; diagnostic `SYMLINK_LOOP_SKIPPED`. | fixture with a self-referential symlink (created in test setup, skipped on Windows without dev mode) |
| Symlink escaping the repo | Not followed; diagnostic `SYMLINK_OUTSIDE_REPO`; `read_repo_file` returns `E_PATH_ESCAPES_REPO`. | `cargo test commands::read_file::escape` |
| Nested `.gitignore` with `!` negation | Deepest matching ignore file wins; negations re-include. | `kitchen-sink` fixture with 3 nested ignore levels |
| Path containing a space (this dev machine) | Every spawn quotes arguments; paths round-trip through POSIX normalization unchanged. | `test/util/posix-path.test.ts` + CI job that clones into `./dir with space/` |
| Windows path > 260 chars | Rust uses `\\?\` extended-length prefixes for all filesystem calls. | `cargo test fs::long_path` (Windows-only) |
| Circular imports | Reported in `graph.cycles`; the cycle collapses to one roadmap step with `companionPaths`. | `kitchen-sink` snapshot asserts a known 3-file cycle |
| Orphan / dead files | `graph.orphanPaths`; appear in the roadmap's `unreached` section, capped at 10. | snapshot |
| `import()` with a template literal | `UnresolvedImport` reason `dynamic-expression`; no edge invented. | parse test |
| Barrel re-exports (`export * from`) | Edge with `kind: 'reexport'`; contributes to in-degree normally. | `react-app` fixture snapshot |
| tsconfig `paths` alias (`@/lib/db`) | Resolved per Section 8.2 step 4. | `mixed-monorepo` fixture snapshot |
| Monorepo workspace import (`@acme/core`) | Resolved to the in-repo package entry, never `node_modules`. | `mixed-monorepo` fixture snapshot |
| Python namespace package (no `__init__.py`) | `UnresolvedImport` reason `namespace-package`; diagnostic explains it. | `python-flask` fixture variant |
| Python relative `from ..x import y` | Resolved per Section 8.2 step 3. | python resolution unit test |
| Two files with the same basename | Both indexed; search disambiguates by `path`; no key collision (paths are primary keys). | search test |
| Cache file corrupt / truncated | Deleted and rebuilt; info toast **"Rebuilding the local cache"** / "The cache for {repo} was unreadable and has been reset. Re-analysing from scratch." | engine test writing garbage bytes to the DB |
| Contract `SCHEMA_VERSION` bumped | Cache dropped and rebuilt automatically on next open. | `test/cache/invalidation.test.ts` |
| Sidecar crashes mid-analysis | `E_ENGINE_CRASHED` → **"Analysis stopped unexpectedly"** / "The analysis engine exited before finishing. The log is at {path}. Retrying usually works — the cache keeps completed files." Actions "Retry" / "Open log". Restart ≤ 3×. | `cargo test sidecar::supervisor::crash_restart` |
| Sidecar hangs | `E_ENGINE_TIMEOUT` at 600 s for analyze, 30 s for other RPCs; process killed. | `cargo test sidecar::rpc::timeout` |
| Second analysis started while one runs | `E_ANALYSIS_IN_PROGRESS`; the UI disables the picker rather than queueing. | `cargo test commands::analyze::concurrent` |
| AI toggle on, no key stored | Toggle is disabled with helper text; all `ai_*` return `E_AI_DISABLED`. | `cargo test ai::gating` |
| Invalid API key | `E_AI_KEY_INVALID` → **"That key was rejected"** / "{provider} returned 401. Check the key, then test again. AI stays off until a key passes." | mocked 401 response |
| Ollama not running | `E_AI_OLLAMA_UNREACHABLE` → **"Ollama isn't answering on 127.0.0.1:11434"** / "Start Ollama and pull {model}, then test again. Static mode is unaffected — everything below still works." | connection-refused test |
| Provider rate-limits | `E_AI_RATE_LIMITED` → **"{provider} is rate-limiting Onboard"** / "Wait {n}s and try again. Nothing was sent twice." No automatic retry. | mocked 429 with `retry-after` |
| Model cites a path not in the index | `E_AI_CITATION_REJECTED` → **"Answer withheld — it cited files that aren't in this repo"** / "The model referenced {path}, which is not in the index. Onboard never shows paths it can't verify. Try a narrower question." | `cargo test privacy::verify_citations::rejects_unknown` |
| A secret survives redaction | Request aborted with `E_AI_PAYLOAD_UNSAFE`; nothing is sent. | idempotence property test (fast-check) |
| Linux without a keyring daemon | `E_KEYCHAIN_UNAVAILABLE` → **"No system keyring available"** / "Onboard won't write API keys to disk. Install gnome-keyring or KWallet, or use a session-only key that is forgotten when you quit." Action "Use session-only key". | `cargo test secrets::keychain::unavailable_fallback` (Linux) |
| File > 2 MB opened in the viewer | `E_FILE_TOO_LARGE` → **"File too large to display"** / "{name} is {size}. Onboard displays files up to 2 MB. Open it in your editor instead." | UI + Rust test |
| Graph at 5,000+ nodes | Directories auto-collapse; labels hidden below zoom 0.35; frame budget met. | `bun run bench:graph` |
| `prefers-reduced-motion: reduce` | All Cytoscape animations and CSS transitions disabled. | UI test with a mocked `matchMedia` |
| Keyboard-only user | Full traversal of graph, roadmap, search, and viewer with no pointer; `GraphListFallback` available to screen readers. | `e2e/graph.spec.ts` keyboard path + axe-core |
| Search term shorter than 3 chars | Dropped, reported in `droppedTerms`, surfaced as "Ignored: 'db' (min 3 characters)". | search unit test |
| Search with zero hits | **"Nothing matched '{query}'"** / "Try a concept like auth, payment, or routing — Onboard expands those into related terms." | UI state test |

---

## 11. Testing strategy

**Unit (target: the majority of coverage).** Pure functions in isolation, AAA structure, behavior-named tests (`test('resolves a tsconfig paths alias to the first existing target', ...)`). Covered: path normalization, hashing, gitignore matching, skip rules, classification precedence, every resolver branch per language, PageRank (including an all-dangling graph and a single-node graph), Tarjan on a known 4-SCC graph, importance weighting, roadmap sectioning and trimming, search scoring per weight, keyword expansion merge, `stableStringify`, redaction per rule, citation extraction, and every `AppError` mapping.

**Integration.** Engine end-to-end over each fixture (`analyze()` → `AnalysisResult.parse()` → assertions on counts, cycles, orphans, roadmap length). Sidecar RPC driven as a real subprocess through the full method list. Rust command tests with a stub sidecar for every error code. AI adapters against a local `wiremock` server plus a fake Ollama.

**Snapshot + determinism.** Five fixtures: `node-express` (Express service with routes/controllers/models), `react-app` (components, hooks, barrel re-exports, `@/` alias), `python-flask` (packages, relative imports, `__main__.py`), `mixed-monorepo` (two workspace packages importing each other, one Python service), `kitchen-sink` (cycles, orphans, dynamic imports, nested `.gitignore` with negation, an unparseable file, a minified file, a 2 MB file, planted fake secrets). Snapshots store the full `AnalysisResult` (never `AnalysisEnvelope`). `bun run verify:determinism` runs cold-vs-cold, cold-vs-warm, and shuffled-walk comparisons per fixture and asserts fingerprint equality — 15 assertions total.

**Property.** `fast-check`: redaction idempotence over generated secret-like strings; the search comparator's total ordering (irreflexive, antisymmetric, transitive) over generated hit sets.

**E2E (WebdriverIO + tauri-driver, Windows + Linux).** Four flows: pick a fixture repo → graph renders → click a node → file opens; search "auth" → click a hit → viewer scrolls to the hit line; roadmap step 3 → graph focuses that node; a deleted folder → the exact `E_PATH_NOT_FOUND` copy appears.

**Performance (`bun run bench`, gates CI).**

| Budget | Target | Measurement |
|---|---|---|
| Cold analysis, 1,000 files (~120k LOC) | ≤ 8,000 ms | `bench/run-bench.ts`, median of 5 runs, empty cache |
| Warm analysis, 1,000 files, no changes | ≤ 1,200 ms | same, cache primed |
| Incremental, 1,000 files, 20 changed | ≤ 2,000 ms | same, 20 files touched with new content |
| Cold analysis, 10,000 files | ≤ 60,000 ms | synthetic repo, seed `0xONBOARD` |
| Warm analysis, 10,000 files | ≤ 6,000 ms | same |
| Sidecar peak RSS at 10,000 files | ≤ 1,536 MB | sampled every 250 ms by the bench harness |
| Graph first paint, 1,000 nodes | ≤ 1,500 ms | `performance.now()` from mount to `layoutstop` |
| Scripted pan p95 frame time, 1,000 nodes | ≤ 22 ms | 60 rAF-timestamped frames |
| Scripted pan p95 frame time, 5,000 nodes | ≤ 33 ms | same, clustering active |
| Webview JS heap, 5,000 nodes | ≤ 600 MB | `performance.memory` after layout settle |
| Search query latency, 10,000-file index | ≤ 120 ms p95 | 50 queries from a fixed query list |

Strategies backing these budgets: a worker pool of `min(cpuCount - 1, 8)` parse workers; content-hash cache so warm runs skip parsing entirely; the inverted token index so search never scans files; Cytoscape canvas rendering with LOD and auto-collapse; `@tanstack/react-virtual` for all lists.

**Coverage.** `bun test --coverage` for `contract` and `engine`, `vitest --coverage` for the UI, `cargo llvm-cov` for Rust. CI fails below **80% lines and 80% branches per package**. `packages/engine/src/{graph,rank,resolve,search}` must reach **90%** — these are the modules the whole product's correctness rests on.

---

## 12. Security & validation

**Threat model.** The adversary is accidental data exfiltration — a stray HTTP client, an over-broad AI payload, a key written to disk, a log line with a token. There is no remote attacker because there is no server. The user's source code is the asset.

**The egress chokepoint.** `apps/desktop/src-tauri/src/ai/http.rs` constructs the only `reqwest::Client` in the repository. Enforcement is three-layered: (1) a CI grep asserts `reqwest::Client` and `reqwest::get` appear in exactly one file; (2) `packages/engine` has `fetch` and `node:net|http|https|tls|dgram|dns` banned by ESLint and stubbed to throw at boot by `src/guard/no-network.ts`, with a build-time scan of the emitted bundle; (3) the webview CSP has no remote origin, so even injected code cannot reach the network from the frontend.

**Tauri lockdown (`tauri.conf.json`).**
```
"csp": "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost;
        img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self';
        object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
```
Capabilities grant only `core:event:default`, `core:window:allow-*` for the single window, `dialog:allow-open` (directories only), `os:allow-platform`, and `shell:allow-execute` scoped by name to `onboard-engine`. `http:default` and `fs:default` are **never** added — all filesystem access goes through typed Rust commands. `devtools` is disabled in release builds.

**Input validation at every boundary.** Webview → Rust: every command argument is a `serde` struct with explicit types plus a validation function (`repoId` matches `^[0-9a-f]{16}$`, `path` is non-empty and ≤ 4096 bytes, `query` ≤ 200 chars, `limit` ∈ [1,200]). Rust → sidecar and sidecar → Rust: every JSON-RPC payload is zod- or serde-validated; a malformed frame kills and restarts the sidecar rather than being partially trusted. Rust → UI: the frontend re-parses `AnalysisEnvelope` with zod before it enters the store, so a contract drift fails loudly instead of rendering garbage. Repo files: never `eval`'d, never executed, never used to construct a path — only read and parsed.

**Capability checks per command** (there is no multi-user authz; these are the equivalent confinement checks):

| Command | Check |
|---|---|
| `analyze_repo` | Path exists, is a directory, is not a system root (`/`, `C:\`, `/home`, `/Users`), and is user-selected via the dialog or present in `recentRepos`. |
| `read_repo_file` | `canonicalize(repoRoot + path)` must start with `canonicalize(repoRoot)` after symlink resolution; size ≤ 2 MB; no `..` segments survive normalization. |
| `search_repo` | A completed analysis exists for `repoId`; otherwise `E_NO_ANALYSIS`. |
| `store_ai_key` / `clear_ai_key` | Key length 8–512 chars; written only to the keychain; never returned to the webview; never logged at any level. |
| `test_ai_key`, `ai_*` | `settings.ai.isEnabled === true` **and** a key is retrievable; otherwise `E_AI_DISABLED` before any other work. |
| every `ai_*` | Redaction (8.9) → caps (R4) → send → citation verification (8.10). Skipping any step is a CRITICAL review finding. |

**Secrets handling.** Keys live only in the OS keychain (A18 fallback: session-only memory on Linux without a daemon). `AiKey` is a newtype whose `Debug`/`Display` render `<redacted>`, making an accidental `println!("{:?}")` harmless. Logs go to `<appLogDir>/onboard/onboard.log`, rotate at 5 MB × 3 files, contain no file contents, no keys, and no repo-external absolute paths. The AI transcript (`<appDataDir>/onboard/transcripts/<repoId>.jsonl`) records exactly what was sent post-redaction, so the user can audit the privacy claim themselves; it is cleared by a Settings button.

**Rate limits.** AI: `AI_MAX_REQUESTS_PER_MINUTE = 10`, `AI_MAX_CONCURRENT = 1`, per-request timeout 60 s, no automatic retry on 429 or 5xx. Analysis: one concurrent run per repo. Search: debounced 180 ms and capped at 1 in-flight query, with older queries cancelled.

**Error hygiene.** `AppError.message` is always drawn from `src/copy/messages.ts`; provider response bodies, stack traces, and OS error strings go to `detail`, are logged locally, and are shown only behind a "Details" disclosure.

---

## 13. Acceptance criteria

The work is done when every one of these is objectively true. Each is checkable by a person or by CI.

1. `bun install && bun run verify` exits 0 on Windows, macOS, and Linux, from a repository path containing a space.
2. `packages/contract` exports every schema in Section 7 with `SCHEMA_VERSION === 1`; `bun run contract:emit` produces a byte-identical `analysis-result.schema.json` (no drift).
3. `bun run verify:determinism` exits 0: all 5 fixtures produce identical `fingerprint` values across cold-vs-cold, cold-vs-warm, and shuffled-walk runs.
4. Every path in every `AnalysisResult` is repo-relative POSIX; a test asserts zero occurrences of `\`, `:`, or a leading `/` across all fixture outputs.
5. `AnalysisResult` contains no timestamp, no duration, no absolute path, no hostname, and no PID; timings appear only in `AnalysisEnvelope.timings`.
6. Snapshot tests exist and pass for `node-express`, `react-app`, `python-flask`, `mixed-monorepo`, and `kitchen-sink`.
7. `kitchen-sink`'s snapshot asserts: the known 3-file cycle appears as exactly one `Cycle` and one roadmap step with 2 `companionPaths`; the 2 known orphans appear in `graph.orphanPaths`; the tsconfig alias import resolves; the `import()` template literal is `dynamic-expression`; the minified and 2 MB files are `isParsed: false` with the correct `skipReason`.
8. `bun run verify:no-network` exits 0: the engine bundle contains no network identifier, and a full analysis of all fixtures completes under `unshare -rn` on Linux CI.
9. A test asserts `tauri.conf.json`'s CSP contains no remote origin and `capabilities/default.json` grants neither `http:` nor `fs:` permissions to the webview.
10. Coverage gates pass: ≥ 80% lines and branches for `contract`, `engine`, the UI, and Rust; ≥ 90% for `engine/src/{graph,rank,resolve,search}`.
11. `bun run bench` exits 0 against every budget in Section 11's performance table.
12. Opening a fresh 1,000-file repo shows the overview, graph, roadmap, module map, and working search in under 10 seconds from folder selection, with no configuration and no AI.
13. With `ai.isEnabled === false`, the mode indicator reads exactly `🔒 Static mode · no network · nothing leaves this machine`, and every `ai_*` command returns `E_AI_DISABLED`.
14. With AI enabled, the indicator reads exactly `☁️ AI mode · <provider>/<model> · snippets sent to <provider>` with the real provider and model interpolated.
15. Adding a key takes: open Settings → paste → click "Test key" → inline success in under 5 seconds; the key never appears in `settings.json`, in any log file, or in any IPC response.
16. The redaction corpus test passes: ≥ 30 planted secrets are all replaced by `<redacted>`, 5 negative controls survive unchanged, line counts are preserved exactly, and the pass is idempotent.
17. An outbound AI payload never exceeds 24 files or 98,304 bytes, and the UI displays the actual `sentFileCount` and `sentByteCount` for every AI action.
18. An AI answer citing a path absent from the index is rejected wholesale with `E_AI_CITATION_REJECTED`, showing the offending path.
19. All 14 named error/empty states render the exact copy from Section 10; a UI test asserts each string against `src/copy/messages.ts`.
20. The dependency graph is fully operable with the keyboard alone (enter, traverse by rank, step to dependencies/dependents, open, exit), and axe-core reports zero violations on the graph, roadmap, search, and viewer panels.
21. With `prefers-reduced-motion: reduce`, no Cytoscape animation and no CSS transition runs.
22. `bun run e2e` passes on Windows and Linux; `docs/MACOS_SMOKE.md` is signed off manually.
23. Installers build and launch on all three platforms: `.dmg` (x64 + aarch64), `.exe` + `.msi`, `.AppImage` + `.deb`.
24. `docs/INSTALL.md` documents the exact Gatekeeper and SmartScreen bypass steps for unsigned builds; `docs/SIGNING.md` documents the future signing path.
25. `README.md` covers install, the privacy model, and how to optionally enable AI; `docs/V2_BACKLOG.md` lists exactly the deferred items in Section 3.
26. `docs/SECURITY_AUDIT.md` shows zero open CRITICAL and zero open HIGH findings.
27. No source file exceeds 800 lines, no function exceeds 50 lines, and no block nests deeper than 4 levels — enforced by ESLint (`max-lines`, `max-lines-per-function`, `max-depth`) and clippy, both failing the build.
28. Every commit follows `<type>: <description>`; CI rejects a non-conforming message.

---

## 14. Directory layout

```
CodeBase onboarding/
├─ package.json                       # bun workspaces: packages/*, apps/*
├─ bunfig.toml
├─ tsconfig.base.json
├─ eslint.config.js                   # bans fetch/node:net/... inside packages/engine
├─ .prettierrc  .editorconfig  .gitignore  LICENSE  README.md
├─ .github/workflows/{ci.yml,release.yml}
│
├─ packages/
│  ├─ contract/                                        # owner: ts-engine — FROZEN in Phase 1
│  │  ├─ package.json  tsconfig.json
│  │  ├─ src/{index.ts,analysis-result.ts,search.ts,rpc.ts,error.ts,stable-stringify.ts}
│  │  ├─ fixtures/sample-analysis.json                  # UI develops against this
│  │  ├─ test/{analysis-result.test.ts,stable-stringify.test.ts}
│  │  └─ dist/analysis-result.schema.json               # generated, drift-checked
│  │
│  └─ engine/                                           # owner: ts-engine
│     ├─ package.json  tsconfig.json
│     ├─ src/
│     │  ├─ main.ts                 analyze.ts          constants.ts
│     │  ├─ guard/no-network.ts
│     │  ├─ walk/{walk.ts,gitignore.ts,skip-rules.ts}
│     │  ├─ classify/{classify-file.ts,convention-tables.ts}
│     │  ├─ parse/{parser-pool.ts,grammar-loader.ts,language-parser.ts,
│     │  │        ts-parser.ts,python-parser.ts,queries/{ts.scm,tsx.scm,python.scm}}
│     │  ├─ index/{symbol-index.ts,token-index.ts}
│     │  ├─ resolve/{resolve-import.ts,tsconfig-paths.ts,node-resolution.ts,
│     │  │          python-resolution.ts,python-stdlib.ts,workspaces.ts}
│     │  ├─ graph/{build-graph.ts,pagerank.ts,tarjan-scc.ts,cycles.ts,orphans.ts}
│     │  ├─ rank/{importance.ts,roadmap.ts,modules.ts}
│     │  ├─ search/{search.ts,ranking.ts,keyword-map.ts}
│     │  ├─ stack/{detect-stack.ts,manifests.ts,entry-points.ts,dependency-roles.ts}
│     │  ├─ cache/{cache-store.ts,sqlite-cache-store.ts,schema.sql,invalidation.ts}
│     │  ├─ rpc/{server.ts,methods.ts,progress.ts}
│     │  └─ util/{posix-path.ts,hash.ts,sort.ts,round.ts,logger.ts}
│     ├─ grammars/{tree-sitter-javascript.wasm,tree-sitter-typescript.wasm,
│     │            tree-sitter-tsx.wasm,tree-sitter-python.wasm}
│     ├─ fixtures/{node-express,react-app,python-flask,mixed-monorepo,kitchen-sink}/
│     ├─ test/{walk,parse,resolve,graph,rank,search,cache,analyze}/*.test.ts
│     ├─ test/__snapshots__/*.snap
│     ├─ scripts/{build-sidecar.ts,verify-determinism.ts,verify-no-network.ts}
│     └─ dist/onboard-engine-<target-triple>[.exe]
│
├─ apps/desktop/
│  ├─ package.json  vite.config.ts  index.html  tailwind.config.ts  vitest.config.ts
│  ├─ src/                                              # owner: react-ui
│  │  ├─ main.tsx  App.tsx  index.css
│  │  ├─ ipc/{ipc.ts,tauri-ipc.ts,mock-ipc.ts}
│  │  ├─ state/{repoStore.ts,graphStore.ts,settingsStore.ts,aiStore.ts}
│  │  ├─ copy/messages.ts                               # every user-facing string
│  │  ├─ hooks/{useAnalysis.ts,useSearch.ts,useKeyboardShortcuts.ts,useReducedMotion.ts}
│  │  ├─ components/
│  │  │  ├─ AppShell/{AppShell.tsx,Sidebar.tsx,ModeIndicator.tsx}
│  │  │  ├─ RepoPicker/{RepoPicker.tsx,RecentRepos.tsx}
│  │  │  ├─ AnalysisProgress/AnalysisProgress.tsx
│  │  │  ├─ OverviewPanel/{OverviewPanel.tsx,StackCard.tsx,EntryPointList.tsx,
│  │  │  │                 TopFilesList.tsx}
│  │  │  ├─ DependencyGraph/{DependencyGraph.tsx,useCytoscape.ts,graph-model.ts,
│  │  │  │                   graph-style.ts,collapse.ts,keyboard-nav.ts,
│  │  │  │                   GraphListFallback.tsx,GraphToolbar.tsx}
│  │  │  ├─ RoadmapPanel/{RoadmapPanel.tsx,RoadmapStepCard.tsx,useRoadmapRoute.ts}
│  │  │  ├─ ModuleMap/{ModuleMap.tsx,ModuleCardView.tsx}
│  │  │  ├─ WhereIsSearch/{WhereIsSearch.tsx,SearchResultRow.tsx,ExpandedTerms.tsx}
│  │  │  ├─ FileViewer/{FileViewer.tsx,useCodeMirror.ts,SymbolOutline.tsx,ImportsPanel.tsx}
│  │  │  ├─ Settings/{SettingsDialog.tsx,AiSettingsSection.tsx,TestKeyButton.tsx,
│  │  │  │            ExcludeGlobsEditor.tsx,TranscriptSection.tsx}
│  │  │  ├─ AiPanel/{ProjectSummary.tsx,ModuleExplanation.tsx,AskPanel.tsx,
│  │  │  │           SentPayloadDisclosure.tsx,CitationLink.tsx}
│  │  │  └─ common/{EmptyState.tsx,ErrorState.tsx,Toast.tsx,VirtualList.tsx}
│  │  └─ test/**/*.test.tsx
│  ├─ e2e/{picker.spec.ts,graph.spec.ts,search.spec.ts,errors.spec.ts}  wdio.conf.ts
│  ├─ bench/{run-bench.ts,budgets.json,generate-synthetic-repo.ts}
│  └─ src-tauri/                                        # owner: rust-tauri
│     ├─ Cargo.toml  build.rs  tauri.conf.json
│     ├─ capabilities/default.json
│     ├─ icons/*
│     ├─ binaries/onboard-engine-<target-triple>[.exe]  # externalBin, copied from engine
│     ├─ resources/grammars/*.wasm
│     └─ src/
│        ├─ main.rs  lib.rs  error.rs  state.rs
│        ├─ commands/{analyze.rs,search.rs,read_file.rs,settings.rs,ai.rs}
│        ├─ sidecar/{spawn.rs,rpc.rs,supervisor.rs}
│        ├─ secrets/{keychain.rs,ai_key.rs}
│        ├─ privacy/{redact.rs,caps.rs,verify_citations.rs,patterns.rs}
│        ├─ ai/{mod.rs,provider.rs,anthropic.rs,ollama.rs,http.rs,prompt.rs,transcript.rs}
│        └─ util/{paths.rs,logging.rs}
│
└─ docs/
   ├─ ARCHITECTURE.md  ENGINE_CONTRACT.md  PRIVACY.md  SECURITY_AUDIT.md
   ├─ INSTALL.md  SIGNING.md  MACOS_SMOKE.md  DECISIONS.md  V2_BACKLOG.md
```

**Known hard parts — mitigate deliberately, do not discover them late.** (1) *web-tree-sitter WASM inside Tauri*: grammars ship as Tauri `resources`, never embedded in the Bun binary, and the Rust shell passes `--grammars-dir "<resolved path>"` — the loader takes a path argument and has no hardcoded fallback. (2) *Sidecar packaging across three OSes*: Tauri requires the exact `-<target-triple>` suffix; `scripts/build-sidecar.ts` emits all four artifacts from one runner via `bun build --compile --target=`, and a CI step asserts each expected filename exists before bundling. (3) *Windows path handling*: normalize to POSIX at the walk boundary and never anywhere else; use `\\?\` prefixes in Rust; run one CI job from a directory whose name contains a space. (4) *`.gitignore` semantics*: delegate entirely to `ignore@6`; do not hand-roll negation or nesting. (5) *Monorepo resolution*: resolve workspace names from manifests only, and never descend into `node_modules` — an external package is a name, not a file. (6) *Unsigned-build UX*: `docs/INSTALL.md` ships the exact Gatekeeper and SmartScreen steps, and the release notes lead with them. (7) *Linux keychain absence*: session-only keys, never a plaintext file (A18). (8) *Floating-point PageRank*: sorted iteration + fixed rounding is the whole defense — never introduce a parallel reduction into it.
