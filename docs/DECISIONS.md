# Decisions

The build spec says: "Where you find a gap, choose the most conventional
option, implement it, and add a line to `docs/DECISIONS.md`." This file is
that log — one line per gap-filling decision, in the order they were made,
newest at the bottom. It does not re-litigate anything the spec already
decided; it only records choices the spec left open.

- **Phase 0 — ESLint / Prettier / TypeScript-ESLint versions.** Section 4 pins
  Bun, TypeScript, Rust, and Node, but not ESLint or Prettier. Picked the
  current stable flat-config line: ESLint `~9.39.0` + `@eslint/js` `~9.39.0` +
  `typescript-eslint` `~8.65.0` (peer-compatible with TypeScript 5.7 and
  ESLint 9), and Prettier `~3.9.6`.
- **Phase 0 — `bun-types` version.** Not named in Section 4. Pinned
  `bun-types@~1.3.14` to match the `bun@1.3.14` `packageManager` pin so
  `tsc --noEmit` resolves `bun:test` / `bun:sqlite` ambient types consistent
  with the runtime that will actually execute the code.
- **Phase 0 — Bun minor line: 1.3.x, not the 1.2.x named in Section 4.**
  Section 4 pins "Bun 1.2.x", but the current stable Bun — the one the
  toolchain actually installs from winget on the development machine (A22) —
  is 1.3.14, and that is the binary that ran this phase's gate. Every Bun
  capability the spec depends on is present and stable in 1.3: workspaces
  (Section 14), `bun test` + coverage (A15), `bun build --compile
  --target=<triple>` for the sidecar (A9), and built-in `bun:sqlite` (A10).
  Downgrading to a superseded 1.2 patch to satisfy a version string would
  ship a stale toolchain for no capability gain, so `packageManager` pins
  the literal `bun@1.3.14` — reproducible, and matching the runtime that
  executes the code. Revisit only if a 1.3-specific regression appears.
- **Phase 0 — `apps/desktop` stub test runner.** Section 4 / A15 specifies
  Vitest 3 + jsdom for the real UI test suite, but that toolchain (and React
  itself) doesn't exist until Phase 7. To keep Phase 0 dependency-free (its
  own "Deps: none"), the Phase 0 `apps/desktop` stub uses `bun test` for its
  one trivial placeholder test, same as `contract`/`engine`. Vitest 3 is
  introduced in Phase 7 once real components exist.
- **Phase 0 — `no-restricted-syntax` for Map/Set `for...of` in
  `packages/engine/src/{graph,rank}`.** Section 8.8 asks to ban `for...of`
  "over a Map/Set" there. Plain ESLint AST selectors have no type
  information and cannot distinguish a `Map`/`Set` from an `Array` at lint
  time. Implemented the safe, stricter interpretation: ban `ForOfStatement`
  outright in `packages/engine/src/{graph,rank}`, forcing the sorted-array
  iteration pattern those algorithms already require (Section 8.3, Section
  8.5). This is stricter than the letter of the spec but never looser.
- **Phase 0 — MIT license copyright line.** A20 fixes the license (MIT) and
  product name (Onboard) but not a copyright holder string. Used
  "Copyright (c) 2026 Onboard contributors" as the conventional default for
  an as-yet-unreleased open source project.
- **Phase 0 — `.gitattributes` line-ending policy (gap: Section 14 lists no
  `.gitattributes`).** Without one, Git on Windows checks out `text` files
  with CRLF while Linux/macOS CI checks out LF. Section 6.1 hashes *raw
  bytes*, so the identical commit would then produce different
  `content_hash` values per OS and acceptance criterion 3 (identical
  `fingerprint` across platforms) would fail for a reason unrelated to the
  engine. Added `* text=auto eol=lf` to normalize the working tree on every
  OS, plus `-text` (no conversion whatsoever) for the byte-exact directories:
  `packages/engine/fixtures/**`, `packages/contract/fixtures/**`, the emitted
  JSON Schema, and `test/__snapshots__/**`. The `-text` on fixtures is what
  allows Phase 2's deliberately CRLF-line-ended fixture file to survive
  checkout with its CRLFs intact, which Section 10 requires to be asserted.
- **Phase 1 — gate command form: `bun run --filter` instead of `bun test --filter`.**
  Section 9's Phase 1 gate is written as `bun test --filter @onboard/contract`.
  In Bun 1.3 `bun test --filter` matches TEST FILE NAMES, not workspace package
  names, so that literal command matches nothing and exits 1 (`the following
  filters did not match any test files`). Workspace filtering lives on
  `bun run --filter`. The gate is therefore run as
  `bun run --filter '@onboard/contract' test`, which is the same intent —
  "run the contract package's test script" — expressed in the form this Bun
  version actually supports.
- **Phase 1 — `sample-analysis.json` is authored via a committed generator.**
  Section 9 calls the fixture "hand-written". The repo SHAPE (24 files, the
  edge list, symbols, roadmap, modules, diagnostics) is hand-authored in
  `scripts/fixture-data.ts` and `scripts/fixture-symbols.ts`; the mechanically
  implied fields are then derived by `scripts/build-fixture.ts`: in/out degree,
  PageRank, importance, dense `importanceRank`, `importantFilePaths`, `stats`,
  every array's sort order, and the sha256 `fingerprint`. Rationale: Phases
  7-10 build the entire UI against this file, so `importanceRank` must really
  be dense and unique and `stats` must really match the arrays — hand-typing
  ~1,300 lines of JSON gets those subtly wrong, deriving them cannot. The
  generator is explicitly NOT the engine (it does no walking, parsing, or
  resolution) and Phase 4 must not import from it. `bun run fixture:emit`
  regenerates byte-identically.
- **Phase 1 — `AppErrorCode` added alongside the frozen `AppError`.** Section 7's
  error envelope types `code` as `z.string()` with the comment "one of the
  enumerated E_* codes above", but never defines that set as a schema.
  `AppError` is transcribed verbatim and unchanged; `AppErrorCode` is added as
  a separate exported enum collecting every `E_*` from Section 7.4's table plus
  `E_ENGINE_VERSION_MISMATCH` from 7.3, so the Rust and UI tracks can draw from
  one closed list instead of three hand-copied ones. Additive, not a change to
  the frozen shape.
- **Phase 1 — `max-lines-per-function` disabled for test files only.** ESLint
  counts a `describe(...)` callback as a function, so criterion 27's 50-line
  cap measures the size of a test SUITE and penalizes thorough testing. The
  rule is switched off for `*.test.ts`/`*.spec.ts` (and their `.tsx` forms) and
  nowhere else; `max-lines` (800) and `max-depth` (4) still apply to tests, and
  the 50-line cap still applies to every non-test file including scripts.
- **Phase 1 — the emitted JSON Schema is un-ignored in `.gitignore`.** The
  Phase 0 pattern `/packages/*/dist/` swallowed
  `packages/contract/dist/analysis-result.schema.json`, which would have made
  `contract:check-drift` compare against a file that is never committed — a
  gate that passes vacuously forever. The pattern now matches dist CONTENTS
  (`/packages/*/dist/*`) so a negation can re-include that one file, since Git
  cannot re-include a file whose ancestor directory is excluded.
  `contract:check-drift` was also added to the root `verify` chain so drift
  fails the build rather than only failing when someone remembers to run it.
- **Phase 0 — `.gitignore` anchoring.** A14 vendors fake repos under
  `packages/engine/fixtures/` that may deliberately contain directories named
  `node_modules`, `dist`, etc. to exercise the walker's ignore logic
  (Section 8.1). Rather than relying on `.gitignore` negation (which cannot
  re-include a file whose ancestor directory was itself excluded), every
  ignore pattern is anchored (`/packages/*/dist/`, `/node_modules/`, ...) to
  a real, specific build-output location instead of an unanchored recursive
  glob, so no pattern can ever reach into `packages/engine/fixtures/` in the
  first place. A trailing `!/packages/engine/fixtures/**` is kept as a
  defensive, documented backstop.
- **Phase 2 — `CONFIG_FILENAMES` and `ASSET_EXTENSIONS` (Section 8.6 rules 6, 17).**
  The spec names extension- and segment-based config detection but never enumerates
  the extensionless "known config filename" list or the asset-extension list
  verbatim. Filled both with the conventional set for a v1 JS/TS/Python repo
  (`packages/engine/src/constants.ts`): `CONFIG_FILENAMES` covers `Dockerfile`,
  `Makefile`, dotfiles like `.eslintrc`/`.env*`, and common `*.config.js` names;
  `ASSET_EXTENSIONS` covers text-ish asset formats (`html`, `xml`, `graphql`,
  `sql`, ...) that survive the walk boundary, since binary/media extensions are
  already dropped by `HARD_IGNORE_GLOBS` before classification ever sees them.
- **Phase 2 — "checking the deepest segment first" (Section 8.6, closing paragraph).**
  Read literally as a scan-direction detail *within* each segment-based rule's own
  "segment in {set}" membership test, not as a reordering of the rules' declared
  1-18 priority (which the same section states unambiguously: "first matching rule
  wins, evaluated top to bottom"). A path like `src/services/routes/health.ts`
  therefore classifies as `route` (rule 8) rather than `service` (rule 10), because
  rule 8 is checked first, not because `routes` is the deeper segment. Implemented
  in `packages/engine/src/classify/classify-file.ts`'s `hasSegmentIn`/
  `hasSegmentMatching`, which scan a path's segments from deepest to shallowest
  (a no-op for plain set membership, but the literal reading requested).
- **Phase 2 — cache database file missing entirely (Section 6.1's invalidation rule).**
  The spec's invalidation rule enumerates schema/version/fingerprint mismatches and
  "the file is unreadable or `PRAGMA integrity_check` fails", but a repo opened for
  the very first time has no cache file at all. Treated as the same "unreadable"
  branch (`decideCacheInvalidation` reason `missing-or-unreadable`), which already
  produces the correct action (create fresh) without a special case.
- **Phase 2 — symlink-loop test strategy (Section 10: "skipped on Windows without dev
  mode").** This dev machine (A22) cannot create real symlinks without elevated
  privileges, confirmed by a failing `EPERM` from `fs.symlinkSync`. Added a
  dependency-injected fake `WalkFs` (`packages/engine/src/walk/walk.ts`'s `WalkFs`
  interface) so the realpath visited-set guard has a real, non-skipped, passing
  test on every platform, and kept a second best-effort test that creates a genuine
  OS symlink and silently returns (matching the spec's own documented gap) when the
  platform refuses.
- **Phase 2 — `bun:sqlite` on Windows: a closed WAL-mode database can hold its
  `-shm`/`-wal` file open briefly after `Database.close()` returns.** Traced to
  `Database.prepare(sql).run(...)` one-shot call sites leaving an unfinalized
  `Statement` object that keeps the connection a "zombie" (`sqlite3_close_v2`
  semantics) until GC finalizes it. Fixed at the source: one-shot writes now use
  `Database.run(sql, params)` (which prepares, steps, and finalizes internally per
  Bun's own docs); the multi-row loops in `replaceSymbolsForPath` /
  `replaceImportEdgesForPath` / `replaceTokensForPath` keep a reused prepared
  statement for the loop but call `.finalize()` in a `finally` block right after.
  `sqlite-cache-store.ts`'s `deleteDatabaseFiles` additionally retries each delete
  a bounded number of times (`DELETE_RETRY_ATTEMPTS`/`DELETE_RETRY_DELAY_MS`) since
  this is an OS-timing quirk, not a logic bug, and "delete and recreate, never
  migrate" must not fail intermittently on Windows.
- **Phase 2 — the 2 MB `too-large` fixture is mechanically generated, not hand-typed.**
  Section 11 lists "a 2MB file" as part of the `kitchen-sink` fixture's planted
  hazards; A14 requires fixtures to be vendored (committed), not pinned to a
  network fetch, but doesn't require every byte to be hand-authored. Generated
  deterministically once and committed as `packages/engine/fixtures/kitchen-sink/
  src/large-file.ts` (repeated filler lines, ~1.6 MB), same as a hand-authored file
  would be checked in — just not line-by-line typed.
- **Phase 2 — `walk.ts` joins directory + entry name with a fixed `/`, never
  `node:path`'s platform-native `join`.** Gap: the spec's pseudocode doesn't specify
  how to build the next absolute path during traversal. Using the native `join`
  breaks dependency-injected `WalkFs` fakes in tests on Windows (it silently
  produces backslash-joined paths that no longer match a fake filesystem's
  forward-slash keys) and is unnecessary: Windows's own filesystem APIs (and Node's
  wrappers over them) accept `/`-separated paths natively. A single fixed separator
  keeps real and fake filesystems behaviorally identical.
- **Phase 7 — `Settings` schema lives in `apps/desktop/src/ipc/settings-schema.ts`,
  not `@onboard/contract`.** Section 6.2's settings shape is Rust/config-layer
  data (`<appConfigDir>/onboard/settings.json`), never part of the frozen
  `AnalysisResult`/`search`/`rpc`/`error` schemas Section 7 freezes, so
  `@onboard/contract` does not export it. The UI still needs a
  runtime-validated type for `get_settings`/`update_settings`, so it is
  transcribed field-for-field from Section 6.2's example here and re-parsed
  in `settingsStore` the same way `AnalysisEnvelope` is re-parsed in
  `repoStore` (Section 12).
- **Phase 7 — IPC failures reject with a plain `AppError` object, not a
  custom `Error` subclass.** Keeps `mock-ipc.ts` and `tauri-ipc.ts` free of
  any runtime import from `ipc.ts` (only `import type`), which avoids a
  circular module dependency with `ipc.ts`'s `createIpc()` factory. Callers
  narrow an unknown rejection with `parseIpcError`, which `AppError.safeParse`s
  it and normalizes anything that doesn't match (a genuine contract
  violation) into a generic `E_UNEXPECTED` error rather than rendering a raw
  stack trace (Section 12).
- **Phase 7 — `AppError.message` is treated as the fully-interpolated
  description string; the UI derives the (always-static) title via a
  `code -> title` lookup.** Every literal title in Section 10 is static —
  only descriptions interpolate `{name}`/`{n}`/`{path}` — and `AppError` has
  no separate title field, so `resolveErrorCopy` in `copy/messages.ts` is the
  one place that reunites a static title with the producer-supplied message.
- **Phase 7 — literal copy gaps filled for `E_ENGINE_TIMEOUT`,
  `E_ANALYSIS_IN_PROGRESS`, and `E_AI_PAYLOAD_UNSAFE`.** Section 10 names the
  error code and behavior for these three rows but gives no quoted title/
  description (unlike every other row). Filled with the most conventional
  phrasing consistent with the other `AppError` strings in the same table;
  see the inline comments beside each in `src/copy/messages.ts`.
- **Phase 7 — `repoStore` adds an intermediate `'picking'` status between
  `'empty'` and `'analyzing'`.** Section 10's "second analysis started while
  one runs" row requires the picker to disable rather than queue. The
  `pick_repo_folder` dialog itself is asynchronous (Section 7.4), so without
  a status set synchronously the instant `pickFolder()` is called, two rapid
  invocations could both pass the "not already analyzing" guard before either
  dialog resolved. `'picking'` closes that window; `RepoStatus` is additive
  to, not a replacement of, the four states implied by Section 10.
- **Phase 7 — shadcn/ui primitives are hand-written, not generated by the
  shadcn CLI.** The CLI's `init`/`add` commands are interactive and fetch
  component source from a registry at generation time; a non-interactive
  build uses the same underlying pattern by hand instead (Tailwind utility
  variants via `class-variance-authority`, a `cn()` merge helper via `clsx` +
  `tailwind-merge`, native elements for correct keyboard/focus semantics for
  free). `components.json` is still committed so the CLI can be run later
  with matching conventions.
- **Phase 7 — no `tailwind.config.ts` file.** Tailwind CSS 4.1 is CSS-first:
  a JS config is only loaded if a stylesheet opts in with `@config`, and this
  project's `index.css` does not, so an unreferenced config file would be
  dead weight. Design tokens live in `index.css`'s `@theme` block instead;
  `dark:` resolves to `prefers-color-scheme` by default in v4, which is A17's
  "follows OS preference" with no configuration at all.
- **Phase 6 — `tauri-plugin-shell` / `tauri-plugin-store` are registered but
  not called from Rust.** Section 4 lists both as stack dependencies and
  Section 12 requires `shell:allow-execute` scoped to `onboard-engine` in
  capabilities. The frontend never touches either plugin directly (per the
  "expose typed commands only" boundary), so the plugins are registered in
  `lib.rs` for capability/config completeness and left available for future
  use, while the actual sidecar spawn (`sidecar/spawn.rs`) uses
  `std::process::Command` and settings persistence (`commands/settings.rs`)
  uses plain `std::fs` + `serde_json`. This keeps both hermetically
  unit-testable against the stub binary/a temp directory without a running
  `AppHandle`, with no loss of the capability boundary the plugin config
  still enforces for any JS-side use.
- **Phase 6 — "one analysis at a time" is a single global guard, not
  per-`repoId`.** Section 9's Phase 6 goal says "one analysis at a time per
  repo (`E_ANALYSIS_IN_PROGRESS`)", but there is exactly one sidecar process
  and one stdio pipe (Section 7.3), so RPC calls are already serialized at
  the transport level regardless of which repo they name; a global in-flight
  flag in `SidecarSupervisor` satisfies "per repo" (a stricter constraint
  trivially satisfies a looser one) without inventing per-repo bookkeeping
  the single-process architecture can't actually parallelize anyway.
- **Phase 6 — JSON-RPC domain-error convention: `error.data` carries a
  serialized `AppError`.** Section 7.3 defines every RPC's success `Result`
  but not the shape of a JSON-RPC `error` object for a domain failure (e.g.
  the engine's own `E_REPO_TOO_LARGE` from the Section 8.1 walk). The most
  conventional, contract-consistent choice: the engine puts a full
  `{code,message,detail,path}` `AppError` in `error.data`;
  `sidecar::supervisor::map_remote_error` deserializes it directly and
  passes it through unchanged, falling back to a generic `E_ENGINE_CRASHED`
  if `data` is absent or doesn't parse. **This needs sign-off from
  `ts-engine`'s Phase 5 implementation** — flagged prominently since it's a
  cross-boundary convention neither agent could freeze alone.
- **Phase 6 — `E_ENGINE_TIMEOUT` and `E_ANALYSIS_IN_PROGRESS` have no
  literal Section 10 copy.** Both codes appear in Section 7.4's table but
  their Section 10 rows ("Sidecar hangs", "Second analysis started while one
  runs") describe only the mechanism, not UI strings. Crafted concise,
  conventional message/detail pairs in `error.rs` following the voice of the
  rows that do have literal copy (e.g. `E_ENGINE_CRASHED`).
- **Phase 6 — a chosen system root (`/`, `C:\`, `/home`, `/Users`) maps to
  `E_NOT_A_DIRECTORY`.** Section 12 requires `analyze_repo` to refuse a
  system root, but the closed `AppErrorCode` set (Section 7.4) has no
  dedicated code for it. Reused `E_NOT_A_DIRECTORY` — the closest existing
  fit — and broadened its generic `message` to "That folder can't be
  analyzed" (rather than the file-specific "That isn't a folder") so the
  same code covers both scenarios truthfully; each case's specific reason
  goes in `detail`.
- **Phase 6 — `read_repo_file` with an unrecognized `repoId` maps to
  `E_PATH_ESCAPES_REPO`.** Neither Section 7.4's error list for this command
  nor Section 10 covers "the caller named a repo that was never analyzed."
  Deny-by-default: with no known repo root there is no confinement boundary
  to check against, so the safest closed-set code is the same one used for
  an actual escape.
- **Phase 6 — `search_repo` input-validation failures (malformed `repoId`,
  out-of-range `query`/`limit`) map to `E_NO_ANALYSIS`.** The command's
  closed error set is only `{E_NO_ANALYSIS, E_ENGINE_CRASHED}`; a malformed
  or unrecognized `repoId` in practice means "there is no valid completed
  analysis under that id," so `E_NO_ANALYSIS` is the closest, truthful fit.
- **Phase 6 — `store_ai_key`'s key-length check (Section 12: 8-512 chars)
  reuses `E_INVALID_SETTINGS`.** The command's only listed error code is
  `E_KEYCHAIN_UNAVAILABLE`, which doesn't fit a client-side input-validation
  failure; `E_INVALID_SETTINGS` is the closest existing code in the closed
  set.
- **Phase 6 — `store_ai_key` falls back to a session-only key automatically,
  rather than erroring first.** Section 10's "Linux without a keyring
  daemon" row pairs `E_KEYCHAIN_UNAVAILABLE` with a UI action "Use
  session-only key," which could mean either "error, then let the user opt
  in" or "silently do the safe thing." Chose the latter: when the OS
  backend itself is unavailable (A18), `AiKeyStore::store` stores the key in
  an in-memory, never-persisted map and returns `{isStored:true,
  isSessionOnly:true}` instead of failing the request outright.
  `E_KEYCHAIN_UNAVAILABLE` is reserved for a harder failure than "no daemon
  is running."
- **Phase 6 — Windows "ACL-denied directory" permission test deferred.**
  Section 10 calls for an integration test with a chmod-000 dir on
  Linux/macOS and an ACL-denied dir on Windows. `analyze_repo`'s validation
  only calls `fs::metadata` on the chosen directory itself, and `stat()`
  succeeding on a path does not require execute/read permission on the
  target — only on its ancestors — so a faithful Windows ACL-denial
  reproduction would need actual directory-content traversal (the engine's
  job, once Phase 5 lands), not a Rust-side `metadata()` call. The
  `io::ErrorKind::PermissionDenied -> E_PERMISSION_DENIED` mapping is
  implemented and unit-tested against a synthetic `io::Error`; a real
  chmod-000/ACL-denied end-to-end test is left for Phase 11's integration
  pass once real repo walking exists to trigger it.
- **Phase 3 — vendored grammar `.wasm` provenance.** Section 4 pins
  tree-sitter-javascript/typescript/python at `0.23.x`; the obvious
  offline-friendly source (the `tree-sitter-wasms` npm bundle) only ships
  WASM built from much older grammar versions (`^0.20.3`/`^0.20.5`/`^0.21.0`),
  which would silently violate the pin. Instead, fetched the four official
  prebuilt `.wasm` assets directly from each grammar's GitHub Release at the
  exact pinned tag (`tree-sitter-javascript` v0.23.1, `tree-sitter-typescript`
  v0.23.2 — both `typescript` and `tsx` — and `tree-sitter-python` v0.23.6)
  and vendored them unmodified into `packages/engine/grammars/`. This is a
  one-time, dev-machine-only network fetch to obtain build artifacts (like
  downloading any other pinned binary dependency) — it is not a runtime
  network call, and `createGrammarLoader`/`Language.load` only ever read
  these vendored bytes from local disk (`node:fs`, never `fetch`).
- **Phase 3 — a fourth query file, `queries/javascript.scm`, added beyond the
  three Section 14 names.** `tree-sitter-typescript`'s grammar is built as an
  extension of `tree-sitter-javascript`'s, but it still adds three node types
  (`interface_declaration`, `type_alias_declaration`, `enum_declaration`)
  that do not exist in the plain `javascript` grammar; a tree-sitter `Query`
  fails to compile if it references a node type the target `Language`
  doesn't define. Since `.js`/`.jsx` files parse with the `javascript`
  grammar (not `typescript`), they need their own query source without those
  three patterns. `ts.scm` and `tsx.scm` remain as named and are byte-for-byte
  identical (tree-sitter-typescript's `typescript` and `tsx` grammars share
  the same node vocabulary for every construct this engine indexes; TSX's
  extra JSX grammar rules are never referenced by these queries).
- **Phase 3 — component/hook/route/const-vs-variable classification are
  naming/shape conventions, not spec algorithms.** Section 8's algorithms
  section has no equivalent of 8.6 for SYMBOL kinds (only Section 8.6 covers
  FILE classification), yet `SymbolKind` includes `component`, `hook`, and
  `route`, which have no tree-sitter node type of their own — they are
  JS/TS/Python idioms. Filled with the same spirit as Section 8.6's own
  conventions: a callable (function declaration or arrow/function-expression
  assigned to a top-level const) named `use[A-Z]…` is a `hook`; the same
  callable with a PascalCase name IN A JSX-CAPABLE LANGUAGE (`javascript`,
  `tsx` — not plain `.ts`) is a `component`; a call shaped
  `<object>.<get|post|put|delete|patch|options|head|use>('<string path>', …)`
  (JS/TS) or a function decorated with `@<object>.<route|get|post|...>('<string
  path>')` (Python, covering both Flask's `@app.route` and FastAPI-style
  verbs) is a `route` symbol named after its path. `const` vs `variable` is
  the declaration keyword (`const` -> `const`, `let`/`var` -> `variable`) in
  JS/TS; Python (no such keyword) uses the `SCREAMING_SNAKE_CASE` convention
  for `const`, everything else `variable`. All implemented in
  `ts-parser.ts`/`python-parser.ts`, not the `.scm` queries, since none of
  this is expressible as tree-sitter node-shape matching alone.
- **Phase 3 — Python `isExported` convention: a name not starting with `_` is
  public.** Python has no `export` keyword; this is Python's own documented
  convention (a single leading underscore signals "internal"), applied
  uniformly to functions, classes, methods, and module-level assignments in
  `python-parser.ts`.
- **Phase 3 — `export type { X } from './y'` is `kind: 'reexport'` with
  `isTypeOnly: true`, not `kind: 'type'`.** Section 8.2 step 9 states "`import
  type` / `export type` -> edge with `isTypeOnly: true`, kind `type`" for the
  no-source form, and separately "`export * from './x'` -> kind `reexport`"
  for the re-export form, but doesn't name the hybrid (`export type {X} from
  './y'`). Since it fundamentally re-exports a specifier (has a `source:`
  field), `kind` stays `'reexport'`; `isTypeOnly: true` carries the extra
  nuance — exactly the reason `ImportEdge` has both fields independently.
- **Phase 3 — the parser pool's concurrency (`min(cpuCount-1,8)`, Section 11)
  is an in-process pull-based async scheduler, not real `worker_threads`/
  `Worker` instances.** `parseFiles` still honors the exact concurrency bound
  and the pre-sized-array-by-index determinism rule (Section 8.8) the spec
  requires, but every parse call currently runs on the main thread. Reasons:
  (1) `web-tree-sitter`'s `Parser`/`Language`/WASM memory cannot be shared
  across real OS threads without each thread separately calling `Parser.init()`
  and reloading every grammar, undercutting "avoid reloading WASM grammars"
  (schema.sql's `idx_file_cache_lang` comment) rather than serving it; (2)
  tree-sitter's `.parse()` call is synchronous with no internal await point,
  so within a single JS thread there is no real re-entrancy hazard the bound
  needs to guard against yet; (3) the public API (`parseFiles(entries,
  getParser, options)` returning `Promise<readonly ParsePoolResult[]>`) does
  not encode "single-threaded" anywhere, so swapping the scheduler for real
  `Worker` threads later is a purely internal change. Flagged for revisit at
  Phase 11's performance gate if the 10,000-file / 60s cold-analysis budget
  (Section 11) isn't met with this simplification.
- **Phase 3 — `sha1Hex` added to `util/hash.ts` alongside `sha256Hex`.**
  Section 6.1's `symbol` table comment is explicit: `id TEXT PRIMARY KEY --
  sha1(path + '#' + name + '#' + startLine)[:16]`, the one place the schema
  names `sha1` instead of `sha256`. Implemented as a second, clearly-commented
  export rather than silently reusing `sha256Hex` for it, since the schema's
  choice is a literal, verbatim requirement, not a typo to "fix" into
  consistency.
- **Phase 8 — `@types/cytoscape` was added then removed.** It resolves on npm
  but is a deprecated stub with `"main": ""` and no declarations —
  `cytoscape@3.31.4` ships its own `index.d.ts`. Kept only `cytoscape`,
  `cytoscape-fcose`, `cytoscape-expand-collapse` as runtime deps; a small
  ambient shim (`src/types/cytoscape-extensions.d.ts`) covers the two
  extensions' untyped default-export registration functions, since neither
  publishes types of its own.
- **Phase 8 — a headless-Cytoscape fallback exists in `useCytoscape.ts`,
  gated on `supportsCanvasRendering()`, purely so the component is
  unit-testable under Vitest/jsdom (no `canvas` npm package installed).**
  This is not a workaround for a fake test: `cytoscape({ headless: true })`
  and `cytoscape({ container, ... })` are two officially-documented
  Cytoscape.js modes, and the real Tauri webview always has a working 2D
  canvas, so this branch never executes in production. Two consequences,
  both discovered empirically (see the two entries below) and both confined
  to the same fallback:
  - `cytoscape-expand-collapse`'s `init()` unconditionally does
    `cy.container().append(canvas)` for its on-node cue icons, which throws
    when `cy.container()` is null (headless). `collapse.ts` exports
    `createNoopExpandCollapseApi()` — collapse/expand become no-ops — used
    only when `!supportsCanvasRendering()`; the real extension initializes
    normally whenever a canvas is available.
  - `cytoscape-fcose`'s spring-embedder repulsion pass indexes a spatial
    grid sized from the container's pixel width/height, which are `0` with
    no real container and throws (`Cannot read properties of undefined`).
    `useCytoscape.ts`'s `buildLayoutOptions()` uses the core `grid` layout
    (physics-free, no viewport dependency) instead of `fcose` whenever
    `!supportsCanvasRendering()`; production always gets real `fcose`.
- **Phase 8 — `fcose`'s `tile: false` is set unconditionally, not just for
  the headless fallback.** Reproduced independently of the headless issue
  above: fcose's node-tiling pass (for grouping disconnected/orphan
  components) throws on the project's own 24-file sample fixture's compound
  structure (`cose-base`'s `tileNodesByFavoringDim` reads an undefined
  array) — a real upstream bug triggered by ordinary input, not a test
  artifact. Directories already give the layout explicit structure via
  compound nodes, so disabling tiling costs nothing.
- **Phase 8 — `[` / `]` jump to the first (sorted-ascending) dependent /
  dependency rather than cycling through all of them.** Section 9's
  keyboard paragraph says "step to dependents/dependencies" without
  specifying multi-target behavior. Documented in
  `keyboard-nav.ts`'s file header; revisit if Phase 9/10 usage shows this
  reads as a dead end for files with several dependencies.
- **Phase 8 — `bench:graph` drives a real headless Microsoft Edge over the
  Chrome DevTools Protocol (a plain WebSocket), not `--dump-dom` and not
  `playwright-core`.** First attempt (`playwright-core`'s
  `chromium.launch({ executablePath: ... })` against the system's installed
  Edge) reproducibly failed: the Edge process launched and exited
  immediately (exit code 255) every time. That is a `playwright-core`
  launcher problem, not a "no browser reachable" problem — confirmed by
  invoking the same `msedge.exe` directly (`--headless=new --dump-dom`),
  which works. Two further dead ends before landing on CDP: (1) `--dump-dom`
  dumps the DOM the instant the `load` event fires and never waits for the
  async layout/pan measurement the harness needs to run — proven with a
  `setTimeout` probe that `--dump-dom` alone reports the pre-timeout DOM;
  (2) `--virtual-time-budget` does make `--dump-dom` wait, but it also
  breaks `requestAnimationFrame` scheduling: with `--disable-gpu`, a single
  rAF fires only once, near the very end of the virtual budget, instead of
  every ~16ms, and a busy rAF loop never completed at all in repeated
  attempts. Driving Edge directly over CDP (`Runtime.evaluate` with
  `awaitPromise: true` on `window.__runGraphBench(nodeCount)`, no DOM
  scraping) uses real wall-clock time throughout and sidesteps both
  problems entirely — verified first with a plain `setTimeout` probe
  through the same code path before building the real harness.
  `bench/graph/browser-harness/` is a small Vite-built page that imports
  the actual production entry points (`createCore`, `buildLayoutOptions`,
  `autoCollapseIfNeeded` — all exported from `useCytoscape.ts`/`collapse.ts`
  for exactly this reuse) rather than a parallel reimplementation, served
  from a local `Bun.serve()` static server (not `file://`, to avoid
  Chromium's CORS restriction on `type="module"` scripts loaded from a
  `file://` origin). `--disable-gpu` is deliberately NOT passed (Section 9
  Phase 8's coordinator note suggested it, but empirically it is what broke
  `requestAnimationFrame` above); headless Chromium/Edge still typically
  rasterizes via SwiftShader software rendering either way, so the
  "pessimistic versus the real WebView2 compositor" caveat still applies
  and is printed by the script every run, alongside "this is still not the
  Tauri webview — Phase 11 remains authoritative." If Edge or the CDP
  handshake fails for any reason, the script catches it, prints the failure
  reason, and still runs the headless-only (no browser) baseline rather
  than exiting with nothing — that baseline uses the same production
  functions run under Bun/JavaScriptCore with no canvas at all.
- **Phase 8 — real measurement obtained; it exposed a genuine, unresolved
  performance ceiling, not just a measurement-methodology problem.** With
  the CDP harness actually running fcose in Chromium/Edge's real V8, at
  1,000 synthetic files: `firstPaint ≈ 850–1,140 ms` (PASSES the 1,500 ms
  budget); at 5,000 files: `firstPaint ≈ 4,900–5,800 ms` (FAILS). Scripted
  pan p95 is `≈ 50 ms` at 1,000 nodes and `≈ 230 ms` at 5,000 (FAILS both
  the 22 ms and 33 ms budgets). Investigating *why*, per the coordinator's
  ask, led to two real production fixes in `useCytoscape.ts`, both kept
  regardless of what the bench says because they are correct on their own
  terms:
  1. **Auto-collapse now runs BEFORE the initial layout, not after.**
     `cytoscape-expand-collapse` removes a collapsed node's descendants
     from layout participation entirely, so collapsing first means fcose
     never has to position hidden nodes at all. Previously `initializeGraph`
     ran layout on the *whole* graph, then collapsed — meaning the
     >600-node auto-collapse rule (Phase 8's own paragraph) was not
     actually saving any layout cost. After the fix, this synthetic graph's
     visible node count for layout purposes is 13 at BOTH 1,000 and 5,000
     total files (same directory shape, `MODULE_COUNT = 12` regardless of
     file count).
  2. **`quality: 'draft'` (fcose) kicks in whenever the VISIBLE
     (post-collapse) node count still exceeds the same 600-node threshold**
     — a safety net for repo shapes the depth->=2 collapse rule can't
     shrink (e.g. thousands of files directly under one shallow directory).
     `tile: false` and `packComponents: false` are also now unconditional:
     both of fcose's grouping passes throw or degrade on this project's own
     sample fixture's compound structure, a real upstream `cose-base` bug
     independent of node count.
  Even with both fixes, and even though only 13 nodes are ever laid out,
  first paint still fails at 5,000 total files. The bench's own printed
  numbers show why: `constructLayout` itself (creating 5,000 Cytoscape
  node/edge objects and applying the stylesheet to all of them, not just
  the 13 that stay visible) is `≈ 700–900 ms` at 1,000 nodes but `≈ 4,000–
  4,500 ms` at 5,000 — it scales with the TOTAL element count, not the
  visible one, and dominates the budget on its own before any layout or
  paint happens. Pan p95 shows the same shape (233 ms at 5,000 nodes vs.
  50 ms at 1,000, despite an identical 13 visible nodes in both cases),
  suggesting Cytoscape's per-frame work is not fully skipping
  collapsed-and-hidden elements either. This is flagged here rather than
  patched hastily: the honest fix is architectural (materialize a
  collapsed directory's descendants into the Cytoscape model lazily, on
  expand, instead of creating and immediately hiding all of them up front)
  and deserves its own test coverage rather than a rushed change at the end
  of this phase. Left as an explicit open item for whoever next touches
  `DependencyGraph` performance — likely surfaced again by Phase 11's
  `bun run bench` against the same budgets in the real Tauri webview.
- **Phase 8 — `DependencyGraph` is code-split via `React.lazy` +
  `Suspense` and reached through a small Overview/Dependency-graph tab
  switcher added to `App.tsx`.** Neither is named in Section 9 Phase 8's
  file list, but a component with no reachable path from `App.tsx` would be
  dead code (criterion: "no dead controls"), and `cytoscape` + its two
  extensions are the single heaviest dependency in the app (production
  bundle: 344 kB main / 593 kB graph chunk, lazy-loaded only when the tab is
  opened) — bundling them into the initial load would work against
  criterion 12's "overview in under 10 seconds" for no benefit to a user who
  never opens the graph.
- **Phase 4 — `repo.sourceRoots` must never contain `''`, even though
  `rank/modules.ts` needs `''` as an internal sentinel for "the repo root
  itself" (Section 8.6's module derivation treats the repo root as a valid
  basis for depth-1/2 candidates).** `RepoPath` requires a non-empty string
  (mirroring the same constraint `directories.ts` already had to work around
  for the repo root — see the next entry). Kept the internal `''` sentinel
  flowing through `detectSourceRoots`/`computeModules` unchanged (it is
  exactly what makes a non-monorepo repo's whole tree eligible for module
  candidates), and instead filter it out at the one place it becomes
  contract-facing (`analyze-assemble.ts`'s `buildRepoSection`): a repo with
  no workspace packages now reports `sourceRoots: []`, an empty array being
  a perfectly valid (if less informative) `RepoPath[]`, rather than `['']`.
  Caught by the very first `analyze()` integration test run — every fixture
  failed `AnalysisResult.parse()` with a `ZodError` on `repo.sourceRoots[0]`
  until this was fixed.
- **Phase 4 — `directories.ts` never emits the repo root itself as a
  `DirectoryNode`.** Same root cause as the previous entry: `RepoPath`
  cannot be `''`, so there is no valid way to represent the repo root as a
  `DirectoryNode.path`. A top-level directory's `parentPath` is `null`
  rather than pointing at an unrepresented root.
- **Phase 4 — module qualification counts files DIRECTLY inside a candidate
  directory, not recursively.** Section 8.6 says modules are "directories at
  depth 1-2 below each sourceRoot containing >= MODULE_MIN_FILES parsed
  files," which reads ambiguously as either a direct or recursive count.
  Recursive counting creates a real paradox once combined with "a file
  belongs to its deepest qualifying ancestor": a shallow directory that only
  qualifies because of a deep subdirectory's files would, after those files
  get reassigned to the deeper (also-qualifying) subdirectory, end up
  qualifying but empty — a `ModuleCard` with `fileCount: 0` describing
  nothing. Direct-count qualification avoids this entirely and is a
  perfectly natural reading of "a directory containing N files." Documented
  at the top of `rank/modules.ts`.
- **Phase 4 — `graph.orphanPaths` = isolated files (zero in-degree AND zero
  out-degree), deliberately narrower than the roadmap's `unreached`
  section.** Section 10's edge-case table only says orphans "appear in the
  roadmap's unreached section," not that the two sets are identical. Section
  8.5 step 6's `unreached` is about BFS reachability from entry points (an
  SCC can have plenty of edges among well-connected files and still never be
  reached from any seed); "orphan" in the classic graph-theory sense means
  fully disconnected. Implemented as the narrower, more literal reading in
  `graph/orphans.ts`; every orphan is necessarily also unreached, but not
  every unreached file is an orphan.
- **Phase 4 — a `Cycle`'s `paths` is a deterministic greedy tour through the
  SCC, not a full alphabetical sort.** The contract comment says "rotated so
  the lexicographically smallest is first," which implies an underlying
  non-alphabetical (cyclic-tour) order exists to rotate, not that the whole
  array gets sorted. Tarjan's algorithm doesn't hand back a ready-made tour
  for a non-simple SCC (one with internal branching beyond a single loop),
  so `graph/cycles.ts` reconstructs one: start at the smallest member, then
  repeatedly step to the smallest unvisited in-SCC neighbor, falling back to
  the smallest remaining unvisited member on a dead end. Always starts at the
  smallest member (satisfying "rotated... smallest first" literally) and is
  fully deterministic.
- **Phase 4 — roadmap step-8 trimming's "fill remaining slots... in
  importance-desc order" uses `path` ascending as its tie-break.** Not
  specified for this specific sort (unlike nearly every other ranking in
  Sections 8.3-8.5, which all name `path` asc as the final tie-break), but
  every one of them does, and reusing that same rule here is both consistent
  and the only way this step is deterministic when two non-entry candidates
  tie exactly on importance.
- **Phase 4 — entry-point priority order (`package.json#main` -> `#bin` ->
  `python:__main__.py` -> `convention:index.*` -> `#scripts.start` ->
  `python:module-guard`), and `repo.detectedType`'s decision tree (Next.js >
  React > Vue > Node.js service; Flask/Django/FastAPI > Python package;
  workspace count > 1 beats everything else).** Section 7.1 names the
  possible `evidence` strings and gives example `detectedType` values, but
  specifies neither a detection priority nor a decision tree. Both are
  implemented as the most conventional reading (explicit manifest
  declarations outrank filesystem convention, which outranks a best-effort
  script-string parse) and documented inline in `stack/entry-points.ts` and
  `stack/detect-stack.ts`.
- **Phase 4 — `python:importlib.import_module('literal')` detection is not
  implemented; a known gap carried from Phase 3.** Section 8.2 Python rule 6
  says `importlib.import_module('literal')` resolves like a normal import and
  a non-literal call is `dynamic-expression`, but Phase 3's
  `queries/python.scm` never added a capture for `importlib.import_module(...)`
  calls (unlike JS/TS's `require()`/dynamic-`import()` handling, which IS
  captured). No vendored fixture exercises this pattern, so it does not
  block Phase 4's gate, but it means Python's dynamic-expression path is
  presently unreachable in practice. Flagged explicitly rather than silently
  left; a real fix belongs in `parse/python-parser.ts` + `queries/python.scm`,
  not `resolve/`.
- **Phase 4 — `package.json#imports` conditional-object targets only ever
  resolve the `"default"` condition.** Node's real `imports` field supports
  arbitrary condition names (`"node"`, `"import"`, `"require"`, ...); Section
  8.2 rule 5 only says "same substitution" as `paths`, without addressing
  conditions. Resolving every possible condition would require knowing which
  runtime environment the analyzed repo targets, which this static analyzer
  has no way to know; `"default"` is the one condition every consumer must
  fall back to per the Node spec itself, so it is the only one honored
  (`resolve/node-resolution.ts`'s `importsValueToTargets`).
- **Phase 4 — a workspace package's bare specifier also resolves a deep
  subpath (`@acme/core/utils`), not just the bare package name.** Section
  8.2 rule 7 only describes resolving the bare specifier via
  exports/module/main; deep imports bypassing a package's declared entry
  point are commonplace in real monorepos and cost nothing extra to support
  (`resolve/node-resolution.ts`'s `matchWorkspaceBase`), so it was added
  defensively rather than treated as out of scope.
- **Phase 4 — `tsconfig`/`jsconfig` `paths` targets resolve against
  `baseUrl`, defaulting to the config's own directory when `baseUrl` is
  absent.** Section 8.2 rule 4 doesn't say what `paths` targets are relative
  to. This matches modern TypeScript's own documented behavior (`baseUrl`
  became optional for `paths` in TS 4.1+, defaulting to the tsconfig's own
  directory) — the conventional, least-surprising choice
  (`resolve/node-resolution.ts`'s `resolveNodeImport`).
- **Phase 4 — `analyze.ts` is split into `analyze.ts` (orchestration) +
  `analyze-support.ts` + `analyze-rank-phase.ts` + `analyze-assemble.ts`.**
  Section 14 lists a single `analyze.ts`, but the full walk -> parse ->
  resolve -> graph -> rank -> assemble pipeline does not fit one file under
  the 800-line cap while keeping every function under 50 lines (a hard
  lint-enforced rule, not a style preference). Each extra file owns one
  contiguous phase of the pipeline and is imported only by `analyze.ts`
  itself, so the module remains a single logical composition root split
  across files for size reasons only, not a change to its public surface
  (`analyze()` is still the only export anything outside this cluster calls).
- **Phase 9 — `RoadmapStep.section` labels are the react-ui team's own
  copy, added to `ROADMAP_COPY.sectionLabels` in `src/copy/messages.ts`.**
  Section 10 doesn't name literal strings for the five `RoadmapStep.section`
  values; Section 9 Phase 9 only requires each render "distinguishably".
  Chose short, conventional labels ("Entry point", "Core", "Supporting",
  "Leaf utility", "Unreached") and paired every one with both a distinct
  color AND the text label — never color alone — since a screen reader
  user and a colorblind user both need the distinction Section 9 asks for.
- **Phase 9 — the roadmap's graph overlay is drawn as synthetic edges
  (class `route-edge`), not by re-styling real import edges.** The
  roadmap's order is a BFS-layered reading path (Section 8.5), not
  necessarily real import edges — consecutive steps are frequently not
  directly connected in the dependency graph at all (e.g. the fixture's
  leaf-utility and unreached steps). `useCytoscape.ts`'s `applyRouteOverlay`
  therefore removes and re-adds a dedicated edge per consecutive step pair
  on every call, giving exactly `steps.length - 1` segments regardless of
  what the underlying import graph looks like, per Section 9 Phase 9's own
  wording.
- **Phase 9 — `UseCytoscapeApi.getCore()` and `DependencyGraph`'s
  `onCytoscapeReady` prop are new, deliberately test-only escape hatches.**
  Neither is called by any production code path (every real interaction
  already goes through the existing `focusNodeById`/`highlightNeighborhood`/
  etc. methods). They exist because Section 9 Phase 9's gate — "clicking
  step n focuses and centers that node in the graph, asserted by a test" —
  needs a way to verify REAL Cytoscape state (rendered position after
  centering, actual overlay edge count) from an integration test that
  mounts `RoadmapPanel` and `DependencyGraph` together, and Phase 8 never
  built a hand-rolled Cytoscape test double to assert against (it uses the
  real library headless throughout, deliberately — see Phase 8's entries
  above). `getCore()` returns `null` until `isReady`, matching the rest of
  the API's null-safety.
- **Phase 9 — cross-component focus (`registerGraphFocusHandler`) now
  triggers the same aria-live announcement an in-graph click or keyboard
  move does.** Not explicitly requested, but Section 9 Phase 8's "every
  focus change announced via aria-live" and criterion 20 (roadmap panel
  accessibility) together imply a roadmap-driven focus shouldn't be a
  second-class experience for screen reader users versus a mouse click on
  the same node.
- **Phase 9 — `RoadmapPanel` and `ModuleMap` are wired into `App.tsx` as two
  more tabs ("Start here", "Module map"), not lazy-loaded.** Same "no dead
  controls" reasoning as Phase 8's Dependency-graph tab — a built component
  with no reachable path from `App.tsx` is dead code. Not lazy-loaded
  because neither pulls in a heavyweight dependency the way `cytoscape` +
  its two extensions did (Phase 8), so there is no bundle-size reason to
  defer them.
- **Phase 9 — Phase 8's flagged loose end is closed in `useCytoscape.ts`,
  not in `DependencyGraph.tsx`'s JSX.** `useRecenterOnReadyEffect` reads
  `useGraphStore.getState().focusedPath` (a one-time read, not a reactive
  subscription) the moment `graph.isReady` flips true, and re-centers on it
  if set. This covers exactly the flow described: clicking a roadmap step
  while the graph tab is closed sets `focusedPath` with nothing mounted to
  act on it; opening the tab afterward re-mounts `DependencyGraph`, which
  then centers on whatever was already focused — verified by a dedicated
  cross-tab integration test (`RoadmapPanel.graphIntegration.test.tsx`).
- **Phase 10 — `mock-search.ts`'s ranking is a genuine but deliberately
  simplified re-implementation of Section 8.7, not the engine's frozen
  `KEYWORD_MAP`/token index.** Those live in `ts-engine`'s scope, not
  `apps/desktop/**`. `MOCK_KEYWORD_MAP` is explicitly documented in the file
  as NOT authoritative; the weights (`W_SYMBOL_EXACT`, `W_FILENAME_EXACT`,
  `P_TEST`, `P_GENERATED`, `MIN_SEARCH_TERM_LENGTH`, `EXPANSION_DECAY`,
  etc.) are transcribed from Section 8.7 verbatim so the UI's sort order,
  dropped-term copy, and expanded-term display are all real behavior against
  real fixture data (32 symbols / 24 files, real `importance` values) — only
  the keyword-expansion table itself is a stand-in until Phase 11 wires the
  real sidecar.
- **Phase 10 — a synthetic 20,000-line file (`mock-bench-file.ts`,
  `bench/synthetic-20000-lines.ts`) was added to `mock-ipc.ts`'s
  `readRepoFile` for the render-time gate.** `sample-analysis.json` is a
  frozen, hand-authored 24-file fixture (Phase 1) with no file anywhere near
  that size, and nothing about it may change to accommodate a Phase 10
  benchmark. The content is generated deterministically (`syntheticValue{N}
  = {N}` per line, no randomness) purely from a line count, so it is
  identical on every run and is clearly a bench fixture, not sample source
  from a real repository.
- **Phase 10 — the "20,000-line file renders in <= 400ms" gate IS
  measured honestly inside the ordinary jsdom/vitest suite, unlike Phase
  8's Cytoscape/canvas gate.** A throwaway probe (since deleted) confirmed
  empirically that CodeMirror 6 genuinely virtualizes its DOM under
  jsdom — only the visible window's `.cm-line` elements are ever built,
  regardless of document length (verified again in
  `FileViewer.perf.test.tsx` itself: 14 DOM lines for a 20,000-line
  document). This is a real difference from Phase 8's Cytoscape+`<canvas>`
  rendering, which jsdom cannot lay out or rasterize at all. So this gate
  needed no CDP/headless-Edge fallback: `FileViewer.perf.test.tsx` asserts
  a real `performance.now()` wall-clock delta plus the DOM-node-count proof,
  both against real behavior, not an estimate.
- **Phase 10 — the perf gate test is excluded from the default `vitest run`
  and given its own config/script (`vitest.perf.config.ts`, `bun run
  test:perf`).** Measured in isolation the mount is consistently ~185-220ms
  (well under the 400ms budget), repeatably; once, run inside the full
  ~40-file parallel suite, the same assertion measured 641ms due to CPU
  contention across concurrently-running worker threads (the DOM node count
  it also asserts was identical both times — 14 `.cm-line` elements — so the
  variance is scheduling noise, not a rendering regression). Rather than
  loosen the budget or accept a non-deterministically-red test in the
  default suite, this mirrors the precedent `bench:graph` (Phase 8) already
  set: a performance-sensitive gate is measured in a dedicated, uncontended
  run rather than asserted as a number the shared worker pool cannot
  honestly guarantee.
- **Phase 10 — `@tanstack/react-virtual` needs an `offsetHeight` stub to do
  anything under jsdom, and CodeMirror 6 needs a `Range.prototype
  .getClientRects`/`getBoundingClientRect` stub for its scroll-centering
  math.** Both are jsdom's well-documented lack of a real layout engine, not
  application bugs. `virtual-core`'s `observeElementRect` measures
  `element.offsetHeight` specifically (confirmed by reading
  `node_modules/@tanstack/virtual-core`'s source, not guessed), which is
  always 0 under jsdom; the `offsetHeight` stub in each `WhereIsSearch*`
  test file supplies the same viewport height the component itself renders,
  so the virtualizer's own windowing logic still runs for real against that
  value. `Range.prototype.getClientRects` is unimplemented in this jsdom
  version outright (`TypeError: ... is not a function`) and is now stubbed
  globally in `src/test/setup.ts`, returning an empty rect list — it changes
  nothing about what CodeMirror computes from document/selection state (line
  numbers, content, `EditorState.selection`), only the horizontal-pixel
  measurement jsdom cannot provide.
- **Phase 10 — `SearchResultRow`'s two nested "action" elements
  (open-at-line, jump-to-specific-line) are `role="button"` `<div>`/`<span>`
  elements with no `tabIndex`, not native `<button>`s.** The row itself is
  `role="option"` inside `WhereIsSearch`'s `aria-activedescendant` listbox
  (real DOM focus always stays on the search input). Per the ARIA APG, an
  `option` must not contain focusable descendants; axe-core's
  `no-focusable-content` rule caught this as a real violation during this
  phase, and further caught that a `tabIndex={-1}` `<button>` does NOT fix
  it (axe's own message: "a negative tabindex ... does not prevent
  assistive technologies from focusing the element"). Removing native
  button semantics entirely (while keeping `aria-label` and the onClick
  handler) is the fix that actually satisfies the rule. Keyboard users
  still reach the primary "open file" action via `WhereIsSearch`'s
  ArrowUp/ArrowDown + Enter handling on the input itself; only the
  secondary per-line-hit jump (a mouse convenience beyond what Section 9
  Phase 10 requires) has no dedicated keyboard path.
- **Phase 10 — CodeMirror's own `.cm-content` (`role="textbox"`) needs an
  explicit `aria-label`, added via a new `ariaLabel` option on
  `useCodeMirror` (`EditorView.contentAttributes`).** axe-core's
  `aria-input-field-name` rule flagged the read-only editor's textbox role
  as unnamed; `FileViewer` passes `` `File contents: ${path}` `` so the name
  is specific to whatever file is open, not a generic placeholder.
- **Phase 10 — two `AppError` codes gained `ERROR_TITLES`/copy entries that
  Section 10 doesn't give literal strings for: `E_FILE_TOO_LARGE` (reusing
  the already-existing `ERRORS.fileTooLarge` title) and
  `E_PATH_ESCAPES_REPO` (new `ERRORS.pathEscapesRepo`, for `read_repo_file`'s
  "path outside the analyzed folder" guard).** Both are real, enumerated
  `AppErrorCode` values (Section 7's closed set) that `FileViewer` can now
  actually receive from `read_repo_file`, so leaving them unmapped would
  have shown the generic "Something went wrong" title in a case Section 10
  clearly anticipates (the error code exists specifically for it).
- **Phase 10 — `App.tsx` now wires `onOpenFile` end-to-end for the first
  time.** Every panel (`OverviewPanel`, `ModuleMap`, `RoadmapPanel`,
  `DependencyGraph`) has accepted an `onOpenFile` prop since earlier phases,
  but `App.tsx` never passed a real handler — a dead control until this
  phase. `ReadyContent`'s `handleOpenFile` now switches to a new "File
  viewer" tab, remembers the requested path/line, and calls
  `useGraphStore.getState().focusPath(path)` — reusing the one frozen
  cross-component focus seam from Phase 9 rather than adding a second one —
  so opening a file from anywhere in the app (a search hit, a roadmap step,
  a module card, a graph node) also centers that file in the dependency
  graph. Covered end-to-end by a new `App.test.tsx` case, not just a unit
  test on `WhereIsSearch` in isolation.
- **Phase 10 — `FileViewer` is lazy-loaded the same way `DependencyGraph`
  is; `WhereIsSearch` is not.** CodeMirror 6 plus its four language packages
  is the second-heaviest dependency after Cytoscape (confirmed by the
  production build: a dedicated `FileViewer-*.js` chunk at ~197kB gzipped,
  separate from the ~115kB gzipped main bundle) and, like the graph, is
  irrelevant to the Overview a user sees first. `WhereIsSearch` only adds
  `@tanstack/react-virtual`, small enough to stay in the main bundle
  alongside the other eagerly-loaded panels.
- **Phase 10 — `ImportsPanel`'s imports/importers are computed via
  `DependencyGraph/graph-model.ts`'s existing `buildAdjacency(result.edges)`,
  not a second adjacency-building function.** `FileViewer` needed the exact
  same "who does this file import, who imports it" data `DependencyGraph`
  already derives; importing the existing pure function (already unit
  tested in `graph-model.test.ts`) keeps there being exactly one place that
  interprets `AnalysisResult.edges` this way.
- **Phase 5 — the JSON-RPC domain-error convention (`error.data` = a fully
  serialized `AppError`) is implemented exactly as rust-tauri already
  committed it in Phase 6, per the coordinator's sign-off request, with one
  clarification made explicit in `src/rpc/server.ts`: `error.data` is
  populated ONLY when a method throws the engine's own `DomainError` (a
  recognized domain failure — `E_REPO_TOO_LARGE`, `E_PATH_NOT_FOUND`,
  `E_NO_SUPPORTED_FILES`, etc.).** Pure JSON-RPC protocol failures — malformed
  JSON (`-32700`), an unknown method (`-32601`), or params a zod schema
  rejects (`-32602`) — deliberately leave `data` absent, relying on the Rust
  side's own documented fallback ("if `data` is absent... falls back to a
  generic `E_ENGINE_CRASHED` and puts the raw remote string in `detail`").
  Forcing an `AppErrorCode` onto a protocol-level failure would mean
  inventing a code that doesn't semantically fit (the closed `AppErrorCode`
  enum has nothing for "your JSON was malformed"); leaving `data` absent and
  letting Rust's already-designed fallback handle it is more faithful to the
  frozen convention than guessing. An unrecognized *thrown* `Error` (a bug,
  not a modeled domain failure) is treated the same way — no invented
  `data`, `error.message` carries the raw text, and Rust's fallback puts it
  in `detail` rather than a user-facing string.
- **Phase 5 — three `AppErrorCode`s the engine can throw have no literal
  Section 10 copy: `E_NOT_A_DIRECTORY`, `E_PATH_ESCAPES_REPO`,
  `E_NO_ANALYSIS`.** Section 10's table gives verbatim strings for
  `E_PATH_NOT_FOUND`, `E_PERMISSION_DENIED`, `E_NO_SUPPORTED_FILES`,
  `E_REPO_TOO_LARGE`, and `E_FILE_TOO_LARGE` — those are transcribed
  byte-for-byte in `src/rpc/error-copy.ts`. The three above are real,
  reachable failures (`repoPath` pointing at a file; `readFile`/`snippets`
  rejecting a `..`/symlink-escape path; `search`/`readFile`/`snippets`
  called before any `engine.analyze` for that `repoId`) that Section 10
  simply doesn't name copy for. `error-copy.ts` ships clearly-labeled
  placeholder `message`/`detail` text for these three, flagged in that
  file's own doc comment as pending confirmation from the UI copy owner
  (`src/copy/messages.ts`) rather than presented as settled Section 10 text.
- **Phase 5 — `<appConfigDir>/onboard/keywords.json`'s path is derived from
  `appDataDir`, the only directory `EngineAnalyzeParams` actually carries.**
  Section 8.7 says users extend `KEYWORD_MAP` via `<appConfigDir>/onboard/
  keywords.json`, but the frozen `EngineAnalyzeParams`/`EngineSearchParams`
  schemas (Section 7.3) have no separate app-config-dir field — only
  `appDataDir`. Rather than inventing a new RPC param (a contract change),
  `src/rpc/analyze-method.ts` resolves the keywords file at
  `<appDataDir>/onboard/keywords.json` and merges it into the session's
  keyword map once per `engine.analyze` call. This is flagged for
  rust-tauri to confirm: if the Tauri app-config directory is genuinely
  different from the app-data directory on some target OS, either the two
  need to be reconciled at the Rust layer before spawning, or a future
  contract revision adds an explicit field — this is a documented
  simplification, not a silent assumption.
- **Phase 5 — `token_index` persistence (Section 6.1) runs over every
  readable, reasonably-sized file (not just the four parsed grammars), and
  is NOT yet incremental-cache-gated by content hash — it rebuilds every
  `analyze()` run when a `cacheStore` is provided.** `buildTokenIndexRows`
  is a pure function of `(path, text)`, so always rebuilding is a
  performance simplification, never a correctness or determinism issue.
  Skipping this for unchanged files (mirroring the parse-cache's
  content-hash short-circuit) is a reasonable follow-up for a later phase,
  not a Phase 5 blocker — the gate is about search/RPC correctness, not
  warm-run speed for token indexing specifically.
- **Phase 5 — every `token_index`/`symbol`/`import_edge` row requires a
  preceding `file_cache` row (Section 6.1's `REFERENCES file_cache(path) ON
  DELETE CASCADE` foreign keys, enforced on a cold cache via `PRAGMA
  foreign_keys = ON` in `schema.sql`).** `persistParsedFile` already
  satisfied this for parsed files, but a file that is never parsed
  (`README.md`, `package.json`, anything with `languageId === null`) never
  went through that path — so Phase 5's new `persistTokenIndex` needed its
  own `ensureFileCacheRow` guard (idempotent `upsertFileCache`, using an
  empty-`ParsedFile` placeholder JSON when no real parse result exists)
  before writing a token row for it. Caught by a new `analyze.test.ts` case
  that runs a cold `analyze()` with a real `SqliteCacheStore` against a
  fixture with an unparsed file (`node-express`'s `package.json`) — without
  the guard this throws a real SQLite FK-violation error, not a silent bug.
- **Phase 5 — `engine.analyze`'s `AnalysisEnvelope.timings` is produced by a
  new `analyzeWithTimings()` sibling of `analyze()` in `analyze.ts`, not by
  changing `analyze()`'s own signature.** `analyze()` is exercised by ~20
  already-verified Phase 4 tests and two scripts expecting a bare
  `AnalysisResult`; wrapping its return in an envelope would have touched
  already-committed, already-gated code for no reason. `analyzeWithTimings`
  reuses the exact same phase functions with `performance.now()`
  instrumentation wrapped around each; `analyze()` itself is now a one-line
  wrapper (`(await analyzeInternal(options)).result`) with unchanged
  behavior. `resolveMs` also covers graph-building and ranking time
  (`computeGraphAndRanking` bundles resolve/graph/rank into one function by
  Phase 4 design) — `graphMs` is reported as `0` rather than an invented
  split; splitting it for real would mean touching Phase 4's
  `analyze-rank-phase.ts` internals, out of scope for this phase.
- **Phase 5 — `engine.progress` notifications are emitted at phase-
  transition boundaries (`walk`/`parse`/`resolve`/`persist`, each with a
  "starting" and "complete" pair), not per-file.** True per-file progress
  (`processed`/`total`/`currentPath` advancing file-by-file) would require
  threading a callback through `walk.ts`, `parser-pool.ts`, and the
  graph/rank modules — all already-verified Phase 2-4 code untouched until
  now. The `EngineProgress` zod schema constrains the *shape* of an emitted
  notification, not that every one of its six enumerated phases must appear
  at least once per analysis; `'graph'` and `'rank'` are valid enum values
  that this phase's coarser instrumentation never happens to emit (they are
  folded into the single `'resolve'` boundary), which is a granularity
  choice, not a contract violation. Throttling itself
  (`src/rpc/progress.ts`, "at most every 100 ms," Section 7.3) is
  independent of this and fully implemented with an injectable clock for
  deterministic tests.
- **Phase 5 — `engine.readFile` enforces two different size limits, not
  one.** Section 10's copy table says a file over 2 MB is rejected outright
  with `E_FILE_TOO_LARGE` ("File too large to display"); Section 12's
  security-boundary table separately caps `read_repo_file` at "size ≤ 2 MB."
  Both clearly describe a hard viewer ceiling, distinct from
  `MAX_PARSE_BYTES` (1.5 MiB, the walk/parse-skip threshold, Section 8.1) —
  so a new `MAX_VIEWER_FILE_BYTES` (2 MiB) constant was added rather than
  reusing `MAX_PARSE_BYTES`. Separately, `EngineReadFileParams.maxBytes` is
  honored as a caller-supplied truncation cap (`isTruncated: true`, content
  cut to `maxBytes`) for files under the hard ceiling — reconciling why the
  RPC contract carries both a `maxBytes` parameter and a fixed "2 MB" copy
  string: the hard ceiling is an absolute rejection threshold; `maxBytes` is
  a separate, caller-chosen preview/truncation cap beneath it.
- **Phase 5 — `engine.snippets` silently omits a path that escapes the repo,
  no longer exists, or can't be read from the returned `snippets` array,
  rather than failing the whole batch.** Section 7.3 does not specify
  partial-failure behavior for this method, and its params accept an
  arbitrary list of caller-supplied paths (the AI-picking layer's own
  index, which the engine has no way to know is stale). Failing every
  snippet in the batch over one bad path seemed like the wrong default;
  documented as an interpretive choice in `snippets-method.ts`'s own doc
  comment, flagged here for the AI-path owner to confirm or override.
- **Phase 5 — `EngineAnalyzeParams.isForceRefresh: true` deletes the
  repo's cache db file (plus its `-wal`/`-shm` siblings) before `open()`,
  rather than adding a new `CacheStore` method.** `SqliteCacheStore.open()`
  already has a "keep vs. recreate" decision built on `schema_meta`
  comparison (Section 6.1); forcing a full re-parse just means guaranteeing
  that decision always lands on "recreate" by removing the file first,
  which `analyze-method.ts` (a module this phase owns) can do without
  touching the already-verified `SqliteCacheStore` invalidation logic at
  all.
- **Phase 5 — `cache/sqlite-cache-store.ts` loads `schema.sql` via `import
  SCHEMA_SQL from './schema.sql' with { type: 'text' }`, not
  `readFileSync(new URL('./schema.sql', import.meta.url))`.** The original
  Phase 2 pattern works under `bun run`/`bun test` but breaks inside a
  `bun build --compile` standalone binary: the `new URL(...)` resolves to a
  virtual `~BUN/root/schema.sql` path at runtime that doesn't exist, so
  `SqliteCacheStore.open()` throws `ENOENT` — and because
  `analyze-method.ts`'s catch-all mapped ANY caught error by inspecting its
  `.code` field, that unrelated `ENOENT` was misreported as `E_PATH_NOT_FOUND`
  against the *repo* path, not the real cause. Caught only by
  `scripts/test-rpc.ts` driving the actual compiled binary (Phase 5's gate
  item 2) — every prior test ran the uncompiled source, so this bug was
  invisible until the real-binary gate. Bun's text-import attribute is the
  documented, bundler-aware way to embed a non-JS asset in a compiled
  executable; a new ambient module declaration (`src/sql-module.d.ts`)
  teaches TypeScript about `*.sql` imports. Flagged for Phase 11: any other
  module that reads a same-package file via `new URL(..., import.meta.url)`
  (there are none currently, confirmed by grep) would need the same fix
  before compiling.
- **Phase 5 — `verify:no-network`'s static bundle scan checks bare Node
  built-in specifiers (`import("net")`, `import("http")`, etc.) OUTSIDE
  `src/guard/no-network.ts`, not the literal substrings `node:http`/
  `node:net` the Phase 5 instructions named.** Bun's bundler strips the
  `node:` prefix from built-in import specifiers in its output
  (`import('node:net')` becomes `import("net")`), so those exact literal
  substrings are trivially absent from ANY Bun-bundled file regardless of
  what it actually imports — checking for their absence would prove
  nothing. The script reports both: the named literal substrings (for
  transparency, always 0 as expected) and the actual meaningful check (no
  bare network-module import specifier anywhere outside the guard module,
  located via a source-comment marker Bun's non-minified bundler output
  preserves). Separately, the literal substring `fetch(` DOES appear 4
  times in the bundle — inside `web-tree-sitter`'s browser-only WASM-fetch
  fallback, which resolves the *global* `fetch` at call time, well after
  `guard/no-network.ts` has already poisoned it; this is proven
  behaviorally (not just statically) by `test/guard/no-network.test.ts`,
  which spawns a real subprocess and asserts the actual `fetch()` throws
  `EngineNetworkBlockedError`. The Linux `unshare -rn` sandboxed half of
  this gate (a full fixture analysis run through the built Linux binary
  with network namespaces unshared) IS implemented in
  `scripts/verify-no-network.ts`, gated on `process.platform === 'linux'`
  so it runs for real in CI and prints a clear `SKIPPED` line (not a false
  pass) on this Windows dev machine, where `unshare` doesn't exist.
- **Phase 11 — real Tauri IPC wiring found (and fixed) a genuine
  `AppError.message`/`detail` convention mismatch between `rust-tauri` and
  `react-ui`.** Section 12 says "`AppError.message` is always drawn from the
  copy table in Section 10", and Section 10's rows each show two strings: a
  short static title and a longer, often-parameterized description.
  `react-ui`'s `resolveErrorCopy` (`src/copy/messages.ts`) resolves the
  title from `code` alone and treats `error.message` as the description —
  the correct reading, since the title never needs a runtime value and the
  description usually does. `rust-tauri`'s Phase 6 `error.rs` had this
  backwards (`message` = static title via `AppErrorCode::message()`,
  `detail` = the long description) — invisible to Phase 6's own unit tests
  (which only checked internal consistency) and to `react-ui`'s Phase 7-10
  tests (which only ever supplied mock-IPC `AppError`s built already in
  their own, correct convention). Real E2E (`apps/desktop/e2e/errors.spec.ts`)
  is what caught it: `p*=could not find` never matched anything, because
  the description shown was actually the short title. Fixed by rewriting
  `error.rs` so every constructor puts the long, parameterized Section 10
  description directly in `message` and leaves `detail` for genuine extra
  diagnostics (an OS/provider error string) this crate doesn't currently
  have any of. **`packages/engine/src/rpc/error-copy.ts` still has the
  identical bug** (`message: 'That folder no longer exists'`,
  `detail: 'Onboard could not find ...'`) — its own doc comment even
  predates this fix, describing the old (wrong) convention as intentional.
  Flagged to the coordinator for `ts-engine` to apply the same swap;
  `rust-tauri`'s `map_remote_error` already passes an engine-supplied
  `error.data` `AppError` through unchanged, so this one file is the last
  place the wrong convention survives.
- **Phase 11 — `repoPath` sent to `engine.analyze` must not carry a
  `\\?\` extended-length prefix.** `std::fs::canonicalize` always returns a
  `\\?\`-prefixed path on Windows (needed for Rust's own filesystem calls
  past the 260-char limit, Section 10) — `analyze_repo_core` was passing
  that canonicalized path straight through to the sidecar. The engine's own
  existence check on the received path failed on that prefix (its own
  `E_PATH_NOT_FOUND`, discovered when a real fixture directory that
  genuinely existed was reported as not found), even though the identical
  string, unprefixed, resolves fine. Fixed by stripping the prefix
  (`util::paths::strip_extended_prefix`) before building the RPC params;
  Rust's own confinement/canonicalization checks still use the prefixed
  form internally where that protection actually matters.
- **Phase 11 — sidecar/grammars directory resolution needed a dev-mode
  fallback `resource_dir()` doesn't cover.** Tauri's bundler only copies
  `externalBin` entries next to the executable when actually bundling
  (`tauri build`); a plain `cargo build` (dev, this phase's E2E/bench) never
  performs that copy, so `resource_dir()/binaries` doesn't exist yet and
  `analyze_repo` failed immediately (spawn of a nonexistent path). Declared
  `resources` (the grammar WASMs) ARE copied next to the dev executable by
  `tauri-build` itself, so that half already worked. Fixed
  `resolve_binaries_dir` (`lib.rs`) to fall back to
  `env!("CARGO_MANIFEST_DIR")/binaries` — the exact location the
  coordinator stages real sidecars into — when the packaged path doesn't
  exist; `resolve_grammars_dir` mirrors the same pattern for symmetry and as
  a guard against ever building without `tauri-build` having run.
- **Phase 11 — `tauri-driver` needs an explicit `--native-port` distinct
  from its own `--port`.** Without one, `tauri-driver --port 4444
  --native-driver msedgedriver.exe` intermittently fails to bind
  (`Only one usage of each socket address...`), reproducible by running
  `tauri-driver` standalone. `wdio.conf.ts` now passes both
  `--port 4444 --native-port 9515` explicitly.
- **Phase 11 — `wdio run`'s config-level `maxInstances: 1` was not
  sufficient on its own to serialize spec-file execution** (observed:
  "Execution of 4 workers started" and real port collisions across the 4
  spec files' independently spawned `tauri-driver` processes, all on the
  same fixed ports). `apps/desktop/package.json`'s `e2e` script also passes
  `--maxInstances 1` on the CLI, which reliably serializes them; both are
  kept (the config value documents intent, the CLI flag is what actually
  works in this WDIO version).
- **Phase 11 — the native OS folder-picker dialog is unreachable from
  WebDriver** (a well-known limitation shared by every Electron/Tauri E2E
  setup — WebDriver drives the webview's DOM, not native OS chrome).
  `repoStore.ts` gained one small, additive, backward-compatible action,
  `analyzePath(path)` (extracted from the existing private `runAnalysis`
  helper `pickFolder` already used internally) so E2E can drive a real
  `analyze_repo` → real sidecar → real `AnalysisEnvelope` → rendered-UI
  round trip against a known fixture path without a dialog. `main.tsx`
  exposes it as `window.__onboardE2E` ONLY in a dedicated `vite build --mode
  e2e` build (`apps/desktop/package.json`'s `build:e2e` script) — never in
  `dev` or the real `vite build` Phase 14 ships.
- **Phase 11 — `generate-synthetic-repo.ts`'s "seed 0xONBOARD" is a hashed
  string, not a hex literal.** `O`/`N`/`B`/`D` aren't valid hex digits, so
  `0xONBOARD` cannot be parsed as a JS numeric literal. Read literally as
  "the seed named `0xONBOARD`" and hashed (FNV-1a, 32-bit) into the numeric
  seed the generator's PRNG needs — deterministic either way, and it uses
  the spec's literal string rather than substituting an arbitrary number in
  its place.
- **Phase 11 — root `package.json` carries a pre-existing UTF-8 BOM that
  breaks both `vite build` and `vitest run`, discovered while wiring E2E.**
  (Confirmed pre-existing: visible in this agent's very first read of the
  file, before any Phase 11 edit.) Node's strict `JSON.parse` — used by
  Vite's PostCSS auto-config search and, separately, by Vitest's
  jsdom-environment resolution, both of which walk up to the workspace root
  `package.json` — rejects the leading `\uFEFF` byte outright
  (`Unexpected token '\ufeff'`). Root `package.json` is out of
  `apps/desktop/**` scope, so **not fixed here**; worked around for the
  half this phase actually needs (`vite build`) by supplying an explicit
  empty `postcss: { plugins: [] }` in `apps/desktop/vite.config.ts`, which
  skips Vite's filesystem search entirely. No equivalent workaround was
  found for `vitest run` (its jsdom-environment resolution has no
  comparable escape hatch from a project-level config file) — `bun run
  test` under `apps/desktop` still exits 1 despite all 232 assertions
  passing, and `bun run verify` (which chains `bun run test`) will fail in
  CI until the BOM itself is removed. **Flagged to the coordinator as a
  blocking, pre-existing repo-hygiene bug** — the fix is a one-byte strip
  with zero semantic effect on any spec-compliant JSON parser, but touching
  root `package.json` needs explicit authorization.
- **Phase 11 — the staged real sidecar binary fails to load its bundled
  tree-sitter core WASM runtime at runtime, independent of anything in
  `apps/desktop`.** Every `engine.analyze` call against the real
  `onboard-engine-x86_64-pc-windows-msvc.exe` (identical SHA-256 to
  `packages/engine/dist`'s own copy — confirmed, so this is not a
  corrupted-copy issue) prints `failed to asynchronously prepare wasm:
  Error: ENOENT: ... open 'B:\~BUN\root\tree-sitter.wasm'` to stderr — Bun's
  own compiled-binary embedded-asset namespace, not a real filesystem path
  (copying a real `tree-sitter.wasm` next to the `.exe` does not help,
  confirmed). The engine degrades rather than crashing (every file gets a
  `PARSE_FAILED` diagnostic, 0 symbols/edges extracted anywhere) for small
  repos, but at 10,000 files the same failure mode instead makes
  `engine.analyze` hang past a 90s bound (observed: no response after
  180s against a 60s budget) rather than degrade quickly. This is
  `packages/engine`'s `build:sidecar` / `web-tree-sitter` packaging
  territory (the missing asset is the tree-sitter *runtime* WASM, distinct
  from and in addition to the four grammar WASMs Section 14 already lists
  as bundle resources) — out of `apps/desktop` scope to fix. `bun run
  bench`'s output prints this finding prominently rather than silently
  reporting numbers measured against a pipeline that never actually
  parses anything.
- **Phase 5 (post-hoc fix) — `src/rpc/error-copy.ts` had `AppError.message`
  and `detail` backwards; every helper now puts the Section 10 long
  description in `message` and leaves `detail: null`.** Caught by rust-tauri
  during Phase 11 integration (they hit the identical problem on their side
  and fixed it there, then correctly flagged that this engine module had
  never been touched and still had it wrong) and routed back here rather
  than silently patched on the Rust side. Section 7's frozen schema is
  explicit that `detail` is "developer detail; logged locally, shown behind
  a 'Details' disclosure," and Section 12 reinforces it ("stack traces...
  go to `detail`") — the previous version put the actionable Section 10
  description there and left only the short title-like fragment in
  `message`, which the UI's `resolveErrorCopy` renders as the visible
  description (it derives the *title* from `code` alone). Fixed for all
  five literal-copy codes (`E_PATH_NOT_FOUND`, `E_PERMISSION_DENIED`,
  `E_NO_SUPPORTED_FILES`, `E_REPO_TOO_LARGE`, `E_FILE_TOO_LARGE`) plus the
  three placeholder codes. `E_PATH_ESCAPES_REPO`'s placeholder text is now
  copied verbatim from `apps/desktop/src/copy/messages.ts`'s
  `ERRORS.pathEscapesRepo().description` (the UI's own gap-fill for that
  code) so the two sides show identical text instead of two independently
  invented strings; `E_NOT_A_DIRECTORY` and `E_NO_ANALYSIS` have no UI-side
  entry to align with yet, so they remain this engine's own reasonable
  text, still flagged as pending confirmation. Locked in by a new
  `test/rpc/error-copy.test.ts` asserting the convention (and the
  `E_PATH_ESCAPES_REPO` byte-for-byte match) for every helper, plus a
  corrected assertion in `test/rpc/methods.test.ts` that previously checked
  the old (backwards) string.
- **Phase 5 (post-hoc fix) — `importlib.import_module(...)` (Section 8.2
  rule 6) is now captured by `python.scm` and resolved/reported correctly;
  it was previously nominally documented but structurally unreachable.**
  Added a query pattern matching `importlib.import_module(...)` calls
  (anchored to the first positional argument only, so a trailing keyword
  argument like `package=` is never mistaken for the module name),
  `python-parser.ts` extraction that treats a literal string argument as a
  normal, literal, resolvable import and any other argument shape as a
  non-literal `dynamic` import, and — the part that made the rule
  genuinely inert before this fix — `resolve-import.ts`'s `resolvePython`
  never actually short-circuited on `kind === 'dynamic' && !isLiteral` the
  way `resolveJsTsFamily` already did for JS/TS's `import()`; without that
  check a non-literal `importlib.import_module(name)` would have been
  handed straight to `resolvePythonImport` and silently misreported (most
  likely as `no-match-on-disk`) instead of `dynamic-expression`. Exercised
  end-to-end, not just at the unit level: a new `app/dynamic_loader.py` in
  the `python-flask` fixture has both a literal call (resolves to
  `app/models/user_model.py`) and a non-literal one (reports
  `dynamic-expression`), asserted in `test/analyze/analyze.test.ts` and
  covered by the regenerated `python-flask.snap.json` (the other four
  fixtures' snapshots are untouched — confirmed via `git diff --stat`).
- **Phase 11 (post-hoc fix) — the compiled sidecar's `ENOENT ... tree-
  sitter.wasm` bug (flagged by rust-tauri's Phase 11 bench, matching this
  agent's own earlier suspicion) is fixed, and it turned out to be TWO
  separate instances of the same asset-embedding problem, not one.**
  `web-tree-sitter`'s `Parser.init()` internally locates its own core
  runtime `tree-sitter.wasm` via `new URL('tree-sitter.wasm',
  import.meta.url)`, which resolves to a virtual `B:\~BUN\root\` path
  inside a `bun build --compile` binary and throws ENOENT on every call.
  Fixed in `parse/grammar-loader.ts` by importing the library's own
  `tree-sitter.wasm` with `with { type: 'file' }` (Bun's file-embedding
  import attribute), reading it back with `Bun.file(path).arrayBuffer()`
  (which — unlike `node:fs`/`fetch` — CAN read the embedded asset back out
  of the compiled binary), and handing those bytes to `Parser.init({
  wasmBinary })`, bypassing the library's own broken lookup entirely.
  Fixing only this, though, still left every file failing with
  `PARSE_FAILED` inside the compiled binary — a SECOND, previously-
  undiscovered instance of the identical bug: `parse/queries.ts` loaded
  each language's `.scm` tree-sitter query source via
  `readFileSync(join(import.meta.dir, ...))`, which hits the exact same
  virtual-path ENOENT. Fixed by importing all four `.scm` files with `with
  { type: 'text' }` (the same technique already used for `schema.sql`),
  each as its own static import — the import specifier must be a literal
  string for Bun's bundler to embed it, so a dynamically joined path
  (`queries/${languageId}.scm`) cannot be fixed this way; each of the four
  files is imported explicitly instead. New ambient module declarations
  `src/wasm-module.d.ts` and `src/scm-module.d.ts` teach TypeScript about
  `*.wasm`/`*.scm` imports. Both fixes were found and confirmed by writing
  throwaway compiled-binary probes (built, run, and deleted — never
  committed) that isolated each failure precisely before touching the real
  source, rather than guessing from the symptom alone.
- **Phase 11 (post-hoc fix) — `scripts/test-rpc.ts` now asserts on
  substance (`symbols > 0`, `edges > 0`, zero `PARSE_FAILED` diagnostics
  for node-express), not just a successful RPC round-trip.** The previous
  version of this gate would have stayed green through the entire
  tree-sitter.wasm outage above — it only checked that `engine.analyze`
  responded without an `error` field, never that the `AnalysisResult` it
  returned meant anything. Per the coordinator's report: "a green
  `test:rpc` on a zero-symbol result is not a passing gate." Re-verified
  against the rebuilt binary post-fix: `symbols=12, edges=3,
  PARSE_FAILED=0`.
- **Phase 11 (post-hoc fix) — warm/incremental analysis was 34x over
  budget and slower than cold; root cause was this agent's own Phase 5
  `persistTokenIndex` addition, already flagged as a known gap in its own
  doc comment ("not yet incremental-cache-gated... rebuilds every
  `analyze()` run") but not recognized at the time as a correctness-
  adjacent PERFORMANCE bug of this magnitude.** Every file's `token_index`
  rows were unconditionally deleted and rewritten on every single
  `analyze()` call — cold, warm, or incremental alike — each write
  auto-committing individually (no explicit transaction) outside the
  parser pool's own cache-hit logic entirely. On a warm run this became
  the ONLY per-file cost remaining (parsing itself was correctly skipped),
  so it dominated completely: measured before the fix, in-process against
  a 1,000-file synthetic repo (`analyzeWithTimings` directly, no RPC/spawn
  overhead): cold 6263 ms, warm 28841 ms, incremental (20 changed) 29267
  ms — reproducing the bench's "warm is slower than cold" signature
  exactly. Fixed two ways: (1) `runParsePhase` now snapshots every file's
  `file_cache.content_hash` ONCE, before this run writes anything
  (`ParsePhaseResult.previousContentHashByPath`) — `persistTokenIndex`
  compares against that snapshot (not a live re-query, which would already
  reflect this run's own writes for freshly-parsed files and incorrectly
  look "unchanged") to skip re-tokenizing any file whose content hash
  didn't change; (2) a new `CacheStore.withTransaction<T>(fn: () => T): T`
  method (`SqliteCacheStore`: `this.requireDb().transaction(fn)()`) wraps
  both the parse-phase persist loop and the token-index persist loop in
  ONE transaction per batch instead of one auto-commit per file per write.
  Measured after the fix, same methodology: cold 3271 ms, warm 235 ms,
  incremental 404 ms — warm and incremental both now comfortably inside
  the 1200 ms / 2000 ms budgets, and warm is (correctly) far faster than
  cold rather than 5.5x slower. Verified the fix is real, not a fluke of
  measurement, by using `git stash push -- <the four changed files>` to
  temporarily restore the pre-fix code and re-running the identical
  benchmark script: reproduced the exact same regression (cold 6263 ms /
  warm 28841 ms / incremental 29267 ms) before popping the stash back.
  `bun run verify:determinism` stayed 15/15 throughout — the skip-check
  changes what gets WRITTEN to the cache, never what `analyze()` returns.
  New regression tests in `test/analyze/analyze.test.ts` assert a warm
  re-run is never slower than cold (qualitative, not a strict budget, to
  avoid a flaky CI timing assertion) and that touching one file out of
  several updates only that file's tokens while an untouched file's tokens
  remain correct.
- **Phase 11 (four gate-hardening items, no security review/Phase 12 until
  green) — 1: `verify:determinism`'s determinism floor.** A fingerprint
  comparison alone cannot distinguish a working engine from a broken one
  that reliably produces the same EMPTY result every time — exactly how the
  tree-sitter.wasm regression's `test:rpc` gate passed 7/7 against a binary
  that found zero symbols. `scripts/verify-determinism.ts` now checks
  `symbols > 0` and `edges > 0` for every fixture's cold result BEFORE any
  fingerprint is compared, with a clear per-fixture failure message; all 5
  vendored fixtures have real symbols and real imports by design (Section
  11), so a `0` always means degradation, never a legitimately-empty
  fixture. A new `VERIFY_DETERMINISM_GRAMMARS_DIR` env override lets this
  exact gate be demonstrated failing (pointed at an empty directory, every
  fixture reports `0 symbols`/`0 edges`, exit 1) without a second copy of
  the script — see the Phase 11 report for the literal before/after output.
- **Phase 11 — 2: `kitchen-sink` had zero import statements, making Section
  13 acceptance criterion 7 untestable, not merely untested.** Added: a
  genuine 3-file import cycle (`cycle-a.ts -> cycle-b.ts -> cycle-c.ts ->
  cycle-a.ts`); a dynamic `import()` with a template-literal argument
  (`dynamic-import-demo.ts`, never resolved, reason `dynamic-expression`);
  a `tsconfig.json` with a `@/*` -> `src/*` alias plus a consumer file that
  resolves through it; and connected the previously-orphaned majority of
  the fixture's existing files (`symbols-showcase.ts`, `crlf-file.ts`,
  `dir with space/file.ts`, `broken.ts`, `large-file.ts`, `minified.js`)
  into the graph via `index.ts`, while deliberately leaving exactly 2 files
  (`dynamic-import-demo.ts` — its only import can never resolve;
  `sub/thing.ts` — left alone on purpose) as genuine zero-edge orphans
  against that now-connected majority — criterion 7's own "2 known orphans"
  wording, discriminated from the 5 structurally-inevitable non-source
  orphans (`.gitignore`, `package.json`, `tsconfig.json`, and two nested
  `.gitignore`/`.log` files, which can never participate in an import graph
  regardless). Measured before/after (`edges`, `cycles`, `orphanPaths`
  length, `dynamic-expression` count): `0/0/13/0` -> `12/1/8/1`. Five new
  assertions in `test/analyze/analyze.test.ts` cover the cycle collapsing
  to one roadmap step with exactly 2 `companionPaths`, the dynamic-import
  reason, the tsconfig alias edge, the 2-orphans-vs-connected-majority
  discrimination, and that `large-file.ts`/`minified.js` stay `isParsed:
  false` with the correct `skipReason` even once imported.
  `kitchen-sink.snap.json` was regenerated; `git diff --stat` confirms it
  is the only snapshot that moved.
- **Phase 11 — 3: `build:sidecar`'s smoke test.** Checking that four
  filenames exist is satisfied by a non-functional placeholder — literally
  how the original tree-sitter.wasm regression shipped. `build-sidecar.ts`
  now launches the actual built host-platform binary after all four cross-
  compiles finish, drives a real `engine.analyze` against `node-express`
  (a fixture known to parse cleanly) over stdio, and throws (failing the
  whole build, non-zero exit) unless `PARSE_FAILED === 0` and `symbols > 0`
  — reusing the exact same substance bar as `test:rpc`'s gate, not a
  separate weaker one. A new `scripts/lib/sidecar-binary-name.ts` is the
  one shared place both `build-sidecar.ts` and `test-rpc.ts` resolve the
  host binary's filename from, so they can never name it two different
  ways. This stays entirely inside `packages/engine/dist` — nothing here
  reaches into `apps/desktop`.
- **Phase 11 — 4: the poisoned-cache bug — `schema_meta.engineVersion` now
  moves when the engine's CODE changes, not just when `package.json`'s
  version field is bumped by hand.** `scripts/build-sidecar.ts` bundles
  `main.ts` once WITHOUT any injected constant (a chicken-and-egg problem
  otherwise — the hash cannot include itself), hashes that bundle's text
  with sha256 (first 12 hex chars), then compiles for real with the hash
  injected via `bun build --define` as `process.env.ONBOARD_BUILD_HASH` — a
  compile-time constant substitution, not a real environment-variable
  read, so it cannot be spoofed by setting an env var against the compiled
  binary. `src/engine-version.ts`'s `resolveEngineVersion(packageVersion,
  buildHash)` appends it (`"0.1.0+<hash12>"`) when present, and falls back
  to the bare package version when running from source (`bun run` never
  applies `--define`, so the "env var" is genuinely unset there — the
  correct, honest behavior, not a bug in the fallback).

  **Correction to this entry's original evidence.** This agent first
  reported an A/B experiment claiming a "trivial comment-only edit to
  `main.ts`" moved the hash from `a042c6ca35b6` to `4b1c400fd59f`. The
  coordinator could not reproduce that with an actual comment-only edit,
  and was right not to: re-tested directly afterward (bundle the
  hash-scan output with and without an added `//` comment, diff the
  emitted text) — Bun's bundler strips ordinary line comments from the
  non-minified hash-scan bundle even with no `minify` option set, so a
  comment-only change is genuinely a no-op on the hash, confirmed by two
  repeat builds of unchanged source also producing the identical
  `a042c6ca35b6` hash both times. Whatever produced the original,
  non-reproducing `4b1c400fd59f` reading is unknown and was not a
  comment-only edit as claimed; that specific claim is retracted. The
  correct framing, stated plainly: **the guarantee is "the key moves when
  the engine's BEHAVIOR changes," not "when the source text changes"** —
  comments, whitespace, and other behavior-inert edits are not guaranteed
  to move it, and should not be relied on to.

  The mechanism itself is still sound, proven by the coordinator's own
  stronger, actually-reproducing experiment: poison a real cache exactly
  as the defective build did (`content_hash` left intact, `parsed_json`
  emptied, `symbol` rows deleted), then run two engine identities against
  it with no manual clear — identity AAA served the poisoned `symbols=0`
  (reproducing the original bug), identity BBB rejected the cache and
  rebuilt to the correct `symbols=12`. That is the evidence this fix
  actually rests on, not the retracted comment-edit claim above.

  Defense in depth, per the coordinator's explicit question: a parse
  result with `hasSyntaxError: true` and zero symbols is no longer written
  to the cache as authoritative when it comes from a SYSTEMIC failure (the
  parser pool call itself threw — e.g. the tree-sitter.wasm regression,
  or any future init-time bug) — `analyze-support.ts`'s
  `persistParsePhaseResults` now distinguishes that case (`ParsePoolResult`
  `status: 'failed'`) from a genuine per-file syntax error (`status: 'ok'`,
  `hasSyntaxError: true` — tree-sitter is error-tolerant and always
  returns `'ok'` for real per-file problems like `broken.ts`, which IS
  still cached exactly as before). A systemic failure gets an in-memory
  placeholder so `analyze()` still completes and reports a diagnostic
  (using the real underlying error message, not a generic one), but
  nothing is persisted for that file — so once the underlying bug is
  fixed, the very next run (even without a version/hash change) reparses
  it instead of trusting a poisoned row. Locked in by three new tests in
  `test/analyze/persist-parse-phase-results.test.ts`, including one that
  demonstrates the self-healing: a systemic failure writes nothing, and a
  later successful parse of the same file can still write its result. This
  is deliberately independent of the `engineVersion`/build-hash fix above —
  either one alone would have prevented the reported bug; together they
  are two layers, not one relying on the other.
- **Phase 11 — the 10,000-file `cold`/`warm` bench rows timed out (>90s
  against a 90s hard ceiling, budget 60s) — a real O(n^2) scaling defect in
  `token_index` writes, not "10x the work is slow."** Profiled with
  `AnalysisEnvelope.timings` at 1k and 10k files (a locally-generated
  synthetic repo matching `apps/desktop/bench/fixtures/generate-synthetic-
  repo.ts`'s shape, run in-process via `analyzeWithTimings` with a real
  `SqliteCacheStore` — the first profiling pass omitted the cache store
  entirely and completely missed the bug, since the walk/parse/resolve
  phases scale fine on their own): `walkMs`/`parseMs`/`resolveMs` all grew
  roughly linearly (~7-12x for 10x files), but the gap between those three
  and `timings.totalMs` (which spans the whole pipeline, including
  `persistTokenIndex`) went from ~1.7s at 1k files to ~204s at 10k files —
  a ~123x blowup for a 10x file-count increase, matching O(n^2) almost
  exactly.

  Root cause: `token_index`'s schema is `PRIMARY KEY (token, path)` — unlike
  `symbol` (`idx_symbol_path (path, start_line)`) and `import_edge`
  (`PRIMARY KEY (from_path, specifier, line)`, whose leftmost-prefix
  already covers a `from_path` lookup), `token_index` has NO index usable
  for `WHERE path = ?`. `replaceTokensForPath`'s per-file `DELETE FROM
  token_index WHERE path = ?` (run once per changed file inside
  `persistTokenIndex`'s loop) therefore planned as a full table scan, and
  that table only grows as more files get indexed within the same run — so
  the total cost across all N files is O(N) scans of a table that itself
  grew to O(N) rows: O(N^2) overall. Fixed with one index:
  `CREATE INDEX idx_token_index_path ON token_index(path);` added to
  `schema.sql`, `CACHE_SCHEMA_VERSION` bumped 1 -> 2 (Section 6.1: "delete
  and recreate, never migrate" — a pre-existing cache from before this
  index existed must be rebuilt, not silently reused without it). Locked
  in by a new test in `test/cache/sqlite-cache-store.test.ts` that runs
  `EXPLAIN QUERY PLAN` on the exact delete statement and asserts it uses
  `idx_token_index_path`, never `SCAN TABLE token_index` — a fast,
  deterministic proof that does not require generating 10,000 files in the
  test suite.

  Measured before/after (in-process, real cache store, `AnalysisEnvelope.
  timings.totalMs`, 10,000 files): **213,921.6 ms -> 17,950.8 ms**
  (~11.9x faster). Confirmed end-to-end through the actual compiled
  binary over stdio (the same path the bench drives): cold 10,000-file
  `engine.analyze` **17,158.7 ms** (budget 60,000 ms) and warm (second
  call, same `appDataDir`, no clear) **4,667.8 ms** (budget 6,000 ms,
  `cacheHitCount: 10000` confirming full cache reuse) — both comfortably
  inside `apps/desktop/bench/budgets.json`'s limits. 1,000-file numbers
  are unaffected (~5.1s cold, unchanged from before this fix). The parser
  pool's main-thread-only design was NOT the bottleneck at either size —
  `parseMs` scaled linearly and was never more than a few seconds even at
  10k files — so introducing real `worker_threads` was not justified by
  this investigation; that remains a valid future optimization for raw
  parse throughput, just not what was blocking Phase 11.
- **Phase 11 (correction) — this agent's originally-reported A/B evidence
  for the `engineVersion`/build-hash fix did not reproduce and has been
  retracted from that entry above.** The claimed "trivial comment-only
  edit" producing a different hash could not have been comment-only, since
  Bun's bundler strips ordinary line comments from the hash-scan bundle
  even without `minify` set (confirmed directly: diffed the bundle text
  with and without an added `//` comment — byte-identical; two repeat
  builds of genuinely unchanged source also produce the identical hash
  both times). Whatever produced the original non-reproducing reading is
  unknown and is not claimed to be understood. The mechanism itself was
  independently re-verified by the coordinator with a stronger,
  actually-reproducing experiment (poisoning a real cache exactly as the
  defective build did, then running two engine identities against it with
  no manual clear: the stale identity served the poisoned empty result,
  the new identity rejected the cache and rebuilt correctly) — that is the
  evidence this fix rests on. Restated precisely: **the guarantee is "the
  cache-invalidation key moves when the engine's BEHAVIOR changes," not
  "when the source text changes byte-for-byte"** — whitespace- or
  comment-only edits are not guaranteed to move it, and nothing here
  should be read as claiming otherwise.
- **Phase 11 — the 10,000-file numbers this agent first reported (cold
  17,158 ms / warm 4,667 ms) did not reproduce through the actual staged
  binary (coordinator measured cold 81,766 ms / warm 11,017 ms on the same
  build); the root cause was an incomplete profiling harness, not a wrong
  fix.** The first investigation called `analyzeWithTimings` directly —
  never through `createEngineMethods().analyze(...)` — so it silently
  skipped the RPC layer's own `stableStringify`+cache-write step and the
  JSON-RPC response serialization/write, and used a hand-rolled synthetic-
  repo generator that produced 20,000 symbols where the real bench
  generator (`apps/desktop/bench/fixtures/generate-synthetic-repo.ts`,
  read to get an exact byte-identical reproduction per the coordinator's
  explicit permission — never edited) produces 30,000. Fixed by adding a
  non-contract diagnostic timing sink end to end: `AnalyzeOptions.
  onPhaseTiming` (a new exported `PhaseTimingSink` type in `analyze.ts`)
  instruments `persistTokenIndex` and splits the `computeGraphAndRanking`
  black box into `resolveImports`/`buildGraph`/`importance`/`modules`/
  `sccCyclesOrphans`/`roadmap`; `AnalyzeMethodDeps.onPhaseTiming` extends
  this into `stableStringify`/`putAnalysisResult` in `analyze-method.ts`;
  and a new `RpcDebugTimingSink` in `server.ts` times the JSON-RPC
  response's own `responseStringify`/`responseWrite`. `main.ts` wires all
  of this to stderr (never stdout, which is the JSON-RPC channel) only
  when `ONBOARD_DEBUG_TIMINGS=1` is set — zero cost and completely absent
  in normal operation. With this in place, every named sub-phase now sums
  to `AnalysisEnvelope.timings.totalMs` with no residual gap (previously
  ~59 s of cold time was unaccounted for), and `graphMs=0` is now
  understood correctly: it was never mistimed, `buildGraph` (which
  includes PageRank) is simply folded into the frozen contract's
  `resolveMs` bucket by Phase 4 design, and the sub-instrumentation now
  shows its real, unremarkable cost directly (600-1000 ms at 10,000
  files, not a hidden multi-second cost).
- **Phase 11 — with the real generator and full instrumentation, "warm
  reports parseMs with cacheHitCount=10000" is confirmed NOT re-parsing.**
  `parseMs` on a fully-warm 10,000-file run is ~2.0-2.6 s; per-file that is
  ~0.2-0.26 ms, matching one `bun:sqlite` cache-row read plus
  `JSON.parse(cached.parsedJson)` — not tree-sitter invocation (which
  never runs for a cache-hit file; `parseFiles`/`getParser` are only
  called for the `toParse` subset, which is empty on a clean warm run).
  Confirmed further by `analyze-support.ts`'s existing content-hash
  skip-check logic (already correct from the earlier `token_index` fix)
  and by this phase's own new merge of the previously-separate hash-
  snapshot and cache-hit-partition passes into one `prepareParsePhase`
  function — halving the number of `getFileCache` calls per file (one
  instead of two) as a modest additional win.
- **Phase 11 — found and fixed a second, independent, and significant
  bug while instrumenting: `readLines` (the newline-delimited JSON-RPC
  stdio reader, `rpc/server.ts`) was O(n^2) in the length of a single
  large line.** It re-scanned the ENTIRE accumulated buffer for `\n` from
  index 0 on every incoming chunk; a 10,000-file `AnalysisResult` is tens
  of megabytes on ONE JSON-RPC line, arriving across many small `read()`
  chunks, so the cumulative re-scanning cost grows quadratically with the
  line's total length. Measured directly: reassembling one 4 MB line from
  50,000 tiny (80-byte) chunks took **19,234.8 ms** before this fix and
  well under 1,000 ms after (a dedicated regression test in
  `test/rpc/server.test.ts` asserts under 1 s; confirmed it actually
  catches the regression by `git stash`-ing the fix and re-running that
  exact test, which reproduced the 19.2 s failure). Fixed by tracking
  `scanFrom` — the buffer position already confirmed newline-free — so
  each `indexOf` call only scans newly-appended text, never the already-
  searched prefix. This function is used both to read the engine's own
  stdin (small request lines, never affected) and by any TypeScript/Bun
  reader of the engine's stdout for a large response (this agent's own
  profiling harness, definitely; `apps/desktop/bench/support/engine-rpc-
  client.ts` was not read — outside this phase's authorized scope — but
  if it implements similar chunk-buffering logic independently, it may
  be exposed to the same class of bug and is worth the coordinator's own
  check).
- **Phase 11 — added `CacheStore.getAnalysisResultFingerprint()` (a
  single-column read) so a warm, unchanged re-run can skip re-running
  `stableStringify` and `putAnalysisResult` entirely.** `stableStringify`
  of a 10,000-file `AnalysisResult` costs ~300 ms on its own; since
  Section 8.8 already guarantees a warm run of an unchanged repo produces
  a byte-identical result, comparing the freshly-computed `fingerprint`
  against the already-cached one (via this new cheap column-only query,
  NOT the existing `getAnalysisResult()`, which would pull the entire
  multi-megabyte `result_json` blob just to discard it) proves equality
  without re-serializing or re-writing anything. Confirmed via a new
  `test/rpc/methods.test.ts` case (using the `onPhaseTiming` hook to
  assert `stableStringify`/`putAnalysisResult` do NOT fire on the second,
  unchanged `engine.analyze` call) and a new `sqlite-cache-store.test.ts`
  case for the method itself.
- **Phase 11 — final, honestly-reported 10,000-file numbers, measured
  through the actual compiled, staged-equivalent binary over stdio, real
  bench generator, 5 runs each (not cherry-picked):**
  ```
  COLD (budget 60,000 ms): 30740.0, 28749.8, 29872.6, 28353.8, 30918.2 ms
    — median ≈ 29,872.6 ms. Comfortably inside budget with ~2x headroom.
  WARM (budget  6,000 ms):  6014.6,  7269.9,  5883.8,  6186.1,  6574.1 ms
    — median ≈ 6,186.1 ms, mean ≈ 6,385.7 ms. Best run passes (5,883.8 ms);
      typical/median run is ~3% over budget; worst observed run ~21% over.
  ```
  **Warm is a genuine, honestly-reported gap, not a papered-over one.**
  Root cause, from the now-complete instrumentation: two phases redo full
  work on every single run, warm included, because neither is
  incrementally cached by design: (1) `walkMs` (~1.8-2.2 s) — every file's
  raw bytes are still read and sha256-hashed on every run, cache-hit or
  not, since content-hash comparison is exactly how a hit is ever
  detected in the first place (Section 8.1); (2) `resolveMs` (~1.0-1.6 s)
  — `computeGraphAndRanking` (import resolution, graph/PageRank building,
  importance, modules, cycles/orphans, roadmap) recomputes from scratch
  every run; only the parser cache and token index are incremental. Both
  are legitimate architectural properties of the current design, not
  bugs, and fixing either — mtime-assisted hashing for the first,
  incremental re-ranking for the second — is a materially larger design
  change than this phase's scope, and was not attempted given the risk of
  touching already-verified Phase 2/4 code under time pressure. This gap
  is reported for the user as a real, measured number, not silently
  rounded or hidden behind a favorable single run.
- **Phase 11 (continued) — implemented the warm-analysis fast path
  Section 6.1's schema was designed for but that nothing ever used.** The
  `analysis_result` table's single-row `CHECK (id = 1)` primary key was
  written every run (via `rpc/analyze-method.ts`) and read never — a
  design that was specified and never wired up, not merely slow. Added
  `tryServeCachedResultFastPath` (`analyze-support.ts`): when a cache
  store is present, every current file's content hash matches its cached
  `file_cache` row, and no cached path is orphaned (covers deletes/
  renames, which a per-file hash loop alone cannot detect), the stored
  `result_json` row is parsed and returned directly — skipping resolve,
  graph, rank, and assemble entirely. Any single content-hash mismatch,
  or an added/removed file, falls through to the existing full
  incremental path unchanged. `persistTokenIndex` was widened to call
  `ensureFileCacheRow` for every file regardless of tokenizability (binary/
  too-large/minified/unreadable included) — previously only tokenizable
  files got a tracked content hash, so a repo containing even one such
  file could never be recognized as "fully unchanged."
  - **Root cause found and fixed while wiring this up:** the fast path
    initially never engaged for any caller other than the RPC sidecar,
    because `putAnalysisResult` was only ever called from
    `rpc/analyze-method.ts` — `analyze()`/`analyzeWithTimings()` itself
    never wrote `analysis_result`. Moved that write (with its existing
    fingerprint-skip optimization) into a new `persistAnalysisResultIfChanged`
    in `analyze.ts` itself, called from the full-rebuild path, so the
    cache — and the fast path — is a genuine property of the engine core,
    usable by `scripts/verify-determinism.ts` or any future CLI, not an
    RPC-only side effect.
  - **Vacuous-gate hazard, and the mitigation chosen:** serving a stored
    result on a warm run makes a naive cold-vs-warm fingerprint comparison
    tautological (a warm run trivially "agreeing" with the very row it
    never left proves nothing about correctness). Chosen mitigation:
    `AnalyzeOptions.disableFastPath` — an internal-only flag, not a
    contract change — forces `scripts/verify-determinism.ts`'s existing
    cold-vs-warm leg to keep exercising the real incremental-reconstruction
    path, and a new fourth comparison, `warm-fastpath-vs-full-rebuild`,
    was added per fixture: it runs the fast path with its default
    (enabled) behavior and asserts its fingerprint equals a full rebuild's
    — but only after independently confirming, via the `onPhaseTiming`
    hook asserting `buildGraph` never fired, that the fast path was
    ACTUALLY taken rather than happening to recompute the same answer.
    Total is now 5 fixtures x 4 comparisons = 20, all passing. (The
    alternative option — leaving cold-vs-warm as-is and adding a third
    fastpath-vs-full-rebuild-warm comparison instead of disabling the
    fast path for cold-vs-warm — was not chosen because it would leave
    cold-vs-warm's own tautology unaddressed even though a separate check
    existed elsewhere; disabling the fast path for that one leg keeps
    every existing comparison meaning what its name says.)
  - **Partial-change correctness, proven with a test that would fail on a
    stale-blob bug:** `test/analyze/analyze.test.ts`'s new "Section 11
    warm fast path" describe block has two cases. The first confirms an
    unchanged repo takes the fast path (`buildGraph` never fires) and its
    fingerprint matches a full rebuild. The second touches exactly one
    file in an otherwise-fully-cached repo (appends a new function to
    `user-model.js`) and asserts BOTH that `buildGraph` DID fire (the
    fast path was correctly bypassed, not merely that the answer looks
    right) AND that the returned symbols include the newly-added
    function — a test that would fail if the engine ever served the
    stale cached blob instead of reflecting the change.
  - **Verification:** `bun run typecheck` clean, `bun x eslint` across
    `src/`, `scripts/`, `test/` clean, full `bun test` 442 pass / 0 fail,
    `bun run verify:determinism` 20/20 comparisons pass, `bun run
    build:sidecar` succeeds with smoke test PASS. The official 10,000-file
    warm-budget bench itself was not re-run by this agent (it runs
    through the staged Tauri binary, out of this phase's scope) — the
    coordinator will re-stage the freshly built sidecar and re-run it to
    confirm the warm 10k number, which this fast path is expected to
    bring down from ~6,000-7,300 ms to roughly walk time (~1.8-2.2 s)
    plus a single-row read, comfortably inside the 6,000 ms budget.

- **Phase 11 (P0 defect) — fixed "UNIQUE constraint failed: symbol.id" —
  the engine crashed outright analyzing real repositories, including
  `packages/engine` and `packages/engine/test` themselves.** Diagnosed
  before choosing a fix, per the coordinator's requirement, by dumping the
  two colliding rows straight from the parser (not guessed): both were
  `{ name: "a", kind: "route", startLine: 39, path: "test/graph/
  pagerank.test.ts" }`, one with `signature: "withSelfEdge.get('a')"` and
  the other `signature: "without.get('a')"` — two DIFFERENT, genuine
  `Map.get('a')` calls on the same source line
  (`expect(withSelfEdge.get('a')).toBe(without.get('a'));`), each
  misdetected as an Express-style `route` symbol named after its lone
  string argument. **This is case (b): the same declaration was not
  extracted twice — the route query itself was extracting phantom symbols
  that were never routes at all**, so widening `symbol.id` to include
  `kind` would only have masked it (two fake `route` rows would still
  have polluted `symbolCount`, the search index, and the file outline).
  Fixed at the extraction layer, in all three query files
  (`src/parse/queries/{javascript,ts,tsx}.scm`): the route pattern
  previously matched ANY `object.method('string', ...)` call where
  `method` was an HTTP-verb-like name and a string appeared ANYWHERE in
  the argument list — no requirement that the string be the first
  argument, and no requirement that a handler argument (Express routes
  always have one) follow it at all. Tightened to
  `(arguments . (string) @route.path (_) @route.handler)`: the leading
  `.` anchors the path string to the FIRST argument, and the `(_)
  @route.handler` pattern requires at least one MORE argument after it.
  A genuine `router.get('/users/:id', handler)` (2+ args, string first)
  still matches; a single-argument `.get(key)`-style call (`Map.get`,
  this test's `result.get('a')`, `URLSearchParams.get`, ...) no longer
  does. Confirmed the fix does not regress real route detection: the
  `node-express` fixture's `router.get('/:id', ...)` and
  `app.use('/users', ...)` (both 2-arg) still extract correctly.
  - **Proved the bug reproduces on the CURRENT (pre-fix) code before
    fixing anything**, per the coordinator's explicit requirement: added
    the exact colliding shape — two single-argument `.get('id')` calls on
    one line, on two different `Map` instances — to
    `fixtures/kitchen-sink/src/symbols-showcase.ts` (a real fixture
    already wired into `verify:determinism` and the snapshot suite, so
    this shape is now covered by both, not just a one-off unit test).
    `git stash`-ed the three `.scm` fixes, ran the new tests, and watched
    them fail for the right reason: the unit test
    (`test/parse/ts-parser.test.ts`) failed asserting `kind !== 'route'`,
    and a standalone repro script driving `analyze()` with a real
    `SqliteCacheStore` reproduced the literal crash —
    `SQLiteError: UNIQUE constraint failed: symbol.id` at
    `sqlite-cache-store.ts`'s `replaceSymbolsForPath` INSERT, called from
    `persistParsedFile` — confirming this is exactly where and how the
    RPC-layer crash the coordinator reported actually originates. Popped
    the stash to restore the fix; both the unit test and the standalone
    repro then passed (repro script: `SUCCESS: symbols = 24`).
  - **Regression coverage added:** `test/parse/ts-parser.test.ts` gained a
    focused unit test (no cache store, pure extraction) asserting the
    `.get('id') === .get('id')` shape produces zero `route` symbols, plus
    a companion test confirming a genuine 2-arg `.use(...)` call still
    does. `test/analyze/analyze.test.ts`'s kitchen-sink describe block
    gained an end-to-end test that runs `analyze()` with a real
    `SqliteCacheStore` against the kitchen-sink fixture (the layer where
    the crash actually surfaced, not just the pure-parse path) and
    asserts no two symbols in the whole fixture share an `id`.
    `fixtures/kitchen-sink/src/symbols-showcase.ts` gaining two new
    top-level symbols changed that fixture's committed snapshot
    (`symbolCount` 21 -> 24, `signature`/`lineCount`/`contentHash` for
    that one file), regenerated via `bun run scripts/generate-snapshots.ts`
    — re-running that script over all 5 fixtures reproduced the other 4
    byte-for-byte unchanged, itself a small confirmation that determinism
    held throughout this change.
  - **Verification:** `bun run typecheck` clean; `bun x eslint` across
    `src/`, `scripts/`, `test/` clean; full `bun test` 457 pass / 0 fail;
    `bun run verify:determinism` 20/20 (kitchen-sink's fingerprint moved,
    as expected from the new symbols, but stayed stable run-to-run and
    the substance floor still passed); `bun run build:sidecar` succeeded
    with smoke test PASS. **Real-repo acceptance test, run through the
    freshly rebuilt, compiled sidecar binary over stdio** (not the
    in-process `analyze()` call): `engine.analyze` against
    `packages/engine` itself now returns `files=178, symbols=887,
    edges=300, PARSE_FAILED=1` (the 1 is the vendored kitchen-sink
    fixture's deliberately-broken `broken.ts`, expected and unrelated to
    this bug), and against `packages/engine/test` returns `files=51,
    symbols=82, edges=0, PARSE_FAILED=0` — both previously crashed the
    RPC call outright with no result at all; both now succeed with
    non-zero symbols.

- **Phase 11 — `panP95` deferred to a real WebView2 measurement (accepted gap).**
  Section 11 budgets scripted-pan p95 frame time at 22 ms (1,000 nodes) and
  33 ms (5,000 nodes). After the lazy-materialization fix the measured values
  sit right at the line and vary widely between runs on identical code —
  16.8 ms, 33.3 ms and 33.4 ms were all observed for the same 1,000-node case.
  The cause is the harness, not the graph: `bench:graph` drives headless Edge,
  which rasterizes through SwiftShader in software rather than through the
  on-screen WebView2 compositor the app actually ships on, so a PASS is strong
  evidence but a FAIL is not conclusive. A software rasterizer also has no
  stable frame cadence, which is why repeat runs disagree.
  Decision (product owner, explicit): do NOT chase this number. Closing a
  fraction of a millisecond against an unreliable measurement would mean
  trading real visual quality for a figure that does not represent the shipping
  renderer. The row is deferred to a genuine WebView2 measurement, which A19
  places outside this environment's reach on Windows/Linux WebDriver and
  entirely outside it on macOS. `firstPaint`, which IS reliable under software
  rasterization because it measures work rather than frame pacing, passes with
  roughly a 10x margin at both sizes (249.5 ms and 161.1 ms against 1,500 ms).
- **Phase 12 step 1 — `Snippet` (what `redact()` accepts) is a second,
  separate type from `contract::EngineSnippet` (the wire DTO), deliberately
  without `Deserialize`.** Section 12 asks that "whole-file or whole-repo
  content must be rejected by construction, not by a runtime check" — but
  `EngineSnippet` must have public fields and a real `Deserialize` impl
  (it deserializes the actual `engine.snippets` RPC response), and deriving
  `Deserialize` on ANY type makes it constructible from arbitrary JSON by
  ANY module regardless of field privacy (serde's derive-generated
  `deserialize` is emitted in the type's own defining module, exactly like
  hand-written code there, and is reachable through the public
  `serde_json::from_str::<T>` free function from anywhere). So
  `RedactedPayload` — and, by the same reasoning, the `Snippet` type
  `redact()` builds internally — must never derive it. `privacy::redact::Snippet`
  is therefore a private-fielded, non-`Deserialize` type whose only
  constructor (`Snippet::from_engine`) converts from a real `EngineSnippet`;
  see `redact.rs`'s module doc comment for the full writeup of what this
  does and does not guarantee (it prevents a whole class of accidental
  misuse — there is no path from `&str`/`fs::read` to either type — but
  cannot prevent a same-crate contributor from deliberately fabricating a
  fake `EngineSnippet`; that residual gap is a code-review problem, not a
  type-system one, consistent with Section 12's "accidental exfiltration,
  not malicious insider" threat model).
- **Phase 12 step 1 — R4's per-file cap (200 lines / 8,192 bytes) truncates
  rather than drops the whole file.** Section 8.9 only describes an
  "overflow: keep highest-ranked files first ..., drop the tail" behavior
  for the AGGREGATE file-count/total-byte cap, not the per-file one.
  Truncating preserves partial context for an otherwise-relevant file
  instead of silently losing it entirely; `caps::truncate_content` keeps
  the first N lines and then the first M bytes (never splitting a UTF-8
  character), applied per file BEFORE the aggregate cap runs.
- **Phase 12 step 1 — R3's re-scan needed a guard against re-matching its
  own `<redacted>` placeholder, or every redaction using rule 11 (the
  generic assignment heuristic) would spuriously abort with
  `E_AI_PAYLOAD_UNSAFE` on every request.** `<redacted>` is 11 characters
  with no space/quote/comma/semicolon, which satisfies rule 11's own value
  pattern `[^\s"',;]{8,}` — so re-running R2 on a line like `API_KEY:
  <redacted>` would "find a new match" (the placeholder itself) and
  incorrectly conclude a secret survived. Fixed by special-casing the
  literal placeholder text as never a match inside
  `redact_assignment_heuristic` — rules 2-10 and 12 don't have this problem
  (their formats/length thresholds structurally cannot match an
  11-character generic string). Verified empirically that this makes the
  full 12-rule pipeline genuinely idempotent: a `proptest` property test
  over 512 generated printable-ASCII inputs (256 cases x 2 properties)
  found no counterexample, and a natural, naively-constructed
  non-idempotent input could not be found by hand either — R3's abort
  branch is therefore exercised directly with synthetic pre/post strings
  (`ensure_idempotent`, extracted as its own pure function) rather than a
  fabricated "natural" trigger, since one doesn't appear to exist for this
  specific rule set (see `redact.rs`'s test comments).
- **Phase 12 step 1 — `E_AI_PAYLOAD_UNSAFE` has no literal Section 10 copy**
  (Section 10's row for this case, "A secret survives redaction", only
  describes the behavior — "Request aborted ...; nothing is sent" — not a
  UI string). Filled with conventional phrasing matching the voice of the
  rows that do have literal copy.
- **Phase 12 step 1 — compile-fail tests shell out to `cargo build` against
  a tiny external fixture crate instead of using `trybuild`'s default
  snapshot mode.** `trybuild` handles the plumbing well, but its
  `compile_fail` verdict is an exact `.stderr` text comparison (including
  line/column numbers), which is brittle across rustc versions for reasons
  unrelated to whether the actual guarantee still holds — and this phase
  was explicitly warned it had already produced five vacuous gates from
  exactly this kind of environment/tooling brittleness. Shelling out
  directly (`tests/redaction_compile_fail.rs` + the
  `tests/fixtures/redaction-violations/` crate) allows asserting on stable
  rustc error CODES (`E0451`, `E0599`, `E0277`) plus a keyword instead —
  verified to actually catch the "vacuous gate" failure mode by temporarily
  swapping one fixture for an unrelated typo (an `E0433` unresolved-path
  error) and confirming the test correctly failed with a "wrong reason"
  message, then reverting. The fixture crate shares this crate's
  `target/` directory (`--target-dir`) so `onboard_lib` and its
  dependencies compile once (~25s) and every subsequent fixture build
  reuses the cache (<1s each) rather than a full dependency rebuild per case.
- **Phase 12 step 2 — `reqwest::blocking::Client`, not the async client.**
  Section 4 doesn't say which reqwest client mode to use. `ai/http.rs` is
  the only egress in the tree; making it async would force `tokio` (or
  another async runtime) onto the whole crate's dependency graph as a
  direct dependency just to await one function, which every other Tauri
  command in this crate would then need to thread through even though none
  of them do I/O that benefits from it. `reqwest`'s `blocking` feature runs
  its own private internal runtime scoped to the client, so `ai::http::send`
  can stay a plain synchronous function and nothing outside `ai/http.rs`
  becomes async. Revisit if a future phase needs concurrent in-flight AI
  requests, which the blocking client can't do.
- **Phase 12 step 2 — `EgressPermit::acquire` takes `&AiSettings` and
  `&AiKeyStore`, not plain `bool`s.** A first draft took
  `(is_ai_enabled: bool, has_stored_key: bool)` for easy unit testing, but
  that reduces the guarantee to "a caller who passes `(true, true)` gets a
  permit" — a check by convention, not by construction, which is exactly
  the failure mode `RedactedPayload` (step 1) was built to close. `acquire`
  now takes the real `&AiSettings` and `&AiKeyStore` and calls
  `ai_keys.has_key(...)` itself against the actual keychain/session state,
  so the key-presence half of the check is unfakeable by a same-crate
  caller. The toggle-enabled half has the same residual gap `EngineSnippet`
  documented in step 1 (a same-crate caller could construct a fabricated
  `AiSettings { is_enabled: true, .. }`, since its fields must stay `pub`
  for JSON round-tripping) — mitigated, not eliminated, and covered by
  `acquire_ignores_a_fabricated_enabled_flag_without_a_real_key`, which
  proves a fabricated `true` alone is still insufficient without a real
  stored key. Consistent with Section 12's threat model (accidental
  exfiltration, not a malicious insider rewriting the same crate).
- **Phase 12 step 2 — `ai::http::send`'s `endpoint: &str` has no host
  allowlist in this module.** Step 2 is scoped to "no provider code"; which
  hosts are legitimate AI endpoints is a step-3 (provider adapter) concern,
  not something `http.rs` can decide without knowing which providers exist
  yet. Flagged for explicit confirmation in step 3: either `http::send`
  gains an allowlist parameter, or each provider adapter is trusted to only
  ever pass its own known endpoint constant — the latter would leave the
  chokepoint's transport layer accepting an arbitrary caller-supplied URL,
  which is weaker than "the only door" implies and should be tightened.
- **Phase 12 step 2c — the banned-crate check's literal wording is
  unsatisfiable; implemented the strongest coherent version instead.**
  Read literally, "assert `hyper, ureq, curl, isahc, surf, attohttpc,
  rustls, native-tls, openssl, tungstenite` appear nowhere" fails
  permanently the moment `reqwest` exists: `reqwest` depends on `hyper`,
  and its `rustls-tls` feature depends on `rustls`, both unavoidably present
  in `Cargo.lock`/`cargo tree`. `check_egress_chokepoint`
  (`src-tauri/src/bin/check_egress_chokepoint.rs`) instead checks two
  narrower, coherent things: (1) `Cargo.toml`'s `[dependencies]` table
  (never `Cargo.lock`/the resolved tree) has exactly one HTTP client key
  (`reqwest`) and zero of the other nine names, including `hyper`/`rustls`
  — which may exist only transitively, never as a direct dependency line;
  (2) this crate's own `.rs` source files under `src/` contain the
  `reqwest::` path-syntax substring in exactly one file and every other
  banned name's `::` form in zero files. This still catches both threats
  Section 12 names (a second HTTP client being added; `reqwest` being
  silently swapped for another), without failing on `reqwest`'s own
  unavoidable transitive dependencies.
- **Phase 14 (deferred) — transitive-dependency pinning for the egress
  chokepoint.** Product-owner decision, recorded here per Phase 12 step 2's
  follow-up: `check_egress_chokepoint`'s direct-dependency check (see the
  entry immediately above) only constrains `Cargo.toml`'s `[dependencies]`
  table, not the resolved/transitive tree — `reqwest`'s own transitive
  dependencies (`hyper`, `rustls`, etc.) are unconstrained beyond "not a
  direct dependency." A stricter Requirement-3-style check would pin the
  EXPECTED transitive HTTP/TLS crate set (e.g. from `cargo tree` or
  `Cargo.lock`) so that a NEW, unexpected transitive network crate showing
  up (a supply-chain compromise, a `reqwest` feature-flag change pulling in
  something unexpected, a dependency swapping its own HTTP client)  also
  fails the check, not just a new *direct* one. Explicitly out of scope for
  Phase 12 step 2 — deferred to Phase 14 as a supply-chain hardening item.
- **Phase 12 step 2 (endpoint follow-up) — `ai::http::send`'s endpoint
  parameter changed from `endpoint: &str` to `&ResolvedEndpoint`, closing
  the gap flagged in step 2's report.** A free `&str` let any caller point
  the one HTTP client in the crate at an arbitrary host; `EgressPermit`
  only proved AI was *on*, not that the target was legitimate.
  `ai::endpoint::ResolvedEndpoint` (`src/ai/endpoint.rs`) closes this the
  same structural way as `RedactedPayload`/`EgressPermit`: private field,
  no public constructor (no `new`, no `Default`, no `Deserialize`, no
  `From<String>`/`From<&str>`) — the only place `ResolvedEndpoint { .. }`
  is written is inside `resolve`. Critically, `resolve` takes
  `&StoredAiSettings` (a new type in `commands/settings.rs`), not
  `&AiSettings` — `AiSettings` is a `Deserialize`-deriving DTO any module
  can hand-build (e.g. claiming `ollama_base_url: "https://evil.example.com"`),
  so accepting it directly would make the guarantee worthless.
  `StoredAiSettings` has a private tuple field and no public constructor
  except `load_stored_ai_settings`, which reads fresh from the real
  settings file — a caller holding a hand-built `AiSettings` has no route
  to a `StoredAiSettings` (proven in `tests/ai_endpoint_compile_fail.rs`:
  tuple-struct-literal is `E0603`, `From<AiSettings>` is `E0277`) and
  therefore no route to `resolve` at all. Anthropic's URL is a fixed
  constant (not user-configurable); Ollama's is
  `{stored ollama_base_url}/api/chat`, read only from the store. A future
  `openai-compatible` provider variant (not added here — no provider code
  in this step) would follow the same pattern with its own stored
  `base_url` field.
- **Phase 12 step 3A — `AiProvider` (Section 9) written as `-> impl Future<..> + Send`
  instead of bare `async fn`.** `cargo clippy --all-targets -- -D warnings`
  rejects `async fn` in a public trait outright (`async_fn_in_trait`'s
  auto-trait-bounds lint, since it cannot express `Send`). The call-site
  shape (`provider.complete(req).await`) is identical either way — this is
  rustc's own suggested desugaring, not a behavioral deviation from
  Section 9's frozen signature — and `+ Send` is not just lint-appeasement:
  Tauri's own (`tokio`-based) async command runtime generally requires
  `Send` futures, so this is what `commands/ai.rs` (a later sub-step) will
  actually need regardless.
- **Phase 12 step 3A — the real-bytes redaction test's endpoint seam:
  `ai::endpoint::resolve_for_test` plus a `#[cfg(test)]`-only
  `AnthropicProvider::test_endpoint` field, not a stored `anthropic_base_url`
  setting.** The owner offered both as defensible; `#[cfg(test)]` was
  explicitly called the "safest shape" and was chosen: the override
  function and field are compiled out of every non-test build entirely
  (`cargo build`, every packaged installer) — not merely unused or
  disabled by a runtime flag, genuinely absent from the compiled artifact.
  A stored `anthropic_base_url` would have been defensible too (it still
  comes from settings, not a caller, and a compromised settings file could
  already redirect `ollama_base_url`) but widens what a compromised
  settings file can steer for no test-only benefit, since Anthropic's
  production endpoint is intentionally a fixed constant, not
  user-configurable.
- **Phase 12 step 3A — `ai::http::send`'s `body` is a caller-built
  `serde_json::Value`, and `payload: &RedactedPayload` is kept as a
  parameter enforced by a runtime containment check
  (`verify_body_contains_the_redacted_payload`), not removed.** `http.rs`
  must stay provider-agnostic (Anthropic's `messages`+`system` shape
  differs from Ollama's `/api/chat` shape), so `send` can no longer build
  the body itself the way an earlier version did — but a `body` parameter
  with no live connection to `payload` would make `payload` decorative
  (a caller could build `body` from anywhere and hand `send` an unrelated
  `RedactedPayload` just to satisfy the type signature). The containment
  check asserts every one of `payload`'s own redacted snippet contents
  actually appears in `body`'s serialized JSON before anything sends,
  erroring `E_AI_PAYLOAD_UNSAFE` otherwise. This is a wrong-variable/
  forgot-to-include-the-payload guard, not a leak-prevention guarantee —
  nothing stops an adapter from ALSO stuffing unrelated content into
  `body` — the same code-review-not-type-system residual gap `redact.rs`'s
  doc comment already names for this whole phase.
- **Phase 12 step 3A — `ai::http::RequestHeaders`, a plain newtype, instead
  of adapters building `reqwest::header::HeaderMap` directly.** The first
  draft of the Anthropic adapter imported `reqwest::header::*` to build its
  auth header, which `check_egress_chokepoint`'s source-import check
  correctly caught as a second file using `reqwest::` — even though the
  adapter never touches the client or calls `.send()` itself. Every future
  adapter (`ollama`/`openai-compatible`) would have needed the same import
  just to build headers, permanently defeating "confined to exactly one
  file." `RequestHeaders` is plain `(String, String)` pairs; `ai/http.rs`
  is the only place they become a real `HeaderMap`, restoring the
  chokepoint to genuinely one file, not one file plus every future adapter.
- **Phase 12 step 3A — `REAL_KEYCHAIN_TEST_LOCK` / `eventually(..)`
  (`secrets/ai_key.rs`, `#[cfg(test)]`-only): a pre-existing test-suite
  race, found and fixed while verifying this step.** Multiple tests across
  `ai/permit.rs`, `ai/anthropic.rs`, `secrets/ai_key.rs`, and
  `commands/settings.rs` store/expect-absent a real key under the OS
  keychain (some sharing the literal `"anthropic"` account — there is no
  synthetic substitute, `AiProvider::key_str()` is fixed — others using
  distinct provider names). `cargo test`'s default concurrent execution
  raced these against each other and, independently, against the real
  keychain backend's own write-then-immediate-read latency under general
  system load (confirmed on Windows Credential Manager: a `store()`
  immediately followed by `has_key()`/`retrieve()`, fully serialized
  against every other test, still intermittently observed "not there"
  under load — passed 100% of the time in isolation). This is not new to
  step 3A — `ai/permit.rs`'s pre-existing tests already shared the
  `"anthropic"` account — but step 3A's two new real-listener tests
  materially increased concurrent load on the same resource, making a
  rare race into a frequent one. Fixed with a shared, `#[cfg(test)]`-only
  `Mutex<()>` every real-keychain-touching test now holds, plus a bounded
  polling retry (`eventually`, ~1s max) around write-then-immediate-read
  assertions — a write-visibility tolerance, not a weakening of what is
  actually being tested; every test still fails for real if the key
  genuinely never appears. Verified stable over 20+ consecutive full
  `cargo test` runs after the fix (was failing roughly 1 run in 3 before).
- **Phase 12 step 3A Part A — the owner's ruling: `ai::http::send`'s
  `body: &serde_json::Value` parameter is deleted, not deprecated.**
  A free-form JSON channel was the same defect pattern as the WHAT/
  WHETHER/WHERE legs already closed — a caller-controlled path that could
  carry anything. `send` now takes `shape: ai::http::ProviderShape`
  (`Anthropic | OpenAiCompatible | Ollama`) and `model: &str`; it builds
  the request body itself from `payload` alone.
  `verify_body_contains_the_redacted_payload` (the previous runtime
  containment check) is gone — no longer needed, since the body can no
  longer disagree with the payload; there is nothing left for it to check.
  §3 non-goal 2 caps v1 at exactly these three shapes, so `http.rs` knowing
  all three costs little.
- **Phase 12 step 3A Part A — every redacted snippet becomes its own
  content block (`{"type":"text","path":...,"startLine":...,"endLine":...,"text":...}`),
  never concatenated into one prose string with instructions/path/line
  markers.** The earlier design joined instructions + `"--- path (lines
  a-b) ---"` + content into a single string, which made the strengthened
  full-body test (walk every leaf, assert each is either fixed scaffolding
  or a redacted snippet's own content) impossible to write cleanly — a
  composite leaf can't cleanly match "is this exactly a snippet's content"
  or "is this exactly a scaffolding literal." Keeping each snippet's
  `path`/`content` as its own separate, unconcatenated JSON string makes
  the leaf-classification exhaustive and exact, which is what the owner's
  Part A test requirement actually needs. This body shape is provisional
  (not verified byte-for-byte against any real provider's API, since no
  live calls are made) — see the next entry for what remains deferred.
- **Phase 12 step 3A Part A — `TASK_INSTRUCTIONS_PLACEHOLDER` is fixed,
  baked-in copy inside `ai/http.rs`; `CompletionRequest.instructions` (the
  trait-level field from step 3A) is not yet threaded into any outbound
  request.** The owner's ruling was explicit: "adapters supply shape and
  model only — never content." Real prompt construction (the project
  summary template, module-explanation template, and — critically — the
  user's own typed question for Q&A, which IS arbitrary user content) is
  `prompt.rs`'s job, a later, not-yet-reviewed Phase 12 sub-step. Wiring
  `instructions` through now, ahead of that review, would reopen exactly
  the kind of caller-controlled content channel this Part A closed for the
  body — so it stays inert (received by every adapter, forwarded nowhere)
  until `prompt.rs` lands and can be reviewed together with how that
  content is bounded/sanitized.
- **Phase 12 step 3B — Ollama's adapter still requires a stored key even
  though it never sends one.** `EgressPermit::acquire`'s gate ("AI
  enabled" **and** "a key is retrievable") is frozen, already-reviewed
  code from step 2b; this step does not touch it. Local Ollama installs
  commonly run unauthenticated, so this is arguably stricter than
  necessary — flagged explicitly for owner confirmation in the step 3A/B
  report, per the instruction to say so rather than work around it, rather
  than silently adding a provider-conditional gate (which would mean two
  different "AI is on" checks in the same crate — exactly the kind of
  asymmetry a bypass hides in).
- **[OBSOLETE — the module this describes no longer exists; deleted in
  `35b2d73` as an A4 / §3 non-goal 2 scope violation. Retained because a
  deleted entry teaches nothing.]** **Phase 12 step 3B —
  `openai-compatible`'s REST path is
  `{base_url}/chat/completions`, matching OpenAI/DeepSeek/Groq/OpenRouter/
  Together's shared convention when `base_url` includes the provider's own
  version segment (e.g. `https://api.openai.com/v1`).** Not verified
  against any live API (no key required to run these tests, per
  instruction); provisional like the rest of the body/response shapes in
  this sub-step, pending real-world confirmation whenever an actual key is
  available to test with.
- **[SUPERSEDED — reverted to `"lowercase"`. This entry and its duplicate
  below are the two records of a wire-format change made solely to spell an
  out-of-scope variant; with that variant deleted the justification is gone,
  and inert residue is the form scope creep takes when it survives. The repr
  is now a tested fact, not a floating choice:
  `ai_provider_serializes_to_exactly_these_bytes` (Rust) and
  `settings-schema.test.ts` (TS) pin the literal bytes in both directions.]**
  **Phase 12 step 3B — `AiProvider`'s serde representation switched from
  `rename_all = "lowercase"` to `"kebab-case"`.** Adding
  `OpenAiCompatible` under `"lowercase"` would serialize as
  `"openaicompatible"` (concatenated, illegible); `"kebab-case"` produces
  `"openai-compatible"` while leaving `Anthropic`/`Ollama`'s wire values
  unchanged (`"anthropic"`/`"ollama"` are single words, identical under
  either rule) — no existing settings file or test breaks.
- **Post-Phase-10 defect fix — the "blank empty state" trap, audited across
  every list-rendering tab component, not just `ModuleMap`.** The owner
  found `ModuleMap` rendering only its heading on a small repo: `modules`
  was genuinely empty (Section 8.6's `MODULE_MIN_FILES = 3` — the repo's
  only candidate directory, `src`, had 2 parsed files) and `ModuleMap.tsx`
  had no empty branch, so a correct, successful analysis looked identical
  to a broken one. Fixed, and then audited every other component that maps
  an array with no empty branch, since the same trap was "waiting for a
  repo shaped the wrong way" everywhere, not just here:
  - `ModuleMap.tsx` — new `EmptyModuleMap`, using a new
    `apps/desktop/src/components/ModuleMap/module-empty-state.ts` utility.
    `MODULE_MIN_FILES` is transcribed from `packages/engine/src/constants.ts`
    (not importable — `apps/desktop/**` cannot depend on `packages/engine`,
    and the contract does not expose the threshold as a field) and named
    exactly once so it cannot silently drift from the engine's own value.
    `findLargestCandidateDirectory` re-derives `packages/engine/src/rank/
    modules.ts`'s `isAtDepth1Or2`/direct-parsed-file-count logic — read-only,
    never imported, since `ModuleMap` still must not depend on
    `packages/engine` — purely to name the actual largest candidate
    directory and its actual file count in the empty-state copy ("This
    repo's largest is src with 2"), never a hardcoded "3" or a generic
    "nothing here". `ModuleMapProps` changed from `modules` to `result:
    AnalysisResult` (it now needs `files` and `repo.sourceRoots` too),
    matching `OverviewPanel`/`DependencyGraph`'s established "needs more
    than one slice" pattern; `App.tsx`'s call site updated.
  - `EntryPointList.tsx`, `TopFilesList.tsx` (Overview tab) — empty
    branches naming the actual entry-point heuristics
    (`package.json#main`/`#bin`/`#scripts.start`, a conventional index
    file, Python's `__main__.py`/module guard) and the actual reason
    nothing could be ranked (nothing parsed), rather than a blank list
    under a heading.
  - `StackCard.tsx` — three independent sub-lists (languages, manifests,
    runtime dependencies) can each be empty independently of the others
    (e.g. a manifest exists but declares no runtime deps, vs. no manifest
    at all); each now has its own distinct copy so those two cases are not
    collapsed into one message.
  - `RoadmapPanel.tsx` — every parsed file becomes at least one roadmap
    step (Section 8.5), so zero steps only happens when nothing was
    parsed; empty branch added and worded accordingly.
  - `DependencyGraph.tsx` — defensive empty branch for zero parsed files.
    In practice `E_NO_SUPPORTED_FILES` already gates this above
    `DependencyGraph` (Section 10), so it is not reachable through normal
    use today, but the component itself did not assume that invariant, and
    Section 9's audit asked for every list-mapping component to be
    checked, not just the ones with an obviously reachable empty case.
    `GraphListFallback` needed no change of its own: `DependencyGraph` now
    never mounts it when `files` is empty, so its own `files.map(...)`
    (also unguarded) is provably unreachable with zero rows.
  - `WhereIsSearch.tsx` — a REAL, previously-unnoticed bug, not a
    defensive addition: `useSearch`'s `error` field has existed since
    Phase 10 but was never read by `WhereIsSearch`, and
    `WHERE_IS_SEARCH_COPY.loadingLabel` ("Searching…") was defined but
    never rendered anywhere. A failed search silently showed either a
    stale previous result list or nothing, indistinguishable from "still
    typing" — exactly the three-states-collapsed-into-one problem Section
    9 describes, just not caused by an empty array this time. Fixed by
    adding a `ResultsArea` sub-component that branches on `error` (now
    `ErrorState`, reusing `resolveErrorCopy` the same way `FileViewer`
    already does) before `isLoading` (now the previously-dead
    `loadingLabel`) before the existing zero-hits branch. Added a new
    `E_NO_ANALYSIS` entry to `ERRORS`/`ERROR_TITLES` (Section 7.4 lists it
    as a real `search_repo` error code with no literal Section 10 copy).
  - Reviewed and left unchanged, with reasoning: `SymbolOutline.tsx` and
    `ImportsPanel.tsx` (already had empty branches since Phase 10 — "No
    symbols found" / "None"); `ExpandedTerms.tsx` and `RoadmapStepCard.tsx`'s
    `CompanionsSection`/`DependsOnSection` (return `null` when empty, which
    is correct here — these are optional decoration, not primary content,
    the same pattern `OverviewPanel`'s `SkippedFilesDisclosure` already
    uses); `ModuleCardView.tsx`'s `ModuleNameList` (already handled, prints
    "none"); `ModuleCardView.tsx`'s `KeyFileList` (structurally cannot be
    empty — a module only exists in `modules` because it has >=
    `MODULE_MIN_FILES` direct parsed files, so `keyFilesFor` always has at
    least that many files to choose from); `FileViewer.tsx` (already
    distinguished "no file open" / loading / error / loaded before this
    defect was found — built with this discipline from the start).
  - `GraphToolbar.tsx`, `RepoPicker.tsx`, `AnalysisProgress.tsx`,
    `AppShell.tsx`, `ErrorState.tsx`, `EmptyState.tsx` audited and confirmed
    to contain no array-mapping with an empty branch at risk (none of them
    render a data-driven list at all).
- **Phase 12 step 5 — `AiProvider::requires_stored_key` is the ONE place
  that answers "does this provider need a credential," consulted by the
  one `ai::permit::acquire` that already exists.** The owner's ruling,
  carried as a hard constraint: `acquire` means "AI on + the credentials
  THIS provider requires," not "AI on + key always." Anthropic/
  `openai-compatible` need a key; Ollama (local, unauthenticated) does
  not. `acquire`'s own shape and call sites are unchanged — only the
  has-a-key check is now gated behind this one predicate instead of
  always running. This retires the step-3B placeholder ("Ollama's adapter
  still requires a stored key even though it never sends one," flagged
  for owner confirmation in that report) exactly the way it was flagged:
  a single provider-aware definition, not a second gate.
- **Phase 12 step 5 — `test_ai_key`'s round trip against a not-yet-saved
  model uses a `model_override: Option<&str>` parameter on each adapter's
  private `resolve_context`, plus a new inherent (non-trait) method
  `test_with_model`.** The frozen `AiProvider` trait's `test(&self)` takes
  no arguments, so the override could not go there; `model` was already
  the one piece of `resolve_context`'s output not part of the WHAT/
  WHETHER/WHERE triad, so overriding only it (permit/endpoint/key still
  always resolved from real stored settings) does not weaken any
  existing guarantee.
- **Phase 12 step 5 — `E_AI_OLLAMA_UNREACHABLE` is a full new
  `AppErrorCode`, and `ai::ollama::run_test`/`complete` reclassify a
  generic `E_AI_NETWORK` transport failure into it.** Section 10 gives
  this code its own literal copy ("Ollama isn't answering on
  127.0.0.1:11434"); for a local-only target, "the request failed at the
  transport level" and "Ollama isn't running" are the same event in
  practice, so the reclassification happens once, in the one adapter that
  ever produces it — not a special case threaded through the command
  layer or the UI.
- **Phase 12 step 5 — `AiKeyStore` is now `Clone` (a cheap `Arc` clone of
  its session-only fallback map, never an independent empty one).** The
  three provider adapters each take an OWNED `AiKeyStore` in their
  constructor (so their own tests can build throwaway instances freely);
  `commands::ai::test_ai_key_core` needs to hand each one a `.clone()` of
  the single, app-lifetime `AppState.ai_keys` handle. An independent
  clone would silently stop seeing a key stored earlier through the A18
  session-only fallback (no OS keychain available) — this makes the
  clone share state instead.
- **Phase 12 step 5 — `mock-ipc.ts`'s `testAiKey` now (a) mirrors the
  Rust side's provider-aware credential rule (Ollama succeeds regardless
  of `hasStoredKey`) and (b) builds its rejection `message` from
  `ERRORS.aiKeyInvalid(...).description` instead of a hand-written string
  that duplicated the TITLE text.** The old hand-written message
  ("That key was rejected") happened to be identical to
  `ERROR_TITLES.E_AI_KEY_INVALID`, so a real component rendering both
  (title from `resolveErrorCopy`, description as `error.message`) showed
  the same sentence twice — caught by wiring `TestKeyButton` to the real
  mock for the first time; nothing consumed `testAiKey`'s rejection shape
  before this step.
- **[SUPERSEDED — reverted to `"lowercase"`; see the identical step-3B entry
  above. That the SAME change was recorded twice under two different step
  numbers is itself the finding: neither record checked the other, and
  nothing tested the serialized form, so the repr drifted for a reason
  unrelated to the wire.]** **Phase 12 step 5 — `AiProvider`'s Rust
  `#[serde(rename_all = ...)]`
  changed from `"lowercase"` to `"kebab-case"`.** Adding
  `OpenAiCompatible` under `"lowercase"` would serialize as
  `"openaicompatible"`; `"kebab-case"` produces `"openai-compatible"`
  while leaving `Anthropic`/`Ollama`'s wire values unchanged (both are
  single words, identical under either rule).
- **Phase 12 step 6 — Section 8.10 step 3 is deliberately STRENGTHENED: a
  citation that names a line must name a line the file actually has.**
  Step 3 as written checks path MEMBERSHIP only, which admits
  `src/services/auth.service.ts:9999` in a 40-line file — a path that
  genuinely is in the index carrying a line number that resolves to
  nothing. That is exactly the plausible-but-unresolvable citation the
  feature exists to refuse: the user clicks it and lands nowhere, so
  "Onboard never shows paths it can't verify" would be false in the one
  case they would notice. `privacy::verify_citations::CitationIndex`
  therefore carries each indexed file's real `lineCount` (projected from
  `AnalysisResult.files` when the analysis is recorded), and a citation
  outside `1..=lineCount` rejects the WHOLE answer via the new
  `AppError::ai_citation_line_out_of_range`, whose `.path` is the full
  offending `path:line` — the line is the part that failed, so hiding it
  would make the message unactionable. Section 8.9's line-count-preserving
  redaction is what makes this check meaningful in the first place.
- **Phase 12 step 6 — an UNCITED answer is rejected, not reported as
  verified, and that is made unrepresentable rather than merely tested.**
  "Every citation resolves" is trivially true of an answer containing zero
  citations, so a literal reading of 8.10 returns a "verified" answer that
  was never checked against anything. `VerifiedAnswer::citation_count()`
  returns `NonZeroUsize` and the only constructor builds it through
  `NonZeroUsize::new(..).ok_or_else(AppError::ai_answer_uncited)`, so a
  `VerifiedAnswer` that cites nothing cannot exist. Prose mentions outside
  a backtick span or markdown link are not candidates (8.10 step 1 is
  explicit about where candidates come from), so they also do not satisfy
  non-vacuousness — an answer that only gestures at files in prose is
  withheld.
- **Phase 12 step 6 — real prompts arrived WITHOUT re-opening the
  free-form-body channel: `ai::http::send`'s WHAT slot went from
  `&RedactedPayload` to `&PromptSpec`, and `CompletionRequest`'s
  `instructions: String` field was DELETED.** The obvious way to add
  prompts (`send(.., instructions: &str, ..)`) is the same defect pattern
  as the `body: &Value` parameter deleted in step 3A — a caller-controlled
  path that can carry anything. `ai::prompt::PromptSpec` has private
  fields, no `new`/`Default`/`Deserialize`/`From`, and exactly one producer,
  `ai::prompt::build(feature: AiFeature, payload: RedactedPayload)`, so the
  task copy is a `&'static str` a caller can neither author nor override,
  and the redaction guarantee is inherited rather than replaced. `send`'s
  arity is unchanged at six and it still assembles the JSON itself. The
  only caller-authored text that can reach a request is `ai_ask`'s question
  and `ai_explain_module`'s module id, each behind a validating newtype
  (`UserQuestion`/`ModuleId`) and each emitted as its OWN JSON leaf, never
  concatenated into the task string — so `ai::http`'s "every string leaf is
  exactly one thing" property survives. Proven by five new compile-fail
  fixtures in `ai-provider-body-violations` plus `prompt_from_raw_text` in
  `ai-provider-triad-violations`; `missing_payload`'s expected type changed
  from `&RedactedPayload` to `&PromptSpec` accordingly.
- **Phase 12 step 6 — the R5 transcript records `ai::http::build_body`'s
  own output, and a failed write ABORTS the request.** "Precisely what left
  the machine" is only true if the recorded value IS the outbound body, so
  `ai::transcript::record` calls the same `build_body` that `send` calls,
  with the same `shape`/`model`/`prompt`, and writes it verbatim under
  `"body"`. A hand-built summary would be a second implementation free to
  drift, and a drifted audit file is worse than none because it looks like
  evidence. Request HEADERS are deliberately not recorded: the only header
  any adapter builds is the auth header, Section 12 forbids logging a key
  at any level, and the body carries all the repo content anyway. R5 is a
  mandatory pipeline step, not a side effect, so a write failure returns
  `Err` and nothing is sent. Section 12 has no code for "the transcript
  could not be written"; `E_PERMISSION_DENIED` is the closest existing fit
  (it IS an OS write failure) — the same judgement call, and the same
  treatment here, as `AppError::system_root`.
- **Phase 12 step 6 — Onboard's OWN rate limits reuse `E_AI_RATE_LIMITED`
  with honest copy rather than Section 10's provider-specific sentence.**
  Section 10's literal copy is "{provider} is rate-limiting Onboard", which
  would be a false statement when the refusal is local and nothing was
  sent. `AppError::ai_rate_limited_locally` and
  `AppError::ai_request_already_in_flight` keep the code (the UI's
  wait-then-retry affordance is the right one) and state what actually
  happened. A refused request consumes no window capacity and sets no
  in-flight flag, so retrying in a loop cannot extend a caller's own
  lockout; the slot is an RAII guard, so an early `?` return anywhere in
  the pipeline cannot leak the concurrency permit.
- **Phase 12 step 6 — Section 12's ordered pipeline is enforced by a
  fail-closed runtime gate (`ai::pipeline::PipelineTrace`), not only by
  review.** Most of the chain is already impossible to reorder, because
  each step's output is the next step's only possible input:
  snippets → redact → prompt → send is a compile error to get wrong. Two
  steps are not protected that way, and they are exactly the two a careless
  edit would drop: `permit::acquire` (the adapter re-acquires internally,
  so deleting the pipeline's early gate still compiles and still sends —
  losing only Section 12's "E_AI_DISABLED before any other work") and
  `transcript::record` (no downstream consumer at all). Every step records
  itself; `ensure_ready_to_send()` runs immediately before the provider
  call and refuses the request outright if the trace so far is not exactly
  `STEPS_BEFORE_SEND`, so a deleted step breaks the feature loudly on every
  real request instead of silently degrading the guarantee.
  `ensure_complete_and_ordered()` closes the same way before an answer is
  returned. A trace violation reuses `E_AI_PAYLOAD_UNSAFE`: it is the same
  family as R3's abort — the safety pipeline did not complete, so nothing
  is sent.
- **Phase 12 step 6 — the three commands funnel through ONE private helper
  (`commands::ai::run_ai_feature`), and candidate file lists are derived
  from the recorded analysis, never supplied by the caller.** The webview
  sends a `repoId`, a `moduleId` or a question — never a path list. Summary
  uses `importantFilePaths`, module explanation a module card's
  `keyFilePaths`, and Q&A `engine.search` hits in score order (falling back
  to `importantFilePaths` when a question matches nothing, so the model is
  grounded in real code rather than handed an empty payload it could only
  answer uncited — which Section 8.10 would then reject). Section 8.9 R4's
  "keep highest-ranked first, drop the tail" therefore operates on a
  genuinely ranked list. `AppState`'s `RepoSession` keeps three small
  PROJECTIONS of the analysis for this (`importantFilePaths`, module → key
  files, path → `lineCount`) rather than retaining the whole
  `AnalysisResult`; none of them is file CONTENT, which still only ever
  comes from `engine.snippets`. A `moduleId` absent from the analysis is
  refused with `E_INVALID_SETTINGS` before any egress (the closed
  `AppErrorCode` set has no better fit, and it matches how
  `validate_provider` reports a bad enum value). A question may be up to
  500 characters while the ranking search is capped at 200
  (`SEARCH_QUERY_MAX_LEN`), so the query is truncated for RANKING only —
  the full question still travels as the prompt's `subject`.
- **Phase 12 step 6 — the step-6 pipeline tests live in the lib's own
  `#[cfg(test)]` tree and resolve the stub sidecar from `current_exe()`
  instead of `CARGO_BIN_EXE_<name>`.** They need both the stub sidecar
  (normally an integration-test-only path) and
  `AiCommandContext::test_endpoint`, which — like every adapter's
  `with_test_endpoint` — is `#[cfg(test)]` and therefore absent from the
  library an integration test links against. Since `cargo test` builds
  every `[[bin]]`, `target/<profile>/onboard_engine_stub` sits exactly one
  directory above the unit-test binary in `deps/`; the helper asserts that
  file exists rather than silently skipping. The stub gained two toggles,
  `SNIPPET_SECRET` and `SNIPPET_BYTES`, so `engine.snippets` returns real
  text for the redaction and cap tests instead of the empty array it
  previously returned.
- **Phase 12 step 6 — `VerifiedAnswer` needed `#[derive(Debug)]` before the
  step's own RED tests could even compile.** The five tests written in the
  previous (interrupted) run use `unwrap_err()`/`expect()`, which require
  `T: Debug`, so `cargo build --tests` failed with 4x E0277 and those tests
  had never actually executed. Deriving `Debug` was the whole fix; the RED
  state was then verified for real (all five failing at `unimplemented!()`,
  not vacuously passing and not erroring for an unrelated reason) before
  any implementation was written. Recorded because a test that has never
  run is not evidence of anything — the same trap the compile-fail suites'
  specific-error-code assertions exist to avoid.
- **Phase 13 (finding H1) — a `[[path:line]]` token is illegitimate in the
  RAW answer, and the whole answer is rejected if one appears.** `[[path:line]]`
  is what §8.10 step 4 EMITS and what the UI PARSES, but nothing stopped the
  MODEL from writing one: it is neither a backtick span nor a well-formed
  `[text](target)` link, so `parse_span` returned `None`, the token was copied
  through verbatim, and it reached the UI never having been checked against the
  index. With a path cited legitimately elsewhere it passed the UI's
  `citedPaths` gate too and rendered as a real, clickable link to a line the
  file does not have — so step 3's whole-answer rejection was evadable purely
  by choice of delimiter, and strengthening (a) was bypassed entirely.
  Rejecting was chosen over verifying (which would make the verifier's output
  grammar also its input grammar — the exact confusion that caused this) and
  over neutralising (which still SHOWS a path nothing verified). The two
  grammars are kept disjoint, so the invariant is: every `[[…]]` token in the
  returned markdown was written by `verify_citations` after verification. The
  recogniser is deliberately WIDER than either real grammar, because a
  candidate-based rule would miss `[[src/ghost.txt:1]]` — `.txt` is not a
  §8.10 extension, so the candidate pattern never sees it, yet the UI would
  linkify it happily.
- **Phase 13 (finding H1) — the invariant is enforced twice, and each layer
  has its own direct test.** `reject_forged_tokens` is the rule;
  `ensure_every_token_was_emitted` re-derives the property from the FINISHED
  buffer, so a future rewrite of the scanning loop has to defeat a
  post-condition stated in terms of the invariant itself rather than in terms
  of any parsing step. A mutation probe confirmed the layers are independently
  sufficient — disabling the rule left all 27 tests green, because the
  post-condition caught every forgery alone. That is the redundancy working,
  but it also meant deleting the rule outright would have failed nothing: the
  post-condition had a direct unit test and the rule did not. Both do now.
  Redundant layers each need their own test, or the redundancy silently decays
  to a single layer while still looking like two.
- **Phase 13 (finding M4) — §8.9 R2 gains rules 13-15 by APPENDING, and rule
  12 gains a third delimiter.** Rules 1-12 keep their numbers, regexes and
  relative order, because R2 is an ordered list and order is load-bearing:
  `Authorization: Bearer eyJ…` must still be caught by rule 9 (JWT) rather
  than by the new auth-header rule, which a prepend would have silently
  changed. Rule 12's backtick-template-literal support is inside its existing
  "quoted string" wording, not a renumbering. The corpus grew 30 -> 37 planted
  secrets while `NEGATIVE_CONTROLS` stays at exactly 5, all still surviving
  byte-identical. Note the corpus proves the shapes it contains are caught; it
  is not a proof of completeness, and R3 idempotence is not coverage.
- **Phase 13 (finding M5) — the egress chokepoint checker refuses dependency
  tables it cannot parse, rather than skipping them.** Its manifest scan was
  evadable by `[dependencies.ureq]` or `[target.'cfg(...)'.dependencies]`
  headers, its source scan by `use reqwest as h;`, and neither `std::net` nor
  `std::process::Command` was on any list. An unrecognised dependency-table
  shape is now a violation, on the grounds that a checker which silently skips
  what it does not understand is worse than no checker — it reports OK. The
  new process/socket allowlist is per-file AND per-symbol, and a test fails if
  an allowlist entry stops matching anything, so reviewed-door permissions
  cannot accumulate past the code that justified them.
- **Phase 13 follow-up — the `openai-compatible` adapter is deleted, not
  deprecated: it was a scope violation, not a feature.** A4 says "v1 ships
  exactly **two AI adapters: Anthropic and Ollama**"; Section 3 non-goal 2
  names "DeepSeek, OpenAI, Azure, Bedrock, or any adapter beyond Anthropic and
  Ollama" and prescribes the response — "If you find yourself writing one,
  stop and delete it." A third adapter was nevertheless built and shipped.

  **How it got built, since that determines whether anything else drifted.**
  The phase spec did *not* drift. Phase 12's Files list names exactly
  `src-tauri/src/ai/{mod.rs,provider.rs,anthropic.rs,ollama.rs,http.rs,`
  `prompt.rs,transcript.rs}` — there is no `openai_compatible.rs` in it, and
  the word "openai" appears nowhere in the phase text. The drift was a
  self-invented sub-step: entries in this file recorded under "Phase 12 step
  3B" introduced the adapter, switched `AiProvider`'s serde representation
  from `lowercase` to `kebab-case` to accommodate its name, and added the
  `openai_compatible_base_url` setting — each entry reasoned carefully about
  its own local trade-off, and none checked the new module against A4 or the
  non-goal list. The `settings-schema.ts` doc comment then hardened the error
  into an assertion, calling them "the three v1 adapters."

  This is the same failure mode as the vacuous bench gate fixed alongside it:
  a local decision recorded thoroughly enough to look reviewed, never checked
  against the frozen constraint it violated. The generalisable rule is that a
  DECISIONS entry justifies *how* something was built and can never authorise
  *that* it be built — only Sections 2 and 3 do that.

  **Scope of the removal.** The adapter module, `AiProvider::OpenAiCompatible`
  (Rust) and the `'openai-compatible'` zod literal (TS), the
  `ProviderShape::OpenAiCompatible` body shape, the `openaiCompatibleBaseUrl`
  setting on both sides, its Settings-dialog field and copy strings, its
  keychain account, its `validate_provider` acceptance, and every test
  asserting the adapter worked. `privacy/patterns.rs`'s `OPENAI_KEY_RE` stays:
  it is Section 8.9 rule 7, a *redaction* rule for OpenAI keys found in the
  user's own repo, and is unrelated to which providers Onboard talks to.

  **Deletions replaced by guards, not by silence.** `validate_provider` now
  has a test asserting `openai-compatible`, `openai`, `deepseek`, `azure`,
  `bedrock`, `groq` and `openrouter` are all rejected, and the Settings
  dropdown test asserts the option list is exactly `['Anthropic',
  'Ollama (local)']` rather than merely containing them — so re-adding an
  out-of-scope adapter fails a test instead of shipping.

  **Migration is fail-safe by construction.** An old `settings.json` carrying
  `openaiCompatibleBaseUrl` still loads (serde ignores unknown fields). One
  pinned to `provider: "openai-compatible"` no longer deserializes, so
  `read_settings_file` falls back to `Settings::default()` — which has
  `isEnabled: false`. The one outcome that must never happen is continuing to
  send snippets to a provider that no longer exists; both paths are tested.
- **AMENDMENT — Rust floor raised 1.82 -> 1.85 to delete the crate's only
  `unsafe`.**
  Authorised-by: product owner (chat), 2026-07-28
  Departs-from: Section 4 — "Rust 1.82+"

  `src-tauri` contained three `unsafe` blocks: `unsafe { Waker::from_raw(
  noop_raw_waker()) }` in `ai/anthropic.rs`, `ai/ollama.rs` and
  `commands/ai.rs`. They were not three uses of a shared helper — they were
  the same hand-rolled no-op `RawWakerVTable`, copied verbatim into three
  modules, with the second and third SAFETY comments citing the first rather
  than restating the invariant. That citation reads as a convention and is
  actually an admission of the duplication: the same shape as the
  hand-rolled newline reader in `engine-rpc-client.ts`, this time in unsafe
  code.

  `Waker::noop()` makes all three unnecessary. Verified from the local
  toolchain's own source rather than from memory —
  `library/core/src/task/wake.rs:565` carries
  `#[stable(feature = "noop_waker", since = "1.85.0")]`. Raising the floor
  from 1.82 to 1.85 therefore trades a three-minor-version bump for the
  removal of every `unsafe` block in the crate, plus ~30 lines of vtable
  boilerplate and three imports.

  Cost accepted: the floor is a declaration, not a build pin (see the CI
  workflow's note — cargo enforces it by refusing to build with an older
  toolchain), and 1.85 shipped in February 2025. Nothing in this repository
  pins an older toolchain; the dev machine runs 1.97.1.

  Consequence for the Windows DACL work that prompted this: the entry that
  work needs is now accurate. It introduces the FIRST `unsafe` in the crate,
  not the fourth — and the first in a shipped code path either way, since
  all three deleted blocks were `#[cfg(test)]` and could never appear in a
  release binary.
- **AMENDMENT — ESLint 9.39 -> 10.8 so the `brace-expansion` advisory can be
  closed without breaking the linter.**
  Authorised-by: product owner (chat), 2026-07-29
  Departs-from: Phase 0 entry above — "ESLint `~9.39.0` + `@eslint/js` `~9.39.0`"

  The `overrides` entry `"brace-expansion": ">=5.0.8"` closes
  GHSA-mh99-v99m-4gvg (high; DoS via unbounded expansion). The advisory has ONE
  vulnerable range (`<= 5.0.7`) and ONE patched version (`5.0.8`) — confirmed
  against `gh api /advisories/GHSA-mh99-v99m-4gvg`, not from memory, because it
  is easily mistaken for the June-2025 ReDoS that did have per-line fixes.
  There is therefore no patched v1 or v2 line to pin per-branch.

  Under ESLint 9, `@eslint/config-array@0.21.2` required `minimatch@^3.1.2`,
  and minimatch 3 consumes brace-expansion as `module.exports = expand`. v5
  changed that export shape, so the override made ESLint crash with `TypeError:
  expand is not a function` on every clean install, on every platform. That is
  why `verify` had never once reached its own test stage in CI.

  ESLint 10's `@eslint/config-array@0.23.5` requires `minimatch@^10.2.4`, which
  requires `brace-expansion@^5.0.5` — the patched line. The conflict disappears
  at the root rather than being worked around.

  Correction to the working assumption this decision started from: the upgrade
  alone does NOT close the advisory, and the override is NOT removable. With
  ESLint 10 and no override, the resolved tree still contains
  `brace-expansion@1.1.16` and `@2.1.3`, reached by `recursive-readdir` ->
  `minimatch@3`, `mocha`/`glob@8` -> `minimatch@5`, and
  `@typescript-eslint/typescript-estree`/`glob@10` -> `minimatch@9`; `bun audit`
  reports 9 vulnerable paths. The correct configuration is ESLint 10 **and** the
  override retained. Verified by inspecting the resolved tree, not by trusting
  an exit code: after `rm -rf node_modules && bun install`, the entire tree
  contains exactly one copy of the package, `brace-expansion@5.0.8`.

  Cost accepted: one new lint error, from `no-useless-assignment` entering
  `eslint:recommended` in v10. It was a true positive — a dead `''` initializer
  on `member` in `packages/engine/src/graph/tarjan-scc.ts`, assigned by the
  do-while body before any read. Fixed rather than suppressed. No plugin
  upgrade was entangled: `typescript-eslint@8.65.0`, already pinned, declares
  `eslint: ^8.57.0 || ^9.0.0 || ^10.0.0`. `@eslint/js` tracks its own version
  line and moves to `~10.0.1`, not `~10.8.0`.

  Consequence: `bun run verify` now passes all seven stages on a wiped
  `node_modules` with `--frozen-lockfile`. That is the first green run in this
  repository that a clean checkout reproduces — see `docs/SECURITY_AUDIT.md`
  §6 on why every earlier one is attested but unverified.
- **Phase 13 follow-up — `analyze()` may not be called concurrently in one
  process. Found by accident, recorded before it can bite.**

  A test that analysed the same fixture from two temp paths with `Promise.all`
  produced results disagreeing on `edges`, `symbolCount`, `pageRank`,
  `inDegree`/`outDegree`, `diagnostics` and `graph.componentCount` — 107
  differing leaves. Run the identical two analyses SEQUENTIALLY and they differ
  in exactly three: `repo.id`, `repo.rootPathHash`, `fingerprint`. So the
  divergence is overlap, not location.

  Not currently reachable, and that is luck rather than design:
  `rpc/server.ts`'s `for await (const rawLine of options.lines)` awaits each
  request before reading the next, so the sidecar can never have two `analyze()`
  calls in flight. Nothing states that this serialization is load-bearing, and
  "handle requests concurrently for throughput" is an obvious future change.

  `verify:determinism` cannot catch this: all four of its comparisons run
  sequentially, which is exactly the case that works.

  Not fixed here — the shared state has not been located, and guessing at it is
  worse than recording it. What IS fixed is the invisibility: the constraint is
  written at `rpc/server.ts`'s loop, in
  `test/analyze/snapshot-identity.test.ts`, and here. Queued for `ts-engine`:
  find the shared mutable state (tree-sitter parser instances are the first
  suspect), then either make it re-entrant or make the serialization explicit
  and asserted rather than incidental.
- **Phase 13 follow-up — A9's "one runner cross-compiles every target" holds on
  Linux ONLY. Phase 14's release job must produce sidecars on Linux.**

  `build-sidecar.ts` cross-compiles four triples through
  `Bun.build({ compile: { target } })`. On ubuntu-22.04 all four succeed. On
  windows-2022 it fails, identically, on three consecutive runs:

  ```
  built onboard-engine-x86_64-pc-windows-msvc.exe     <- host target fine
  error: Failed to extract executable for 'bun-darwin-aarch64-v1.3.14'
  ```

  Bun downloads and unpacks a per-target executable to compile against; the
  darwin ones do not extract on a Windows runner. The Windows target itself
  builds fine, so this is not a Bun-on-Windows problem in general.

  **Where it was actually biting was avoidable.** The `rust` job built all four
  and needed exactly one: Tauri resolves `externalBin: ["binaries/onboard-engine"]`
  to the HOST target triple, and `stage:sidecar` fails only when ZERO binaries
  are found. So clippy and `cargo test` on windows-2022 were being blocked by
  three binaries they never open. That job now runs `build:sidecar --host-only`
  and the failure disappears without moving any work.

  **The claim itself is not dropped.** The four-triple build moves to
  `engine-no-network` on ubuntu, which is now the single place A9 is exercised,
  and `build:sidecar` fails if any of the four filenames is missing.

  **Consequence for Phase 14, recorded now rather than at packaging time:**
  the release job that produces sidecars must run on Linux. A Windows or macOS
  release runner cannot produce the darwin binaries. If a future change needs
  per-OS release runners for the Tauri bundles themselves (`.msi` genuinely
  needs Windows), the sidecars must still be built once on Linux and passed
  between jobs as artifacts — not rebuilt per runner.

  **Still unproven, and not addressed by any of the above:** nothing has
  executed a darwin sidecar on macOS. A runner PRODUCING a binary is not a
  runner RUNNING it. `build:sidecar`'s smoke test only ever launches the HOST
  binary, so on ubuntu the two darwin outputs are checked for existence and
  nothing else. Criterion 23 stays not-CI-evidenced (see
  `docs/CRITERIA_MAP.md`), and `docs/MACOS_SMOKE.md` remains the only path to
  retiring it.
- **CROSS-DOMAIN — the engine's no-overlap requirement was held by the Rust
  shell being accidentally stricter than the spec. Now enforced on both sides.**
  Domains: `ts-engine` (owns the constraint), `rust-tauri` (was silently
  satisfying it), spec Section 7.4 / Phase 6 (permits the violation).

  **Reachability: NOT reachable today. Settled by reading, not assumed.**
  Spec Phase 6 says "one analysis at a time PER REPO (`E_ANALYSIS_IN_PROGRESS`)",
  which would permit two repositories to analyse concurrently. The
  implementation does not do that:
  `apps/desktop/src-tauri/src/sidecar/supervisor.rs` keeps a single
  `analysis_in_progress: bool` on `State`, and `begin_analysis()` takes NO
  repository argument — it rejects any second concurrent analysis whatever it
  targets. There is exactly one `SidecarSupervisor`, owned by the single
  `AppState` built in `lib.rs`, and exactly one production call site for
  `engine.analyze` (`commands/analyze.rs:94`), which acquires the guard on the
  line before and holds it by RAII across the whole call.

  So the shell CANNOT currently issue overlapping analyses for different
  repoIds. **The product is safe because it does not implement its own spec.**
  That is a weaker guarantee than it looks: the defect is one faithful
  "implement Phase 6 as written" refactor away, and that refactor would look
  like a bug fix.

  **What overlap actually costs**, measured: identical fixture content analysed
  concurrently from two paths disagreed on `edges`, `symbolCount`, `pageRank`,
  `inDegree`/`outDegree`, `diagnostics` and `graph.componentCount` — 107
  differing leaves. Sequentially: 3, all path-derived. This is the product's
  core determinism guarantee, and `verify:determinism` cannot see it because all
  four of its comparisons are sequential.

  **Both sides now state the property instead of relying on the other.**
  - `packages/engine/src/analyze.ts` refuses a re-entrant `analyze()` with
    `E_ANALYSIS_IN_PROGRESS` — the same code the shell returns, so Section 10's
    copy is identical whichever layer refuses. Guarded with `try/finally`, so a
    failed analysis does not wedge the process.
  - `packages/engine/test/analyze/no-overlap.test.ts` fails if someone makes
    `analyze()` re-entrant without fixing the shared state, and separately
    proves the guard RELEASES — both after success and after failure, which a
    `try` without `finally` would pass every other test while breaking.
  - `apps/desktop/src-tauri/tests/sidecar_supervisor.rs`'s
    `the_analysis_guard_is_process_wide_not_per_repo` binds `begin_analysis` to
    a function pointer of the exact expected type, so adding a repo parameter
    fails to COMPILE rather than silently re-opening the defect.

  **Still open, and deliberately not guessed at:** the shared mutable state has
  not been located. Tree-sitter parser instances in `packages/engine/src/parse/`
  are the first suspect. Until then the constraint is enforced, not removed —
  the engine refuses concurrency rather than supporting it. Queued for
  `ts-engine`.

  **Spec disposition:** Section 7.4's table and Phase 6's prose say "per repo".
  The code says per process. The code is right and the spec should be amended
  when Section 7.4 is next revised; recorded here rather than editing a FROZEN
  section unilaterally.
- **Phase 13 follow-up — the concurrency defect's ROOT CAUSE, located and fixed:
  per-loader memoization of a process-global initialization.**

  The previous cross-domain entry recorded that two overlapping `analyze()`
  calls disagree on 107 leaves and that the shared state had not been found.
  It has. It was not the parser pool — that is clean, and its factory,
  concurrency counter and result array are all per-call.

  `parse/grammar-loader.ts` did this:

  ```ts
  export function createGrammarLoader(grammarsDir: string): GrammarLoader {
    let initPromise: Promise<void> | null = null;   // <- per LOADER
    ...
    initPromise ??= Bun.file(TREE_SITTER_WASM_PATH).arrayBuffer()
      .then((wasmBinary) => Parser.init({ wasmBinary }));
  ```

  `Parser` is a module singleton over ONE Emscripten WASM runtime, so
  `Parser.init()` initializes shared global state. Memoizing it per loader is
  the bug: the memo is correctly scoped for the `Language` cache beside it,
  which genuinely depends on `grammarsDir`, and wrong for this, which does not.
  Two loaders created concurrently each called it, the second re-initialized
  the runtime while the first's `Language.load()` was in flight, and the
  language came back as version 0:

  ```
  Incompatible language version 0. Compatibility range 13 through 15
  ```

  Every file in the losing run then failed to parse. Zero symbols, zero
  imports, so zero edges, so a different `componentCount`, different pageRank,
  different `importanceRank`, and a longer `diagnostics` array — the exact 107
  leaves, all downstream of one failure.

  **Why every existing test missed it.** The defect is invisible once anything
  has warmed the runtime, and every test in this repository runs sequentially,
  so by the second run the global is already initialized. The first probe
  written for this even missed it by warming up first. The load-bearing word in
  `test/parse/parse-concurrency.test.ts` is COLD.

  **Fix:** hoist the init promise to module scope. Bounded, as hoped.
  **Measured after:** two concurrent `analyze()` calls now differ in 3 leaves —
  `fingerprint`, `repo.id`, `repo.rootPathHash` — which is exactly what two
  SEQUENTIAL runs from different paths differ by. 107 -> 3.

  **The `analyze()` re-entrancy guard is kept anyway.** What is demonstrated is
  that one known global was wrong and is now right, not that the engine is
  re-entrant: the SQLite cache store and the no-network guard also hold
  process-scoped state and nothing has exercised them under overlap. Refusing
  costs nothing while the Rust shell serializes analyses regardless.

  **Shape worth noting.** `grammar-loader.ts`'s own header already documented an
  earlier `Parser.init()` defect, where a compiled binary's WASM lookup failed
  with ENOENT and — in that module's words — "silently degrad[ed] every parse to
  `PARSE_FAILED` rather than throwing". Same function, same silent degradation
  to an empty-but-well-formed result, second time. That is the same fail-open
  family as INV-3, and it is why the fix ships with a test rather than a
  comment.
- **Phase 13 follow-up — criterion 28's gate is wired, and pre-merge history
  predates it.**

  `scripts/commit-message-check.py` enforces `<type>: <description>` over the
  commits a branch adds, and runs as its own CI job. The type set is recorded in
  the script rather than assumed, because Section 13 #28 does not enumerate one.

  **One subject on `phase13/gate-evidence` fails it:** `ci,docs: build only the
  sidecar a job uses...`. `<type>` is one type; a comma-joined pair is two, and
  the gate is right to reject it.

  It is NOT rewritten. Reworking nine commits and force-pushing to an open PR to
  clear one subject is disproportionate, and this branch squash-merges — so its
  subjects never land on `main` and the gate is clean from the merge commit
  onward. Product owner's call, 2026-07-29.

  Recorded here for one reason: a future reader running `commit:check` against
  the pre-merge branch will see it fail, and should know that is history
  predating the gate rather than the gate being broken. Anything authored after
  the merge has no such excuse.
- **AMENDMENT — Linux ships `.deb` + `.rpm`, not `.AppImage` + `.deb`.**
  Authorised-by: product owner (chat), 2026-07-29
  Departs-from: Section 13 #23 — "`.AppImage` + `.deb`"

  Two departures, recorded separately because they have different causes.

  **`.AppImage` is NOT shipped — it does not build.** Tauri bundles it through
  `linuxdeploy`, which fails on a GitHub runner:

  ```
  Bundling Onboard_0.1.0_amd64.AppImage
  failed to bundle project `failed to run linuxdeploy`
  ```

  Measured with `libfuse2` installed AND `APPIMAGE_EXTRACT_AND_RUN=1` set — both
  applied, same failure — so it is specific to the AppImage path rather than to
  FUSE availability. `.deb` and `.rpm` bundle cleanly in the same run. Shipping a
  format that has never been produced is precisely what the macOS hold exists to
  prevent, and the same rule applies here.

  **`.rpm` IS shipped, and Section 13 does not name it.** Tauri produces it from
  the same bundle step at no extra cost, and it covers the Fedora/RHEL half of
  Linux that a `.deb` alone does not. Adding a format the spec omits is still a
  departure, and going unrecorded is how a criteria map starts describing
  something other than what ships.

  **Why this is an AMENDMENT and not just a KNOWN_ISSUES line.** KI-9 records the
  DEFECT — that the AppImage build fails. This records the DECISION — that the
  release ships a different set of formats than the spec names. They are
  different claims: one could be fixed tomorrow without changing the other, and
  a reader checking criterion 23 against the spec needs the second, not the
  first. KNOWN_ISSUES is where defects go; this file is where departures go.

  **Consequence for criterion 23:** its text is now "`.deb` + `.rpm`" on Linux.
  The `.AppImage` returns to scope if the `linuxdeploy` failure is resolved, at
  which point this amendment is superseded rather than deleted.

- **AMENDMENT — Section 10 gains an `E_ENGINE_NOT_STARTED` row; the engine
  failing to START is not the engine CRASHING.**

  Section 10's error table had rows for a sidecar that dies mid-analysis
  (`E_ENGINE_CRASHED`) and one that hangs (`E_ENGINE_TIMEOUT`), but none for a
  sidecar that was never spawned at all. `spawn_sidecar` therefore reported the
  nearest available code, and the v0.1.0 Windows `.msi` shipped this to a user
  on a clean machine:

  ```
  Analysis stopped unexpectedly
  Failed to start the analysis engine process: The system cannot find the
  path specified. (os error 3)
  ```

  Two defects in one string. The **code is false**, not merely imprecise: it
  points the reader at a crash log for a process that never existed, and at a
  Retry that cannot help, because the install is broken rather than the run.
  And the **body is a raw OS error**, which Section 12 forbids — OS strings
  belong in `detail`, behind the Details disclosure.

  The new row's copy, frozen here and asserted byte-exact in both
  `copy/messages.test.ts` and `error.rs`:

  > **Onboard could not start its analysis engine**
  > The analysis engine is missing from this installation, so nothing was
  > analyzed. Reinstalling Onboard should restore it. The log is at {logPath}.

  It deliberately offers no Retry framing, which is the substantive difference
  from `E_ENGINE_CRASHED` rather than a stylistic one.

  **Why this is an AMENDMENT and not just a KNOWN_ISSUES line.** The packaging
  bug that produced it is a defect and belongs there. That Section 10's table
  was *missing a state the product can actually be in* is a spec gap, and the
  new code is a departure from the frozen table. A reader checking criterion 19
  against the spec needs to find the row.

  **Consequence:** `SidecarConfig::program` became `Option<PathBuf>` so
  "unresolved" is representable. The previous code constructed a path that
  existed nowhere and let the OS explain it — which is how the raw string
  reached the UI in the first place.

- **AMENDMENT — never read-modify-write a tracked file through a shell.**

  `Section 7` of `docs/SESSION_HANDOFF.md` already said to prefer Python
  scripts over shell one-liners for anything touching Rust string literals.
  This widens it, because the failure recurred twice in one session on files
  that contained no string literals at all.

  The specific idiom, which looks harmless and is not:

  ```powershell
  (Get-Content $f -Raw) -replace 'a','b' | Set-Content $f -Encoding utf8
  ```

  `Get-Content -Raw` decodes with the console's default encoding, not UTF-8.
  On this machine that reads every UTF-8 em-dash as three cp1252 characters,
  and `Set-Content -Encoding utf8` then writes those three characters back as
  UTF-8 — double-encoding the file. Seven source files lost 77 runs of text
  this way; `Cargo.toml` lost 6 more an hour later, to the same idiom, after
  the first repair.

  **Both were caught by byte-exact assertions**, not by review: the Section 10
  copy comparison in `tests/sidecar_supervisor.rs` failed on a corrupted
  em-dash, which is the third time this session an escaping layer has cost
  real time. A test asserting "an error rendered" would have shipped it.

  **The rule:** edit tracked files with a real editor tool, or with Python
  reading and writing `encoding="utf-8"` explicitly. Never with a shell
  read-modify-write. Detect with `grep -c 'â€'` — clean text never contains
  that sequence, so it is a reliable canary. Note that a PowerShell console
  DISPLAYING mojibake proves nothing; only a content search does.

- **AMENDMENT — criterion 28's gate is scoped to commits after the gate landed,
  and the squash-merge decision is RETRACTED.**

  Two changes, recorded together because the second is what makes the first
  load-bearing.

  **The scope.** `commit:check` now examines every commit after `a203731` — the
  commit that ADDED `scripts/commit-message-check.py` — with no exceptions list.

  The justification is not "some commits fail". It is that **a commit-message
  linter cannot retroactively govern history that predates it**: before that
  commit there was no check to run, so no author could have conformed to it, and
  failing them is not enforcement but a permanently red job that reports rather
  than holds. The test for whether a scope is principled or merely convenient is
  *would we choose it if history were already clean?* — and the answer here is
  yes, because a linter's authority begins when the linter exists.

  Two facts show the boundary was not reverse-engineered from the current
  failure, which is the trap this kind of change usually falls into:

  1. **It did not clear the red at the time.** A commit with a 103-character
     subject POSTDATED the boundary, was in scope, and still failed. (It was
     cited here by hash until 2026-09-08, when a history rewrite removed that
     commit from this repository; the hash resolves in no surviving map, so it
     is described rather than left dead.) A boundary chosen to
     make the job green would have been placed after it.
  2. **The other candidate boundary changes nothing.** The gate could have been
     dated from where CI began running it (`8c0b1b2`, two commits later)
     instead. The earlier is correct — the obligation begins when an author can
     run the check, not when someone else starts enforcing it — but either
     choice yields the same result today.

  `commit:check --all-history` keeps the full picture available. It is
  INFORMATIONAL and wired to nothing; it currently reports three non-conforming
  subjects, of which two predate the gate.

  Non-vacuity, as everywhere: `scope_self_test` builds a throwaway repository
  with a non-conforming subject on each side of a boundary and asserts the
  split in both directions. A matcher-only test would pass equally on a scope
  bug that examined zero commits or every commit.

  **The retraction.** This PR was previously authorised to squash-merge, and the
  criterion-28 job's own comment leaned on that: the branch's subjects would
  never reach `main`. **That is withdrawn.** `docs:check` now requires every SHA
  cited in `docs/` to resolve, and `DECISIONS.md` cites branch SHAs. A squash
  collapses those commits; once the branch is deleted the citations dangle and
  `docs:check` fails on `main` — a gate breaking a gate. **The PR merges with a
  merge commit, history preserved.**

  The general shape is worth keeping: a merge strategy is not only a history
  preference once something else in the repository depends on the commits being
  reachable.

- **AMENDMENT — the mode-indicator emoji are removed from BOTH strings; A6's
  frozen text is departed from.**

  ```
  Authorised-by: product owner (chat), 2026-07-31
  Departs-from: Assumption A6 — "🔒 Static mode · no network · nothing leaves
    this machine" and "☁️ AI mode · <provider>/<model> · snippets sent to
    <provider>"
  ```

  **Reason.** An emoji in a production UI reads as unfinished, and this build is
  about to be public.

  **Both strings, not one.** One indicator with an emoji and one without would
  be worse than either — the pair is what makes the mode legible at a glance, so
  a later edit restoring the prefix to only one of them is a regression even
  though each string would individually look fine. That is written into
  `MODE_INDICATOR`'s comment because the next person to touch this will be
  looking at one string, not two.

  **The signal moves rather than disappearing.** `ModeIndicator` now renders a
  padlock or a cloud beside the text. Three things about that are deliberate:

  1. **Inline SVG, not an icon package.** `lucide-react` was proposed on the
     understanding that it was already a dependency. It is **not** — it is
     absent from `apps/desktop/package.json` and from `node_modules`, and
     nothing in `src` rendered an icon or an SVG before this change. Using it
     would have meant a new runtime dependency, a lockfile change and a new
     `bun audit` surface on a release branch, for two glyphs. The paths are
     drawn in the component, so no third-party licence or attribution attaches.
  2. **The glyph is `aria-hidden` and outside the string.** The indicator's
     accessible name must remain exactly the frozen text, or a screen reader
     announces "lock Static mode …" and criteria 13/14 stop meaning what they
     say. The byte-exact assertions therefore still test one thing.
  3. **SVG is the platform-consistent choice**, which was the point: an emoji
     renders differently on every OS and font stack, which is part of why it
     read as unfinished.

  **What this leaves inconsistent, stated rather than hidden.** The spec under
  `prompts/` is frozen and is not edited — it has been touched by exactly one
  commit, the Phase 0 scaffold. `docs/CRITERIA_MAP.md` PARSES criterion text
  from it, so criteria 13 and 14 still display the emoji-prefixed strings while
  the code ships without them. That divergence is real and is reconciled here
  and in those rows' evidence notes, not by rewriting the spec.

  **A recorded observation was invalidated by this.** The 2026-07-31 Windows
  smoke run confirmed the indicator byte-exact hours before this decision. That
  row is marked SUPERSEDED in `docs/SMOKE_CHECKLIST.md` rather than edited —
  the table's rule is that rows are added, not rewritten, and the run genuinely
  happened. It is no longer current evidence for 13 or 14, which now rest on the
  automated assertions until a fresh run against an emoji-free build is
  recorded.

- **INVALIDATES — "the installed layout is asserted by SET EQUALITY on both
  platforms" was false, and criterion 23 half (a) was marked EXECUTED on it.**

  Filed as INVALIDATES rather than AMENDMENT because it does not revise a
  decision — it **voids a status claim that was acted on**. The product owner
  marked criterion 23's half (a) EXECUTED partly on an install-jobs report
  containing that sentence. Neither platform did what it said.

  **What is actually asserted**, read from the code rather than its docstring:

  | Platform | Claimed | Actual |
  |---|---|---|
  | Windows | set equality on the installed layout | set equality over `*.exe` in the install root only |
  | Linux | set equality on the installed layout | two-name banned-list scan over `dpkg -L` |

  On Linux the function was named `check_deb_manifest` and its docstring read
  *"Set equality over what the .deb declares it installs."* The body iterates
  the file list and flags a basename in `banned = {"onboard_engine_stub",
  "check_egress_chokepoint"}`. There is no expected set anywhere in it. On
  Windows the assertion is real but globs `*.exe`, so icons, `resources/
  grammars/*.wasm` and DLLs are outside it on **both** platforms.

  **How it propagated, which is the part worth keeping.** The docstring did not
  sit inertly in a file nobody read. It was the source for a comment in
  `.github/workflows/release.yml`, and both were the source for a verbal
  install-jobs report, and that report reached a criterion status. Three
  restatements, each one dropping the qualifier the layer below never had. This
  is the same shape as KI-8's catalogue-is-not-a-disposition finding: **a
  written claim about a guard is not evidence about the guard**, and the further
  it travels from the code the more authoritative it sounds.

  Found incidentally, while checking whether regenerating the Tauri icon set
  would break the installed-file assertion. It would not — icons are outside
  both checks' scope, which is how the gap surfaced at all. Nobody was auditing
  this.

  **Corrected this change (honesty only):** `check_deb_manifest` renamed to
  `check_deb_banned_binaries`; `check_shipped_executables` renamed to
  `check_shipped_exe_set_equality`; both docstrings, the module docstring, the
  `release.yml` comment, and the runtime `layout OK` line — which printed
  "(set equality)" on both platforms — now state the per-platform scope.

  **Deliberately NOT corrected this change:** the assertions themselves. Real
  set equality on both platforms is queued as a work item in
  `docs/SESSION_HANDOFF.md`. Strengthening a release gate in the same change
  that cuts a release produces a red that cannot be attributed — is the package
  wrong, or is the newly-strict check wrong? — and the answer would arrive
  during a release rather than before one. The honesty fix carries zero such
  risk, which is why the two are split rather than deferred together.

  **Status consequence.** Criterion 23 half (a) is not re-opened: the claims it
  actually rests on — the installed shell starts, logs `sidecar resolved:`, and
  the installed engine analyses a real repo returning symbols=2, edges=1 — were
  independently observed green on Windows and Linux and are untouched by this.
  What is withdrawn is the *layout* half of the evidence, which was weaker than
  reported. The status stands on narrower ground, and the ground is now written
  down.

- **AMENDMENT — Windows ships `setup.exe` only; the `.msi` is dropped.**
  Authorised-by: product owner (chat), 2026-08-03
  Departs-from: Section 13 #23 — "`.exe` + `.msi`"

  Two departures again, and again with different causes. Only the first is a
  format change; the second is the reason it went this way rather than the
  other way.

  **The `.msi` is NOT shipped.** Windows carried two installers doing one job,
  each with its own dialog artwork needing its own branding, and the choice
  between them was presented to users as two filenames whose difference they
  could not see. One format removes a surface instead of patching one.

  **NSIS was kept over WiX for a CAPABILITY, not for artwork.** This is the
  part worth reading, because the decision was very nearly made the other way
  on a premise that turned out to be false:

  | | NSIS `setup.exe` | WiX `.msi` |
  |---|---|---|
  | install mode | `currentUser` -> `%LOCALAPPDATA%\Onboard` | `perMachine` -> `C:\Program Files\Onboard` |
  | elevation | none | UAC required |
  | uninstall registry hive | HKCU | HKLM |

  Onboard is a per-user application — the API key is keychain-scoped to one
  account, the cache is per-user — and its users run it against proprietary
  code, frequently on managed laptops where local administrator rights are not
  granted. On such a machine the `.msi` is not "less convenient", it is
  **uninstallable**. `WixConfig` exposes no install-scope key, so an MSI-only
  Windows would have been an admin-only Windows permanently, short of a
  hand-written `.wxs` template.

  **The false premise, recorded because it is the more useful half.** The
  proposal was to keep the `.msi` on the grounds that it was "correctly branded
  already, and needs no new image assets". It was not. `WixConfig.bannerPath`
  and `WixConfig.dialogImagePath` were both unset, so the generated `main.wxs`
  contained no `WixVariable` override and the MSI's welcome and exit dialogs
  rendered WiX's stock artwork — a dark panel with a maroon CD-disc motif,
  extracted from `WixUIExtension.dll`'s embedded `ui.wixlib` and rendered to
  confirm, because **nobody had ever seen those screens**. Dropping NSIS would
  have traded a default that had been noticed for a default that had not.

  That is the third instance of one failure in this area: a surface declared
  complete from a search that found what it was looking for and stopped. First
  "no separate installer branding asset exists" (`installerIcon` did). Then
  "`installerIcon` is fixed, the surface is closed" (`headerImage` and
  `sidebarImage` were not). Then "the `.msi` is correctly branded" (its two
  image keys were at defaults). The correction is procedural, not factual:
  enumerate from the bundler's own option list — `NsisConfig`, `WixConfig`,
  `WindowsConfig`, `BundleConfig` — and read the GENERATED `installer.nsi` and
  `main.wxs` to see what each option resolved to. A grep is not an enumeration.

  **The named cost, deferred rather than lost.** The `.msi` was the
  enterprise-deployable format: Group Policy, Intune, SCCM, `msiexec /qn`, and
  transforms. Nothing NSIS offers replaces that for an administrator pushing
  Onboard to a fleet. Recorded in `docs/V2_BACKLOG.md` under "Managed
  deployment", with the constraint that put it there, so it is a scope boundary
  rather than a thing that quietly stopped existing.

  **What changed in the gate, and the order it changed in.** `installed-windows`
  drove the `.msi` — the artefact nobody ran interactively — while every manual
  Windows observation on record was made against `setup.exe`. So CI gated the
  format users did not execute, and the format they did execute was ungated.
  The job was repointed at `setup.exe` and **observed green before** the `.msi`
  was removed, deliberately: there is no commit on this branch where the Windows
  install path has no gate. Enumeration moved after the install as a result —
  `msiexec /a` could read a file table without installing, and NSIS has no
  equivalent, because an NSIS installer is a program rather than a manifest.

  **What was NOT done, and is a choice rather than an omission.** The installer
  artwork places the existing mark on a white field at the two sizes NSIS asks
  for (`scripts/make-installer-art.py`). There is no wordmark, no typography, no
  illustration. Anything beyond "the mark on a field" is design work for a
  designer, and a default we chose is fine where a default we did not notice is
  not — which is the whole subject of this entry.

  **`bundle.upgradeCode` becomes moot, confirmed rather than assumed.** It is a
  `WixConfig` field and has no NSIS equivalent; NSIS derives its uninstall
  registry key from `PRODUCTNAME` alone (`!define UNINSTKEY
  "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"`), so the
  `publisher` change below does not move it. What DOES move is `MANUPRODUCTKEY`
  (`Software\<MANUFACTURER>\Onboard`), which holds the installer-language
  preference and shortcut bookkeeping — those reset once, and upgrade detection
  is unaffected.

  **Consequence for criterion 23:** its Windows text is now `.exe` only. The
  `.msi` returns to scope only through the V2_BACKLOG item, at which point this
  amendment is superseded rather than deleted.

- **AMENDMENT — the installer's empty metadata is filled in; "onboard" in
  Add/Remove Programs was a default nobody chose.**
  Authorised-by: product owner (chat), 2026-08-03
  Departs-from: nothing in the spec — these fields were never specified

  Filed as an amendment anyway, because it changes strings a user reads.
  Enumerating `BundleConfig` for the entry above turned up four keys that were
  unset and reaching a user-visible Windows surface:

  | key | was | now |
  |---|---|---|
  | `publisher` | derived from the identifier -> `onboard` | `Eris Uruqi` |
  | `homepage` | empty -> ARP `HelpLink` and `URLInfoAbout` blank | the repository URL |
  | `copyright` | empty -> the exe's VERSIONINFO `LegalCopyright` blank | `Copyright (c) 2026 Onboard contributors` |
  | `licenseFile` | empty -> the installer showed no licence page | the repository's MIT `LICENSE` |

  `publisher` and `copyright` deliberately DISAGREE, and it is not an
  oversight. They answer different questions: who ships the binary, and who
  holds the copyright. The second is already answered by `LICENSE`, so
  `copyright` quotes that file verbatim rather than inventing a second answer
  that could drift from it. `publisher` is the individual, which is also the
  string an individually-issued code-signing certificate would carry, so
  `SIGNING.md` will not have to change it.

- **v0.1.1 (P0 defect, shipped) — "UNIQUE constraint failed: symbol.id"
  returned, and the Phase 11 fix was its cause.** Reproduced on the real
  repository the user reported (`CacttusEdu`, 308 files, no Python at all)
  through `analyze()` with a real `SqliteCacheStore`, not by hand-feeding the
  parser. The colliding rows, printed before anything was changed, came from
  `backend/src/routes/admin/audit-logs.routes.ts:35`:
  `router.get('/', validate({ query: listAuditLogsQuerySchema }),
  asyncHandler(auditController.list));` — two byte-identical rows
  `{ name: "/", kind: "route", startLine: 35 }`.
  - **Not a hash collision, and not the missing `kind`.** Both rows are
    `kind: "route"`, so widening `symbol.id` to include `kind` would have
    changed nothing. The two rows carry IDENTICAL `(path, name, startLine)`
    inputs, so `computeSymbolId` was handed the same string twice — an input
    collision, not a digest collision. 16 hex chars is 64 bits; a birthday
    collision needs billions of symbols, and this repo has 1,772.
  - **Mechanism.** Phase 11 repaired route OVER-matching by appending
    `(_) @route.handler` to require a handler argument after the path. That
    clause is an UNANCHORED child pattern, so it binds once per argument
    FOLLOWING the path, and tree-sitter emits one match per binding. Routes
    emitted equals `argc - 1`, measured: 2 args produced 1 symbol, 3 produced
    2, 4 produced 3, 5 produced 4. Every Express route carrying middleware
    duplicated and crashed the cache write. Fixed by anchoring the handler to
    the argument immediately after the path (`. (_) @route.handler`), which
    both requires a two-or-more-argument call and admits exactly one binding.
  - **Why Phase 11's own verification could not see it, in the terms that
    generalise past routes.** Three unit tests were added. Two assert with
    `.find()`, which returns the FIRST of N and therefore passes at one
    duplicate or a hundred. The third is a negative — `.some(...) === false` —
    trivially true when the shape emits nothing at all, so it survives any
    defect that emits MORE. The one genuinely discriminating assertion,
    kitchen-sink's end-to-end "no two symbols share an `id`", was pointed at a
    fixture containing zero route calls. And `node-express`, the fixture that
    proved the fix, contained only 2-argument routes — precisely the arity at
    which `argc - 1 == 1` makes the new defect invisible. Each half was
    individually reasonable. The defect lived in the gap between them: the
    discriminating check had no route to check, and the route fixture had only
    the harmless arity.
  - **THE STANDING LESSON: a regression test must exercise the shape a fix
    CREATES, not only the shape it REPAIRS.** A fix changes behaviour in two
    directions and verifying one of them is half a verification. Where the new
    behaviour has a parameter, state the property as an invariant over that
    parameter rather than testing the cases you happened to think of. This
    fix's test asserts EXACTLY ONE route symbol per route call at every arity
    from 2 to 6, not three hand-picked examples.
  - **Verified as a PAIR**, per the standing rule that a fix altering output
    for repos that were already correct is a second defect. Fingerprints were
    captured for 5 fixtures and 4 real repositories BEFORE any fixture was
    edited. After the query change exactly one line moved: `CacttusEdu`
    CRASH to `ee6c23e7...` (308 files, 1,772 symbols, 178 routes). All eight
    others byte-identical.
  - **Each fixture proven to discriminate**, by stashing the `.scm` change and
    watching `node-express`, `python-flask` and `kitchen-sink` each crash with
    the real `SQLiteError` before it, and pass after.

- **v0.1.1 — the same guard gap in `python.scm`, which Phase 11 never touched,
  plus a deliberate asymmetry that must not be "restored to parity".** Phase 11
  hardened three of the four route-carrying queries. Python kept none of the
  guards: no `#any-of?` on the verb and no first-argument anchor. Across 7,040
  real Python files the engine emitted **230 symbols of kind `route`, of which
  5 were routes** — the rest `@click.option`, `@mock.patch`,
  `@unittest.skipIf`, `@_api.deprecated`. That is not only a crash source: it
  corrupted classification, importance ranking and the roadmap for every
  Python repository that did NOT crash. After the fix: 230 to 0, with genuine
  Flask/FastAPI detection confirmed intact.
  - A second, independent Python defect: a route symbol took its `startLine`
    from the enclosing `decorated_definition`, so two GENUINE routes stacked on
    one function (`@app.get("/items")` over `@app.post("/items")` — an ordinary
    FastAPI idiom) shared a name AND a line, and collided. Tightening the query
    could never have fixed this one. Route symbols are now positioned on their
    own decorator; Python permits one decorator per line, so their lines are
    distinct by construction.
  - **THE ASYMMETRY, RECORDED SO IT IS NOT DELETED AS AN INCONSISTENCY:**
    `python.scm` carries a guard the three TS/JS queries do not — a `#match?`
    predicate requiring a route path to begin with a forward slash. It exists
    because the verb list alone cannot separate HTTP `PATCH` from
    `@mock.patch(...)`, the stdlib patcher, which appears in essentially every
    Python test suite. A denylist of known non-route objects (`mock`,
    `unittest`, ...) was rejected: an open-ended list of things that are not
    routes is the same shape as the defect being fixed. A leading slash is a
    property of what a route IS, and both Flask and FastAPI require one.
    **The cost, accepted deliberately:** a Python route registered with a path
    that does not begin with a slash is now undetected. TS/JS do not need this
    guard — no comparable idiom collides with their verb list — and
    propagating it there would change behaviour for already-correct repos to
    fix no defect. Do not "restore parity" in either direction.
  - The parity check treats this as an ADDITION, not a divergence: it asserts a
    floor (verb restriction plus anchored argument-list captures) and is silent
    about extra guards, so `python.scm` satisfies it while carrying more.

- **v0.1.1 — `scripts/query-guard-parity-check.py`, because the real defect
  both times was a decision that reached some call sites and not others.**
  Same shape as the three `parseJsonSafely` copies and the tripled waker. The
  check derives its worklist from the query files themselves — any `.scm`
  capturing `@route.` participates — so a fourth language's query is covered
  the day it is added rather than the day somebody remembers a list. It
  asserts the verb restriction and that every argument-list capture is
  anchored. **Proven to discriminate:** run against the pre-fix tree it
  independently catches all four defects (the unanchored handler in each of
  the three TS/JS queries, and both Python gaps). It distinguishes a capture
  ATTACHED to a node pattern from one REFERENCED by a predicate form, because
  the latter is not subject to the anchor rule.

- **v0.1.1 — `E_ENGINE_CRASHED` was the wrong code, for the second time, and
  the discriminator already existed.** The engine did not exit; it answered.
  `RpcError::Closed` means a dead transport and `E_ENGINE_CRASHED` is correct
  there. `RpcError::Remote` carries a JSON-RPC `error` object, which proves the
  process is alive and replying — yet it fell through to the same code. The
  fallback now returns a new `E_ANALYSIS_FAILED`, chosen by what actually
  happened at the transport layer rather than by guessing, exactly as
  `E_ENGINE_NOT_STARTED` was split out after a packaged build reported a crash
  for a process it had never spawned.
  - This is not a wording preference. `E_ENGINE_CRASHED`'s copy makes three
    statements — the engine "exited before finishing", "retrying usually
    works", and "the cache keeps completed files" — and for a deterministic
    engine-side failure **all three are false**: the process is alive,
    re-parsing identical bytes fails identically (verified: three consecutive
    runs, same error), and the batch persist is transactional and rolls back
    to zero rows (verified: `file_cache`, `symbol`, `token_index` and
    `analysis_result` all 0 after three crashed runs, `integrity_check: ok`).
    v0.1.0 shipped all three to a user. The new copy promises neither retry
    nor retention. `E_ENGINE_CRASHED`'s copy is unchanged, because for a
    genuinely closed transport it is true.
  - Additive to the frozen contract, not a change to it: `AppError.code` is
    `z.string()`, and the `E_ENGINE_NOT_STARTED` precedent added its code in
    `error.rs` and the UI copy table only. No `SCHEMA_VERSION` bump, no cache
    invalidation.

- **v0.1.1 — the log had two call sites in the whole application, and the
  error copy pointed users at it.** Both were about sidecar resolution
  (`lib.rs`), so a real user's `onboard.log` after a crash read, in full,
  three identical `sidecar resolved: ...` lines. `map_remote_error` put the
  engine's message into `AppError.detail`, which reaches the UI and nothing
  else. So `E_ENGINE_CRASHED`'s "The log is at {path}" named a file that could
  not describe the error it was naming. `AppState::log_app_error` now records
  every `AppError` it is given with its code and detail; `analyze_repo` is
  wired to it. Section 12 constrains what may be logged — no file contents, no
  keys, no repo-external paths — and none of that appears here: the code is a
  fixed enum string and the detail is the same developer text the UI already
  shows behind its Details disclosure. Nothing is recorded that the user
  cannot already read on screen. Analysis start/end and phase transitions are
  the obvious next additions and are deliberately NOT in this patch release.

- **v0.1.1 (P1 defect, shipped) — a console window opened beside the app on
  every Windows launch, and `tauri-plugin-shell` was already setting the flag
  that would have prevented it.** The plugin sets `CREATE_NO_WINDOW` on the
  command it builds (`tauri-plugin-shell-2.3.5/src/process/mod.rs:173`) — but
  that command is never spawned. `lib.rs`'s `resolve_sidecar_program` converts
  it only to read `.get_program()`, the path the plugin resolved, and drops it;
  `sidecar/spawn.rs` then builds a fresh command carrying no flags. The flag
  was set on an object that never spawns anything. Since the app is
  `windows_subsystem = "windows"` in release it owns no console for a child to
  inherit, so the OS allocated the console-subsystem `onboard-engine.exe` its
  own, which sat on screen for the life of the process.
  - **Scope, established rather than assumed.** Structurally Windows-only:
    `CREATE_NO_WINDOW` is a `CreateProcess` flag with no POSIX analogue, and
    the child's stdin/stdout/stderr are all piped, so no terminal is attached
    on Linux or macOS — a `.deb` user never saw one, and the `installed-deb`
    job running under Xvfb is not the reason. Restarts do not accumulate
    windows: `try_restart` calls `kill_live` first, and on the `Closed` path
    the child is already dead, so at most one console exists at a time — but it
    is RE-created on each restart, so up to `SIDECAR_MAX_RESTARTS`
    reappearances are possible within one session.
  - **No CI job can see this**, which is the point. `installed-windows`
    asserts on log CONTENT; `installed-deb` runs headless under Xvfb. Neither
    observes the screen. A human sees it in one second. A line was added to
    `docs/SMOKE_CHECKLIST.md` accordingly — that file exists for exactly this
    category, and this defect is now its clearest example.

- **v0.1.1 — `import_edge` is dead in real-world use, confirmed on a shipped
  cache rather than by static analysis.** The table is defined in the frozen
  schema, specified in Section 6.1, and given a justified index — and
  `replaceImportEdgesForPath`/`getImportEdgesFromPath` have zero callers in
  `src/`; the only caller of either is the cache-store's own unit test. A real
  `0a8ae594cf7aa21c.sqlite` written by the installed v0.1.0 against a 111-file
  repository contains **`import_edge`: 0 rows**, beside `symbol`: 355 and
  `token_index`: 11,538. Warm runs never read edges from SQL: they rehydrate
  the whole `ParsedFile` — raw imports included — from `file_cache.parsed_json`
  and re-resolve every edge, and the fast path serves the entire assembled
  result from `analysis_result.result_json`. The schema's own `-- Reason:`
  comments therefore describe a design that is not the implementation:
  `idx_import_edge_to` claims in-degree, PageRank and the "importers of this
  file" panel traverse it, and `idx_symbol_path` claims the file-viewer outline
  range-scans it, while `getSymbolsForPath` also has zero callers. Left in
  place for v0.1.1 and recorded here, NOT fixed: removing a table from a frozen
  schema is not a patch-release change. The latent hazard is real — its primary
  key `(from_path, specifier, line)` is derived from a subset of the fields
  that make a row unique, and numpy's
  `from . import multiarray, numerictypes, numerictypes as nt` yields the
  specifier `.numerictypes` twice on one line — but it is unreachable while
  nothing writes the table. The doc comments actively invite someone to wire it
  up; whoever does must fix the key first.

- **v0.1.1 — a named failure mode: A CONTROL THAT EXISTS, IS CORRECT, AND
  NEVER REACHES THE THING IT GOVERNS.** Two instances now, in unrelated
  subsystems, which is what makes it worth naming rather than filing twice:
  - `graphHasFail` was computed correctly and then dropped before it reached
    `process.exitCode`, so a failing gate reported success.
  - `CREATE_NO_WINDOW` was set correctly by `tauri-plugin-shell` on a command
    object that is never spawned — `lib.rs` takes only `.get_program()` from
    it — so the console it was meant to suppress appeared anyway.
  In both, reviewing the control in isolation finds nothing wrong: the flag IS
  set, the variable IS computed. The defect is entirely in the wiring between
  the control and its effect, which is exactly the part a reader's eye skips
  because the interesting logic is elsewhere. **The check is not "is this
  configured correctly" but "does this configuration reach the thing it
  governs" — trace it forward to the effect, or assert the effect.** Where the
  effect is observable only by a human (a window on screen), that assertion
  belongs in `docs/SMOKE_CHECKLIST.md`, not in a unit test that can only
  re-confirm the control was set.

- **v0.1.1 — a denylist that false-positives on prose is behaving correctly;
  reword the prose, do not widen the allowlist.** `check_egress_chokepoint`
  failed on `sidecar/spawn.rs` after a DOC COMMENT there mentioned the
  fully-qualified `std` process-command type by name. The check scans for
  literal strings and cannot distinguish code from comments. The fix was to
  reword the comment (and say in it why it is worded that way), not to add a
  second reviewed-door entry for that file. Precedent, deliberately: every
  widening of an egress allowlist is permanent and is exactly how a real door
  gets added unnoticed later, whereas a false positive on prose costs one
  rewording and leaves the guarantee intact. The check erring toward
  over-strictness is the safe direction for it to err in.

- **v0.1.1 — the cache-invalidation version branch, exercised against a real
  prior-version cache for the first time.** Section 6.1 drops and recreates the
  cache when `engineVersion` differs, and v0.1.1 moves it, so every existing
  user's first analysis after updating is a cold run. That branch had almost
  certainly never run against a genuine v0.1.0 cache before — only against
  caches this project's own tests had just written. Confirmed rather than
  assumed, on a COPY of the real `0a8ae594cf7aa21c.sqlite` written by the
  installed v0.1.0 (the original left untouched): before,
  `engineVersion=0.1.0+2b1824d77312` with `file_cache`: 111, `symbol`: 355;
  after pointing the v0.1.1 engine at it, `engineVersion=0.1.1+299bd25dd084`
  with `file_cache`: 308, `symbol`: 1772. Recreated, not migrated — the old
  rows do not survive and no warm hit is served. Distinct from the
  integrity-failure branch, which is its own state. Called out in the release
  notes because a one-off slow analysis after an update is otherwise reported
  as a regression.

- **v0.1.2 (P1 defect, real installed build) — the dependency-graph
  measurement feedback loop.** The graph tab rendered with no visible canvas,
  a shifted/clipped tab strip, and both scrollbars present — reported against
  the real v0.1.1 install, on CacttusEdu (308 files), and not caught by any
  of 385 UI tests or 4 axe suites because jsdom has no layout engine: any
  defect that lives in intrinsic sizing or real canvas measurement is
  invisible to that whole test class by construction, the same gap
  `CREATE_NO_WINDOW` fell through for the same reason (a human, not a gate,
  is what caught both).
  - **Root cause, proven live rather than inferred.** `DependencyGraph.tsx`'s
    Cytoscape mount div sat in a `flex-col` chain (`AppShell`'s `<main>` →
    `App.tsx`'s `ReadyContent` wrapper → `DependencyGraph`'s own `<section>`
    → the mount div) with no `min-h-0`/`min-w-0` above it. Cytoscape's
    renderer (`matchCanvasSize`, `cytoscape.cjs.js:30742`) reads the mount
    div's `clientWidth`/`clientHeight` and writes them straight back onto an
    IN-FLOW child it owns (`canvasContainer`, `position: relative`) as an
    explicit inline pixel size — not an absolutely-positioned overlay, a real
    flow participant. With no floor above it, the mount div's own height is
    `min-height: auto` — a content-based floor — so on the next of several
    internal measurement passes Cytoscape runs during construction
    (`notify('load'|'resize'|'mount')`, `cytoscape.cjs.js:27636`), it reads
    back a `clientHeight` that already includes its own prior write. Proven
    directly against the real installed app (`bunx tauri` substituted with
    the project's own `VITE_IPC=mock` dev server in Chrome — same rendering
    family, not the same engine; see the WebView2 caveat below): hiding the
    `canvasContainer` div via devtools collapsed the mount div from 4910px to
    710px instantly; unhiding it restored 4910px instantly. Remounting the
    identical component with identical data landed on 2060px instead — proof
    the loop converges on whatever internal render pass happened to run
    last, not on any function of content, which is also why dragging the OS
    window produced no repaint: Cytoscape's own `ResizeObserver` (it has one;
    an earlier turn in this diagnosis wrongly assumed it didn't) re-measures
    correctly, but re-measures the SAME already-inflated `clientHeight` every
    time, and `matchCanvasSize`'s own early-exit (`if (canvasWidth ===
    r.canvasWidth && ...) return`) then does nothing.
  - **Fix.** `min-h-0` added to `ReadyContent`'s wrapper (`App.tsx`) and to
    `DependencyGraph`'s `<section>` — both were `min-height: auto` with
    nothing capping them, the two links the loop actually climbed through.
    The mount div's own `min-h-[28rem]` is already an explicit, non-`auto`
    value and needed no change; what it lacked was `min-w-0`, since nothing
    had ever given it a width floor and the same loop runs on `clientWidth`
    exactly the way it runs on `clientHeight`. Argued from the mechanism, not
    tried: `min-h-0`/`overflow: non-visible` are the two CSS-spec-equivalent
    ways to zero a flex item's automatic minimum size, `main` already uses
    the `overflow-auto` form correctly, and once every level between it and
    the mount div resolves to a definite top-down size, nothing a descendant
    writes can feed back into the number Cytoscape reads next — no
    `overflow: hidden` or absolute positioning on the mount div itself is
    additionally required. Matches (and now cross-references)
    `FileViewer.tsx`'s CodeMirror mount, which already carried `min-w-0` for
    an unrelated reason (CodeMirror's own wide content) and never exhibited
    this.
  - **Verified across remounts, not once**, per the same discipline
    `import_edge`'s dead-table finding and the cache-invalidation branch
    above both used: the landing value differs per mount, so a single clean
    render proves nothing. `e2e/graph-layout.spec.ts` remounts the graph tab
    repeatedly against a real engine (`tauri-driver`, not jsdom — jsdom
    cannot host this class of test at all) and asserts the mount div's
    measured height never exceeds its parent's, every time, so a regression
    here fails a real test instead of waiting for the next person to notice
    a grey canvas.
  - **Scale.** The original report was CacttusEdu (308 files); this repo's
    own `apps/`+`packages/` source tree (429 files) stood in for it in both
    the e2e run and a Chrome-side synthetic-graph check, since CacttusEdu
    itself is not present in this environment — comparable order of
    magnitude, not the identical repo, and named as a substitution for the
    same reason the WebView2 one is below.
  - **What is NOT verified by any of the above.** Every measurement in this
    entry — the live devtools reproduction, the fix's confirmation, the new
    e2e assertion when it runs outside `tauri-driver` — used Chromium
    (either plain Chrome or, for the e2e spec, `tauri-driver`'s
    `msedgedriver`-backed WebView2 session). `msedgedriver` IS WebView2's own
    driver, so the e2e run is the real engine; the earlier Chrome-only
    reproduction was not, and is not offered as proof of anything beyond the
    mechanism. Put a manual pass on the smoke checklist regardless: open the
    graph tab on a real Windows install, maximized and at one restored size,
    against a repo this size, and confirm the canvas is visible and the tab
    strip is not shifted. Chromium agreement is evidence, not a substitute
    for that.

- **v0.1.2 — msedgedriver pinning: the E2E suite's own driver goes stale
  independently of everything it tests, and will do so again.** Discovered
  while trying to run `e2e/graph-layout.spec.ts` (above) against real
  WebView2: `wdio.conf.ts`'s `NATIVE_DRIVER_PATH` points at a checked-out
  `msedgedriver.exe` under `src-tauri/target/webdriver/` (gitignored, not
  part of the shipped app), and that binary is pinned to whatever Edge
  build it was fetched for. WebView2 itself auto-updates with Windows/Edge;
  the driver does not follow it. Symptom: `session not created: This
  version of Microsoft Edge WebDriver only supports Microsoft Edge version
  150. Current browser version is 152.0.4191.66` — a hard failure with no
  retry that has nothing to do with the code under test.
  - **The fix is not "pin the runtime too."** WebView2 is a shared system
    component (other apps use it), not something this project should hold
    back, and Edge itself updates on its own cadence outside this
    project's control. The driver is the one side of this pair actually
    checked out locally, so it is the one side to keep in sync.
  - **How to refresh, recorded so the next person does not have to
    rediscover it (they will hit this again — it is a when, not an if):**
    the failing session's own error message states the exact version
    needed ("Current browser version is Y" — no separate lookup required).
    Download `https://msedgedriver.microsoft.com/{Y}/edgedriver_win64.zip`,
    extract `msedgedriver.exe` from it, and overwrite
    `apps/desktop/src-tauri/target/webdriver/msedgedriver.exe`. Verify with
    `msedgedriver.exe --version` before re-running the suite — it should
    echo back `Y` exactly. Same doc comment now lives at
    `wdio.conf.ts`'s `NATIVE_DRIVER_PATH`, so it is visible at the exact
    line someone debugging this will already be looking at, not only here.
  - **Resolved this occurrence** by fetching
    `https://msedgedriver.microsoft.com/152.0.4191.66/edgedriver_win64.zip`
    (Microsoft's own driver host, matched to the installed runtime exactly;
    confirmed via `--version` after extraction) with the user's explicit
    go-ahead, since fetching a binary is a permission-gated action — this
    is a test-toolchain tool, gitignored, and never enters the bundled
    app.

- **v0.1.2 — the `UNIQUE constraint failed: symbol.id` crash reproduced on
  real production TypeScript was a stale sidecar in this development
  environment, not a regression, an incomplete fix, or a fourth mechanism.**
  Investigating the dependency-graph layout defect above required real
  analysis of real repositories through the real app, and both the full
  monorepo and `packages/engine` alone crashed with the exact v0.1.0 symptom
  the v0.1.1 arity fix (`98a0ba9`) was supposed to have closed.
  - **Reproduced and dumped, not assumed.** A standalone script called
    `analyze()` directly against current engine source (no Tauri, no
    compiled sidecar), computing `symbol.id` exactly as documented
    (`sha1(path#name#startLine)`) and grouping by id: `packages/engine`
    alone, 979-981 symbols across two runs (one with a real
    `SqliteCacheStore` exercising the actual persist path), **zero
    collisions** either time. Current source does not reproduce the crash.
  - **The discrepancy was the finding.** `apps/desktop/src-tauri/target/
    debug/onboard-engine.exe` — what the real app actually spawns — was
    dated **2026-07-28**. The arity-fix commit landed **2026-08-05**, a
    week later. Every real-app test run earlier in this investigation had
    been exercising a pre-fix binary the whole time.
  - **Confirmed by hash, not by re-reading a version string** (the standard
    this project already holds itself to — see the icon-cache entry above
    and the msedgedriver entry): `bun run build:sidecar` against current
    source produced engine hash `299bd25dd084`, the EXACT hash this
    document already cites for the real, shipped v0.1.1 engine. Staged it,
    rebuilt `onboard.exe` (required — `tauri-build`'s build script copies
    `externalBin` at compile time, so a stale `binaries/` directory is not
    picked up by a fresh binary until the binary itself rebuilds), confirmed
    the copy was current by file timestamp, then re-ran real analysis
    through the real app on real WebView2: `packages/engine` (981 symbols,
    321 edges, 161 files parsed) and the full monorepo (2137 symbols, 791
    edges, 355 files parsed) — both clean, no crash, no collision.
  - **Why this decided the release scope.** Had the current-source
    reproduction also crashed, v0.1.2 would have been the crash fix, not a
    layout patch. It did not, so v0.1.2 ships as the layout fix only — but
    the fact that a stale local artifact reproduced a real, already-fixed,
    already-documented defect for an entire investigation, undetected,
    is itself the reason `engine.version was answered and discarded` (next
    entry) exists.
  - **`parseFailedCount: 1`, checked and closed, not queued.** Both clean
    runs above reported one `PARSE_FAILED` diagnostic. It is
    `packages/engine/fixtures/kitchen-sink/src/broken.ts` — a fixture
    file whose entire purpose is to BE unparseable, so the engine's own
    test suite can assert the diagnostic fires. Working as designed, not a
    finding.

- **v0.1.2 — `engine.version` was answered and discarded.** Nothing in
  the app told anyone which engine was actually running, and the only
  reason the stale-sidecar defect above was ever noticed is that a
  discrepancy was chased by hand — the app gave no signal, and neither did
  this investigation until that point.
  - **The check that exists is narrower than its name suggests.**
    `SidecarSupervisor::ensure_started` performs the `engine.version`
    handshake and compares exactly one field —
    `contractSchemaVersion`, against the Rust-side `CONTRACT_SCHEMA_VERSION`
    constant — and aborts with `E_ENGINE_VERSION_MISMATCH` if it differs.
    `engineVersion` and `grammarFingerprint` are also in that response and
    were read into a local, never used for anything, and dropped. A sidecar
    built from entirely different engine source — including a
    pre-arity-fix one, exactly the case that bit this investigation —
    shares `contractSchemaVersion` with a fixed one whenever no *schema*
    changed, and the check has nothing to say about it. Confirmed by
    reading `ensure_started` directly, not inferred: the comparison is
    `contract_version != Some(CONTRACT_SCHEMA_VERSION)` and nothing else in
    that function reads `result` at all.
  - **Fixed: visibility, at both points that matter.** `engineVersion`,
    `contractSchemaVersion`, and `grammarFingerprint` are now logged on
    every successful handshake (`onboard.log`: `engine handshake:
    engineVersion=... contractSchemaVersion=... grammarFingerprint=...`)
    and kept in `SidecarSupervisor::last_handshake` across restarts,
    surfaced through a new read-only `get_engine_info` command and a
    footer in Settings (`EngineVersionFooter.tsx`) reading `Onboard
    <appVersion> · engine <engineVersion> · schema <n>`. Additive: a new
    command, following the same pattern `test_ai_key` and the three `ai_*`
    commands were added by in Phase 12, with its own seam-coverage case in
    `tauri-ipc.seam.test.ts` (a test written for precisely this class of
    gap — "a method nothing asserts against the bridge can be a stub
    forever" — and it caught the omission immediately when this command
    was added without one).

    The handshake line alone answers "which engine is this app running"
    only for whoever reads a session's first lines. `analyze_repo_core`
    now also logs `analyze_repo: engineVersion=...` at the start of every
    single analysis, reading `last_handshake` fresh each time — so a
    long-lived session that has run many analyses against one warm
    sidecar still has an engine-version line next to EVERY result, not
    one line at the top a debugger has to scroll back to find. `(not yet
    started)` on a sidecar's first-ever call is expected and is
    immediately followed by that call's own handshake line.
  - **DECIDED: the shell does NOT refuse to start a sidecar whose
    `engineVersion` disagrees with the app's — visibility was the actual
    gap, a refusal is not.** Considered and rejected, not left open.
    A hard refusal needs a real mechanism the app does not have today —
    the Rust binary would have to know, at compile time, which engine
    build it shipped with (unlike `CONTRACT_SCHEMA_VERSION`, which already
    is a real embedded constant; the engine's version is a git-hash-suffixed
    build stamp computed at `build-sidecar.ts` time, not something
    `build.rs` currently has access to). Building and maintaining that
    machinery buys less than it costs: the app and engine are rebuilt
    independently and are routinely, briefly out of step during ordinary
    development, so a hard refusal would turn that normal state into a
    blocked dev loop — trading a caught bug for a new, manufactured
    failure mode, on every single day nobody shipped a stale binary.
    The logged line and the Settings footer above would have surfaced
    this investigation's own stale sidecar in seconds, the moment anyone
    looked — which is the actual property a refusal was trying to buy,
    at a fraction of the mechanism and none of the dev-loop cost. Revisit
    only if a REAL incident (not this one) shows visibility genuinely
    insufficient — not by default, and not by extrapolating from a defect
    that logging alone already closes.

- **AMENDMENT — `bundle.publisher` renamed from the individual's name
  (`Eris Uruqi`) to `kodeksidev`, before v0.1.3's draft published.**
  Authorised-by: product owner (chat), 2026-09-07
  Departs-from: the 2026-08-03 AMENDMENT above, which chose the individual's
  name deliberately — recorded there as "also the string an individually-
  issued code-signing certificate would carry." Superseded, not corrected:
  that reasoning was sound for the identity in place at the time.

  Filed as its own entry rather than an edit to the 2026-08-03 table, per
  this file's own rule that a row already committed to (i.e. shipped in
  v0.1.1/v0.1.2) is not rewritten in place.

  **Every surface enumerated, each confirmed rather than assumed — not
  the same enumeration repeated from memory, since the 2026-08-03 one is on
  record as having taken two rounds to get complete (the icon-cache
  correction, `docs/SMOKE_CHECKLIST.md`, is the precedent for why this pass
  re-derived rather than trusted recall):**

  | surface | confirmed by | changes? |
  |---|---|---|
  | Add/Remove Programs "Publisher" (NSIS → HKCU uninstall registry) | `@tauri-apps/cli`'s own `config.schema.json`: publisher "maps to the Manufacturer property of the Windows Installer" | YES |
  | NSIS `MANUFACTURER` define (`Software\<MANUFACTURER>\Onboard` registry key) | same schema text; this file's own 2026-08-03 entry already traced `MANUPRODUCTKEY` to it | YES |
  | `onboard.exe`'s VERSIONINFO `CompanyName` | read directly from the cached `tauri-build-2.6.3` crate source, not inferred: `lib.rs:646` — `config.bundle.publisher.unwrap_or_else(\|\| identifier.split('.').nth(1)...)`, `lib.rs:655` — `res.set("CompanyName", &company_name)`. The fallback is the literal `onboard` this project's own 2026-08-03 table already named as the pre-fix default, confirming this is the same value read the same way | YES |
  | `.deb` package `Maintainer` field | same schema text: it maps to `publisher` **"if the Cargo.toml does not have the authors field."** Checked `apps/desktop/src-tauri/Cargo.toml`'s `[package]` directly: no `authors` key present | YES |
  | `.rpm` Vendor/Packager-equivalent field | **not confirmed.** `config.schema.json` names Windows and `.deb` explicitly and is silent on `.rpm`; `tauri-bundler` (the crate that actually writes the RPM spec) is not a Cargo dependency of this crate, so its source was not available to read the way `tauri-build`'s was. Likely follows `publisher` too — RPM bundling and `.deb` bundling share one `Settings`/`BundleSettings` struct in upstream `tauri-bundler` — but "likely, by the same-struct pattern" is an inference, not a read source line, and is named as one rather than folded into the confirmed rows above. Verify against a real built `.rpm` (`rpm -qi`) before treating this as closed | LIKELY, UNVERIFIED |
  | `bundle.copyright` | tauri.conf.json, read directly: `"Copyright (c) 2026 Onboard contributors"` — never carried the individual's name; the 2026-08-03 entry already recorded that `publisher` and `copyright` deliberately disagree | NO |
  | `LICENSE` | read directly: `Copyright (c) 2026 Onboard contributors` | NO |
  | `README.md` | searched directly: no author/publisher line at all | NO |
  | `package.json` `author` field, all four workspace packages (root, `apps/desktop`, `packages/engine`, `packages/contract`) | searched directly: none declare an `author`/`authors` field at all — nothing for a name to occupy | NO |
  | `docs/RELEASE_NOTES_v0.1.0/v0.1.1/v0.1.2.md` | searched directly: no mention | NO |
  | Windows SmartScreen's "Unknown publisher" line | `docs/INSTALL.md` and `observed-dialogs.json` already record why: that text is the OS reading the Authenticode signature, not our metadata — an unsigned build says it regardless of what `bundle.publisher` holds | NO |

  **`docs/SIGNING.md` carries no literal mention of the individual's name and
  needed no text change** — but the REASONING that justified the original
  choice (an individual's name matching what a future individually-issued
  certificate would carry) is now stale against `kodeksidev`, which reads as
  a brand/handle rather than a legal identity a CA verifies a certificate
  subject against. Not acted on here — signing is out of scope for v1
  (`docs/SIGNING.md`'s own header) — but named so whoever eventually works
  the signing path in `docs/SIGNING.md` does not inherit an assumption this
  rename quietly invalidated.

  **The CI gate that would have caught a silent revert did not exist —
  fixed, not merely noted.** `.github/workflows/release.yml`'s
  `installed-windows` job read the real HKCU uninstall entry after a real
  silent install and **printed** `Add/Remove Programs -> Publisher=...`.
  That print is exactly what caught the identifier-derived `onboard` default
  on 2026-08-03 — but a human reading a log is not a gate, and nothing
  compared the printed value to anything. Added an actual assertion against
  `kodeksidev` at that same step, so a future silent revert (a stray
  `tauri.conf.json` edit, a stale cached bundle) fails the job instead of
  printing a wrong value that only gets noticed if someone happens to read
  it — the same "logged but not gated" shape this document's own
  `engine.version` entry just closed for a different surface.

- **Follow-up to the `bundle.publisher` AMENDMENT above — the `.rpm`
  question settled by a real build, not by reading further into
  `tauri-bundler`; a real `dpkg-query` bug the Linux assertion almost
  inherited; and the Linux gate closed to match the Windows one.**

  **The `.rpm`'s Packager field, OBSERVED rather than inferred.** Built a
  minimal real `.rpm` with `rpmbuild` (WSL2 Ubuntu, `rpm` package installed
  for the query/build tools) carrying `Packager: kodeksidev`, then read it
  back with `rpm -qp --queryformat '%{PACKAGER}' <file>` — no install
  required, since RPM's own query tool reads a package file directly. Result:
  `kodeksidev`, exact. This does not by itself prove `tauri-bundler` writes
  `kodeksidev` into a REAL Onboard `.rpm` — that still rests on the
  same-`Settings`-struct inference the prior entry named — but it does prove
  the QUERY SIDE (what the new CI step reads and compares) is correct, which
  is the half this project controls and the half a wrong assertion would
  actually be wrong about. The CI step added below queries the real built
  `.rpm` on every release, which finishes settling the other half on the
  first real run.

  **Settled on that first real run, and the same-`Settings`-struct inference
  above was WRONG, not merely unconfirmed.** The `workflow_dispatch` dry run
  this entry predicted would settle it did, immediately: the real Onboard
  `.rpm`, built by the real `tauri-bundler` on a real `ubuntu-22.04` runner,
  reports `Packager='(none)'` — genuinely unset, not `kodeksidev`. Checked
  exhaustively rather than re-guessed: `RpmConfig`'s complete property list
  in `config.schema.json` is `depends`, `recommends`, `provides`,
  `conflicts`, `obsoletes`, `release`, `epoch`, `files`, `desktopTemplate`,
  and four lifecycle scripts — no `packager`, no `vendor`, nothing
  publisher-shaped. `.deb` and `.rpm` do not in fact share enough of
  `tauri-bundler`'s internals for the `publisher` field to reach both; they
  only share a build command. The `.deb`'s own assertion passed on the same
  run — `Maintainer='kodeksidev'`, exact — so this is not the query logic
  failing again; it is the earlier INFERENCE about upstream's internals
  being wrong, on a claim explicitly flagged at the time as an inference
  rather than a read source line. It would have been wrong to fold into the
  "confirmed" rows regardless of which way it landed — the point of marking
  it separately was exactly to let it be checked and be either wrong or
  right without disturbing what was actually confirmed.

  **The assertion added for this does not compare `Packager` to
  `bundle.publisher` — it asserts the field stays `(none)`, on purpose.**
  There is no `tauri.conf.json` field that can change this today, so
  `(none)` is the correct current truth, not a gap to paper over with a
  non-blocking `::warning::`. A warning nobody is obligated to read is the
  same soft-signal shape this project has spent weeks removing (the
  console-window and `graphHasFail` "control that never reaches its effect"
  family, generalized once more: a check that reports without holding is a
  check whose result nobody has to act on). Asserting the true present
  state instead means the day `tauri-bundler` gains a way to set this, the
  value arriving turns the gate red on its own — which is the useful
  failure: it says "wire this up now," not "someone should look into this
  eventually."

  **Whether shipping `.rpm` at all is worth it is now a live question, not
  answered here.** Recorded in `release-formats.json`'s own header — where
  the next person to touch the format table will read it — rather than
  decided in this entry: `.rpm` has now diverged from `.deb` twice in what
  it can carry (the upload-glob gap this file's header already tells that
  story about, and now this), it shipped because it was one extra word in a
  `--bundles` argument on a runner already building `.deb`, and nothing in
  this project's history shows anyone asking for it or installing it
  outside CI.

  **A real `dpkg-query` bug the Linux assertion would otherwise have
  inherited.** The obvious first attempt — `dpkg-query -W --showformat=
  '${Maintainer}\n' <package>` — was tried against a real installed test
  package before being written into CI, per the same "prove it discriminates
  before trusting it" standard applied to the Windows check. It silently
  returned EMPTY, even though the field genuinely exists and installed
  correctly (`dpkg -s`/`dpkg -l` both show `Maintainer: kodeksidev` on the
  same package). `-W`'s format-string substitution does not support
  arbitrary control fields on this dpkg version (6.0.1, Ubuntu 26.04) the way
  its own documentation's phrasing suggests it should — `${Package}` and a
  handful of others work, `${Maintainer}` does not. Had this shipped
  unverified, the assertion would have compared `""` to `""` and passed on
  ANY installed `.deb`, publisher correct or not — precisely "a gate that
  passes on anything," and precisely why discrimination is proven against a
  REAL package before a check is trusted, not read off a man page. Switched
  to `dpkg -s <package> | grep '^Maintainer:' | cut -d' ' -f2-`, which was
  independently built-and-installed-and-verified (a real `.deb`, `dpkg -i`,
  then the extraction) to both read the correct value AND fail when handed a
  wrong expected value, before being written into `release.yml`.

  **Both new CI assertions — `installed`'s `.deb` Maintainer and its new
  `.rpm` Packager check, plus `installed-windows`'s existing one — now read
  their expected value from ONE place**, a `publisher` output the `plan` job
  derives from `tauri.conf.json` via `jq -er '.bundle.publisher'` (the `-e`
  makes the step itself fail if the value is ever unset, rather than
  propagate a null/empty string forward). Not hardcoded per-job: two
  workflow-file locations independently deciding the same expected string is
  the exact shape of the `*.rpm` upload-glob disagreement that motivated
  `release-formats.json` as a single source in the first place — recorded in
  that file's own header, and worth not repeating one config value later.

  **The `.deb` package NAME is also read from the artifact, not assumed.**
  `dpkg-deb -f "$DEB" Package` on the file just installed, rather than
  hardcoding `onboard` as a guess at what the bundler lowercased `Onboard`
  to (Debian policy requires lowercase package names, which is why it is not
  simply `productName`) — one fewer assumption in a check whose entire point
  is to stop trusting assumptions about what a bundler produces.

  **The `dpkg-query` bug above is the fail-open family's third instance, not
  a new shape.** Named earlier in this file (search "Shape worth noting"):
  INV-3 dropped a repo-containment refusal and returned a shorter array,
  reporting success; `grammar-loader.ts`'s `Parser.init()` degraded a WASM
  lookup failure into an empty-but-well-formed `AnalysisResult`, twice, in
  the same function, six months apart. `dpkg-query -W --showformat=
  '${Maintainer}'` returning EMPTY for a field that genuinely exists is the
  same mechanism in a third subsystem neither of those touches: a lookup
  that cannot answer produces an absence rather than an error, and an
  absence compared to another absence reads as agreement. What is different
  this time, and worth naming precisely because it is different: this
  instance did not reach a user, or even reach `main` unnoticed — it was
  caught by the same protocol INV-3's own fix now stands on ("ships with a
  test rather than a comment"), applied one step earlier, BEFORE the code
  existed to fail open in the first place. Proving a check discriminates
  against a real artifact before writing it into CI is that protocol run at
  authoring time. Two instances were found by someone reading a real result
  and noticing it was wrong; this one was found by refusing to trust the
  check until it had been shown to fail on purpose.

  **Named residual, not assumed closed: these two new assertions (and the
  `plan` job's single-source `publisher` output feeding all three) have run,
  for real, via a `workflow_dispatch` dry run on `main` — the same
  `bundle`/`installed`/`installed-windows` code path a tag push executes,
  minus the trigger type and the final publish-a-release step. They have
  NOT yet run via an actual `push: tags: ['v*']` event.** `v0.1.3`'s own tag
  predates this commit, so it did not exercise them and will not
  retroactively start doing so. The gap is deliberately left open rather
  than treated as closed by the dry run: whatever is tagged next is this
  gate's first tag-triggered execution, and that is worth knowing going in,
  not discovering if it is ever the one that fails.

- **v0.1.3 (unreleased) — the dependency-graph tab was STILL reported broken
  on the real installed exe after the `min-h-0`/`min-w-0` fix shipped, and
  the mechanism is a second, unrelated defect: an `sr-only` accessibility
  `<table>` whose intended 1px box is overridden by its own content.**
  Reported live against the real v0.1.3 installer: grey/mis-scaled Cytoscape
  texture blocks, the tab strip clipped to "Ask AI" alone, both scrollbars
  present — on the real installed binary, with the CSS fix from the prior
  entry confirmed present in that exact binary (read directly off a live
  WebView2 session via Chrome DevTools Protocol: the compiled `.min-h-0` /
  `.min-w-0` rules were found, byte for byte, in the running app's own
  stylesheets). Ruling out "the fix never shipped" left one honest
  conclusion to chase: something the prior fix did not touch.
  - **Real IPC path, not a substitution, this time.** The prior entry's own
    e2e spec injects a synthetic `AnalysisResult` through the
    `window.__onboardE2E` bridge, bypassing `analyze_repo` — named there as a
    substitution, twice. Reproducing THIS report meant not doing that again.
    First attempt monkey-patched `window.__TAURI_INTERNALS__.invoke` to
    fake the folder-picker result while leaving `analyze_repo` untouched —
    it looked like it worked (a real handshake, a real analyze call landed
    in the log) but the resulting UI showed an unrelated repo the patch
    never named, and direct inspection afterward found the patched `invoke`
    had reverted to the original with no page reload in between — the
    mechanism for that reversion was never nailed down, and rather than
    trust a hack that had just demonstrably done something unexplained, it
    was abandoned outright. Replaced with genuine UI automation: a live
    Win32 `Select Folder` dialog, enumerated and driven via
    `System.Windows.Automation` (address bar click, select-all, type the
    real path, `Select Folder` button click by coordinates) — the same
    thing a person's hands would do, against this repo itself (500 files
    scanned, 356 parsed, 158 orphans) through the unmodified
    `pick_repo_folder` → `analyze_repo` path.
  - **The mechanism, measured directly, not inferred.** With the graph tab
    open on that real analysis, `main` and `body` both measured normal
    (`scrollWidth`/`scrollHeight` within ~15-16px of `client*` — see KI-11
    below) — the ORIGINAL fix is intact and not regressing. But
    `document.documentElement.scrollWidth` measured **28,554px** against a
    1265px client width. Walking the DOM for anything wider than 2000px
    found the cause immediately: `GraphListFallback.tsx`'s `<table
    className="sr-only">` (one `<tr>` per file, added Section 9 Phase 8 for
    screen-reader parity), whose `getComputedStyle` reported `width:
    28555.5px`, `tableLayout: auto`, `whiteSpace: nowrap`, `position:
    absolute`. Tailwind's `sr-only` sets `width: 1px` — which a `<table>`
    with the default `auto` layout algorithm does not respect once cell
    content needs more, `white-space: nowrap` forces that content to stay
    unwrapped, and `position: absolute` with no positioned ancestor between
    the table and the document root means the resulting oversized box
    inflates `document.documentElement`'s own scroll extent while leaving
    `main`'s and `body`'s scroll boxes untouched — which is exactly why the
    prior entry's own containment checks (both of which measure `main`, not
    `documentElement`) never saw it. The specific worst cell, confirmed by
    reading it directly: `cacttus-edu-front/src/app/theme.ts`'s "Depended on
    by" column, 2,656 characters of comma-joined dependent paths, unwrapped.
  - **Honest gap, named rather than closed:** the tab strip and canvases
    still measured with correct rects in this same session, live. A real
    horizontal scrollbar on the whole window is proven; that it is the
    direct, sole cause of the specific grey-block/clipped-strip visuals
    reported is not — plausible (a window-level scrollbar appearing/
    disappearing under real WebView2 compositing is a believable trigger
    for Cytoscape's own `textureOnViewport` cache mis-blitting) but not
    independently confirmed the way the width measurement itself is.
  - **The fix: cap what the fallback renders, not the table's CSS.** Chosen
    over `table-layout: fixed` with a hard `max-width` because the
    underlying content was the actual defect, not just its symptom — a
    screen reader reading 2,656 unwrapped characters of joined filenames
    for one cell is not usable accessibility regardless of whether it also
    breaks layout. Capped both `dependsOn`/`dependedOnBy` lists to 8 entries
    (`+N more` appended when truncated) in `GraphListFallback.tsx`'s
    `formatList`, matching `packages/engine/src/constants.ts`'s
    `ROADMAP_DEPENDS_ON_CAP = 8` — the roadmap step generator caps the exact
    same shape of list for the exact same reason; the fallback table having
    no cap was the inconsistency, not a deliberate difference. The other
    six `sr-only` surfaces in the app (two headings and the search label in
    `WhereIsSearch.tsx`, two headings and one `aria-live` div in
    `DependencyGraph.tsx`, one label in `GraphToolbar.tsx`) were checked
    individually: all six are non-`<table>` elements with short, fixed, or
    single-value content, so the auto-layout-width mechanism above cannot
    reach them — this is not a general `sr-only` defect, it is specific to
    the one element that is both a `<table>` and unbounded.
  - **The e2e spec's own fixture could not have caught this, and that is
    fixed too.** `graph-layout.spec.ts`'s synthetic `AnalysisResult`
    (`generateSyntheticResult`, `bench/graph/generate-synthetic-graph.ts`)
    spreads edges randomly with a max of 3 outgoing per file and no
    deliberate hub — no file in it ends up with anywhere near 8 dependents,
    so its "Depended on by" cells were never long enough to trigger the
    table's auto-layout behavior even before the cap existed. The
    containment check was asserting against data structurally incapable of
    producing the defect it existed to catch — the same shape of gap named
    elsewhere in this file for `node-express`'s 2-argument routes. Fixed by
    adding `addHubDependentEdges`: deterministic (index-based, not another
    draw from the seeded RNG, so the existing edge set is untouched),
    forcing file 0 to accumulate one inbound edge from every 8th later
    file — for the spec's 429-file fixture, ~53 dependents, the same order
    of magnitude as the real `theme.ts` finding (~63) that exposed this.
  - **Named residual, not assumed closed: none of the above has been
    re-verified end to end yet.** The fix and the fixture change are
    written and pass their own unit tests (`GraphListFallback.test.tsx`
    gained a case asserting the cap fires and the cell stays under 500
    characters), and `bun run test`/`typecheck` are clean across the whole
    desktop app, but neither the real installed-exe reproduction above nor
    `e2e/graph-layout.spec.ts` has been re-run against a build containing
    this fix. Explicitly agreed before any of this landed: no tag, no
    release, until that re-test happens and the grey-block/clipped-strip
    symptoms are confirmed gone on a real build — if they are not, this
    entry's mechanism was real but incomplete, not wrong, and the
    investigation continues rather than closes.

- **Follow-up, same day — the cap alone was insufficient at real path
  lengths; `table-layout: fixed` was the missing second half, and the
  combined fix is now confirmed on a real analysis through the real IPC
  path.** Re-verifying the entry above surfaced a real gap in the first
  attempt: capping `dependsOn`/`dependedOnBy` to 8 entries cut the worst
  cell in this repo's own real analysis from 2,656 to 531 characters (a real
  reduction), but the `<table>`'s `getComputedStyle` width was still
  **9,905px** — real file paths in a real monorepo (`apps/desktop/src/
  components/DependencyGraph/DependencyGraph.axe.test.tsx`-length strings)
  are long enough that even 8 of them per cell, across two such columns,
  still exceeds a phone-book's worth of pixels. The cap bounds accessibility
  content; it does not bound the table's own CSS box, because `table-layout:
  auto` (the default) was still in effect. Added `table-fixed` (Tailwind's
  `table-layout: fixed` utility) to the same element, keeping the cap for
  the accessibility reason it exists for independently.
  - **A build-tooling near-miss worth naming so it is not repeated:** the
    first attempt to verify this looked like it failed — `getComputedStyle`
    on the live app kept reporting `tableLayout: "auto"` and `className:
    "sr-only"` (no `table-fixed`) even after editing the source, rebuilding
    the frontend, and running `cargo build --bin onboard` a second time.
    The cargo build had actually failed (`error: failed to remove file
    ...onboard.exe: Access is denied` — the previous debug instance was
    still running and holding the executable open) but was being piped
    through `tail`, whose own exit code (always 0) masked cargo's real one,
    so the failure looked like a successful no-op rebuild. Caught by
    checking the live DOM's actual `className` rather than trusting the
    build step's reported success — the same "verify by output, not by the
    step that claims to have produced it" standard this file has applied to
    CI checks, applied here to a local build. Killing the still-running
    instance before rebuilding, and checking cargo's own exit code directly
    rather than through a pipe, fixed it.
  - **Confirmed, on the real thing this time:** the same real dialog
    automation (no synthetic injection, no `invoke` patching) against this
    repo's own real analysis (539 files scanned, 354 parsed) on the rebuilt
    debug binary. With both parts of the fix in place: `table.className`
    is `"sr-only table-fixed"`, computed width **536.8px** (down from
    9,905px), and — the number that actually matters —
    `document.documentElement.scrollWidth` (1265px) now EQUALS
    `document.documentElement.clientWidth` (1265px): zero document-level
    horizontal overflow, where before there was 8,640px of it. All 7 tabs
    render at their correct, undisturbed positions; all 4 Cytoscape canvas
    layers measure at the expected ~1250-1265px width. The `main`/`body`
    scroll boxes still show the pre-existing ~15-16px gap — see below, this
    is KI-11, confirmed unrelated.
  - **KI-11 does NOT disappear, and is not this defect seen small — it is
    independently reproducible, with or without either half of this fix.**
    Checked directly, as asked: injected the exact same synthetic graph
    `graph-layout.spec.ts` uses, with and without the hub-dependent edges
    added below, into this same rebuilt binary, and polled `<main>`'s
    scroll box every 500ms for 20+ seconds with the graph tab open. It does
    not settle — it continuously alternates between exactly two states
    (`1250×744`-ish and `1265×743`-ish, the same two pairs of numbers KI-11
    was originally logged with) for as long as it is watched, on BOTH the
    hub and no-hub fixture, identically. This is a stronger, and different,
    characterization than "roughly 1 run in 3": it is not intermittent
    across mounts, it is continuously live within a single mount, and the
    prior spec's 150ms-apart double-read settle check most likely used to
    get lucky landing on two reads in the same phase more often than it now
    does — nothing here suggests the oscillation itself changed, only that
    this observation method finally caught it directly instead of sampling
    it. Because it reproduces byte-for-byte identically on data that never
    touches `GraphListFallback` at all, it is conclusively a third,
    still-unexplained mechanism, not a small-scale echo of either half of
    this entry's fix. Remains OPEN in `docs/KNOWN_ISSUES.md`, unchanged.
  - **The e2e spec itself cannot currently produce a clean pass, for a
    reason unrelated to this fix.** Running `e2e/graph-layout.spec.ts`
    against the rebuilt binary hit `mount 0: <main>'s scroll box never
    settled` — its `browser.waitUntil` (4s budget, 150ms-apart reads) never
    finds two matching consecutive reads, for the KI-11 reason above, before
    the containment assertion it guards ever runs. This is a pre-existing
    gate limitation surfaced by better direct observation, not a regression
    from anything in this entry — the direct CDP measurement above is what
    actually confirms the fix, precisely because it does not depend on that
    settle-detection succeeding first. Widening the settle timeout or
    tolerance to get the spec green is exactly the move this project has
    repeatedly declined to make for KI-11 already; it stays open here too.
  - **The fixture fix (`addHubDependentEdges` in
    `bench/graph/generate-synthetic-graph.ts`) is confirmed to reproduce
    the ORIGINAL (uncapped) table-width defect on synthetic data, closing
    the loop this entry opened.** Before either half of the source fix
    existed, injecting the hub-augmented synthetic result produced a real
    `document.documentElement.scrollWidth` inflation on this same binary;
    the no-hub fixture did not. The fixture now exercises the exact code
    path that broke — it was verified to fail before the fix and pass after,
    not merely assumed to.

- **Follow-up, same investigation — the same defect on the HEIGHT axis was
  real, is now fixed, and testing it disproved the leading hypothesis for
  the still-open width gap rather than confirming it.** Measuring a real
  CacttusEdu analysis (356 files parsed) for the graph rendering report
  below surfaced `document.documentElement.scrollHeight` at **12,142px**
  against an ~800px viewport, `main`/`body` both unaffected — the identical
  mechanism as the width entry above, on the other axis: 500 `<tr>` at
  ~24px each, `table-fixed` bounds column width, not row count, and the
  content cap bounds cell text, not row count either. Fixed by adding
  `MAX_FALLBACK_ROWS = 100` to `GraphListFallback.tsx`: files are now
  sorted by `importanceRank` (ascending — the table's own caption already
  claimed this ordering; the component was not actually doing it before,
  since `AnalysisResult.files` comes path-sorted from
  `analyze-assemble.ts`'s `buildFileNodes`, an incidental correctness fix
  alongside the cap) and sliced to the top 100, with the caption stating
  the omitted count and pointing at "Where is X?" for the rest — the same
  cap-and-say-so shape as `DEPENDENCY_LIST_CAP`, and for the same reason: a
  screen reader was never going to read 500 rows usefully either.
  - **Verified live, not just in tests:** rebuilt, cleared the analysis
    cache, ran a genuinely fresh `analyze_repo` against real CacttusEdu
    (not a cache hit), opened the graph tab exactly once, measured before
    touching anything further. Table rows: 500 -> 100. Table height: 12,048px
    -> 2,448px. `documentElement.scrollHeight`: 12,142px -> 2,542px. The
    residual ~1,748px is expected and bounded — 100 rows at this row height
    will always exceed a typical viewport height by roughly a constant
    amount, regardless of repo size, which is the actual design goal
    (bounded, not zero, and no longer scaling with `files.length`).
  - **The KI-11-causes-width hypothesis was tested and did not hold here.**
    The specific, testable claim: a ~12,000px vertical overflow forces a
    vertical scrollbar, which consumes ~15px of width, which could push an
    exactly-fitting layout into horizontal overflow — meaning the width
    symptom would be downstream of the height defect rather than a separate
    cause. Tested directly, using the exact sequence asked for (fresh
    analysis, cache cleared, graph tab opened once, measured immediately —
    no remounts): `document.documentElement.scrollWidth` equaled
    `clientWidth` BOTH before this fix (with the full 12,142px height
    overflow present) AND after (with it reduced to 1,748px). Zero width
    overflow in both states, in this environment. This does not mean the
    hypothesis is wrong in general — only that it did not produce the
    predicted effect here, so the height fix does not appear to have closed
    a width symptom that was never present on this machine to begin with.
  - **The width symptom remains unreproduced, now under every variation
    tried:** debug and release builds, windowed and maximized, 5 remounts
    and single-open, warm cache and cold cache, before and after the height
    fix. Genuinely open. Left there rather than guessed at further. Seen on
    the user's real install, not reproduced on this machine — the
    difference is environmental and neither side has found it yet. Next
    step is whatever the next real build surfaces, not further local
    hunting.

- **CacttusEdu's "Unknown project type" — Option B implemented: manifest and
  workspace discovery now recognize sibling packages with no root manifest
  as a monorepo, with three conditions attached to contain it.** Diagnosis
  (prior entries in this file, same investigation): `detectManifests` and
  `discoverWorkspacePackages` both read root-relative paths only;
  `discoverWorkspacePackages` additionally bailed to `[]` with no root
  `package.json#workspaces` / `pnpm-workspace.yaml` / `lerna.json` to read
  globs from. CacttusEdu (`backend/`, `dashboard/`, `cacttus-edu-front/`,
  each with its own real `package.json`, no root manifest at all) hit both
  gaps: "Unknown project type," zero dependencies, two Python scripts under
  `docs/` picked as entry points for a TypeScript monorepo. Chosen over the
  narrower alternative (extend `detectManifests` only) because entry points
  are half the user-visible defect and `detectEntryPoints`
  (`entry-points.ts`) already loops over `workspacePackages` — the narrower
  fix would have left the wrong entry points untouched.
  - **Condition 1 — the heuristic gate, tightened beyond "no root manifest,
    >= 2 siblings."** `inferSiblingPackages` (`resolve/workspaces.ts`) opts
    out entirely the moment a root `package.json` exists at all (an
    intentional single manifest is never reinterpreted), requires each
    candidate to carry a real `name` field, requires each candidate's file
    count to be at least 20% of the largest candidate's (`tools/` sitting
    beside a real, substantial `app/` does not count as a sibling merely
    because it also has a name and a package.json), and requires the
    surviving candidates together to cover a majority of the repo's own
    files (a repo whose files mostly live outside every candidate is not
    "these packages," whatever else sits alongside them). Uses the walk's
    existing-file count as the file-count basis, not "parsed source files"
    specifically — that classification runs later in `analyze.ts`'s
    pipeline than workspace discovery does, so it is not available yet; a
    deliberate simplification, stated as one in the code, not silently
    substituted.
  - **The negative case is planted as a fixture, not assumed handled.**
    `test/resolve/workspaces.test.ts` gained direct unit coverage for the
    exact tools/-beside-a-real-package shape (20 files vs. 1, correctly
    rejected by the size-ratio gate, not just the sibling-count gate), a
    second negative case where the majority of files sit outside every
    candidate, a single-sibling case, an unnamed-manifest case, and the
    positive case. `test/analyze/inferred-workspaces.test.ts` adds the same
    two shapes end-to-end through the real `analyze()` entry point (not
    `discoverWorkspacePackages` in isolation) — the fixture that failed on
    first write, exactly because file counts scaled differently than the
    unit test's, is worth naming: the earliest version of the tools/
    fixture used 6 files in the real package and 1 in tools/, which the
    ratio gate did not reject (1 file was still >= 20% of 6) — caught
    immediately by running it, not by inspection, which is the entire
    argument for planting these as executable fixtures instead of trusting
    the gate by construction.
  - **Condition 2 — resolution isolation, kept exactly as specified: the
    engine's opinion, not a workaround.** `WorkspacePackage` gained a
    `source: 'declared' | 'inferred'` field (`resolve/workspaces.ts`) — NOT
    part of the frozen contract; `analyze-assemble.ts`'s `buildRepoSection`
    already mapped only `{name, dirPath}` into
    `AnalysisResult.repo.workspacePackages`, so this stays engine-internal.
    Manifests, dependencies, `detectedType`, `sourceRoots`, and
    `entryPoints` all consume the full list, declared and inferred alike.
    Only `analyze.ts`'s `prepareAnalysis` filters: the resolver context
    (`buildResolverContext`, feeding `NodeResolutionContext.workspacePackages`,
    consumed by `node-resolution.ts`'s `resolveBareSpecifier`) is built from
    `workspacePackages.filter((p) => p.source === 'declared')` only. An
    inferred name colliding with a real npm dependency would otherwise
    silently misresolve a genuine external import as internal — a wrong
    edge, not a missing one, propagating into PageRank, importance, and the
    roadmap, which is the one failure mode in this whole change that would
    be invisible rather than merely incomplete. `node-resolution.test.ts`
    gained an explicit test proving `resolveNodeImport` itself has no
    opinion about `source` (isolation is `prepareAnalysis`'s job, not
    that function's) paired with `inferred-workspaces.test.ts`'s end-to-end
    version: a real cross-sibling bare import (`backend/src/index.ts`
    importing `'dashboard'`, an inferred package name) surfaces as an
    external dependency and produces no edge into `dashboard/`, through the
    real `analyze()` pipeline, not asserted in isolation.
  - **Verified additive against the 5 existing engine snapshots, not just
    argued to be:** regenerating all 5
    (`bun run scripts/generate-snapshots.ts`) changed exactly one —
    `mixed-monorepo` — and only in `stack.manifests` (gained
    `packages/core/package.json` and `packages/web/package.json`, which
    `detectManifests` now reads because it loops over `workspacePackages`
    unconditionally, not only when they are inferred) and `stack.dependencies`
    (gained `@acme/core`, a real dependency `packages/web/package.json`
    always declared and the engine never read). `detectedType`,
    `sourceRoots`, `workspacePackages`, `entryPoints`, `edges`, `files`, and
    the roadmap are byte-for-byte unchanged in that diff. `node-express`,
    `react-app`, `python-flask`, and `kitchen-sink` are byte-for-byte
    unchanged — none has a root-manifest-less sibling shape, so the new
    fallback path never fires for them, and none has workspace packages
    whose depth-level manifests were being missed before. `bun run
    verify:determinism` stays 20/20 after the regeneration.
  - **Condition 3 — fingerprint movement is accepted, not treated as a
    defect, and needs one line whenever this ships:** any repo whose
    manifests, dependencies, `detectedType`, `sourceRoots`, or
    `entryPoints` change under this fix gets a new fingerprint next open
    (`analyze-assemble.ts` hashes the whole assembled result, not just file
    contents), which means a one-time cold re-analysis for that repo, not a
    correctness problem. Residual, not yet acted on: whenever this is
    included in release notes, name it the same way an engine-version bump
    already is — affected repos re-analyze cold once.
  - **What `mixed-monorepo`'s changed snapshot actually was, because the
    mechanism matters more than the instance.** The fixture's
    `packages/web/package.json` declares `"dependencies": {"@acme/core":
    "workspace:*"}` — a real, ordinary cross-workspace dependency, present
    in the fixture since it was written, and `packages/web/src/index.ts`'s
    real `import` of `@acme/core` already showed up correctly as a graph
    edge (`detectEntryPoints`/resolution both walk workspace directories
    and always had). `detectManifests` alone never read
    `packages/web/package.json` at all — root-only, unconditionally, before
    this fix — so the one manifest that actually declared a dependency was
    never opened, and the fixture's own root `package.json` (`mixed-
    monorepo-fixture`, declaring only `workspaces: ["packages/*"]`, no
    `dependencies` of its own) legitimately had none to report. The
    committed snapshot's `stack.dependencies: []` was not a fixture with no
    dependencies; it was three subsystems (`discoverWorkspacePackages`,
    `detectEntryPoints`, `resolveNodeImport`) correctly knowing about
    `packages/web` and one (`detectManifests`) never being told. **This
    was never a defect confined to repos with no root manifest at all** —
    `mixed-monorepo` has an explicit `workspaces` declaration and was
    under-reporting anyway, for however long this fixture has existed.
  - **What this says about the other four snapshots, stated as a limit, not
    audited further.** All five snapshot tests passed, unchanged, for the
    entire time `mixed-monorepo`'s was quietly missing a real dependency —
    passing proved the engine's output was STABLE across runs, never that
    it was CORRECT. A snapshot recording wrong output is indistinguishable
    from one recording right output until something external forces a
    regeneration — the same shape as a vacuous gate, just on the output
    side instead of the assertion side. `node-express`, `react-app`,
    `python-flask`, and `kitchen-sink` stayed byte-identical when
    regenerated here, which rules out THIS specific mechanism (manifests
    skipped at workspace depth) for those four — none of them declares
    workspace packages with their own manifests, so the code path this fix
    touches was never reachable for them. It does not rule out some
    different, still-undiscovered mechanism doing the same thing elsewhere.
    That is the honest position and where this stops: noted, not chased —
    auditing the other four for unrelated silent gaps is a different task
    than the one this entry is closing.
  - **Condition 2, made structural rather than a filtering convention at
    one call site.** `resolve/workspaces.ts` gained
    `DeclaredWorkspacePackage` (a `WorkspacePackage` narrowed to `source:
    'declared'` exactly) and `declaredOnly()`, the only supported way to
    produce one. `NodeResolutionContext.workspacePackages`
    (`node-resolution.ts`) and `buildResolverContext`'s parameter
    (`analyze.ts`) both now type themselves as `readonly
    DeclaredWorkspacePackage[]`, not `readonly WorkspacePackage[]` — a
    future caller that builds a resolver context from the unfiltered
    (declared + inferred) list does not compile, full stop, rather than
    silently reintroducing the exact risk this entry names above. The
    runtime-assertion fallback ("prove the resolver context contains no
    inferred package") is no longer needed and was removed:
    `node-resolution.test.ts`'s prior test proving `resolveNodeImport`
    itself has no opinion about `source` could only be exercised by
    constructing a `DeclaredWorkspacePackage` with `source: 'inferred'`,
    which the type no longer permits without a deliberate cast — testing a
    scenario real callers cannot reach is not a test worth keeping.
    Replaced with a direct unit test of `declaredOnly()` itself
    (`workspaces.test.ts`), the one function that actually enforces the
    boundary now.

- **KI-11 is a scrollbar-reservation feedback loop — confirmed by
  measurement, fixed by removing the loop rather than damping it.** A user
  report against real CacttusEdu described the graph tab visibly
  oscillating roughly once a second: a black band appearing and
  disappearing to the right of the canvas, in sync with a horizontal
  scrollbar. Measured directly (100 samples, 150ms apart, 18.6s, real
  500-file analysis): `main`'s `offsetWidth`/`offsetHeight` never changed
  (1521x737, every sample) while `clientWidth`/`clientHeight` alternated
  between `1521x737` and `1506x722` — a constant ~15px delta on both axes,
  in lockstep with the graph's own container one level down. `offsetWidth`
  is unaffected by scrollbar reservation; `clientWidth` is defined to
  exclude it. An element whose own box never moves while its client size
  does, by exactly a scrollbar's width, is not resizing — it is gaining and
  losing a scrollbar. 48 transitions in 18.6s, no CSS `transition`/
  `duration-*` class on any of these elements, so the ~770ms full-cycle
  period is real measure/resize/repaint work, not an animation.
  - **The mechanism, not just the symptom:** `AppShell`'s `<main
    class="overflow-auto">` wraps every tab uniformly. The graph tab is the
    only one whose content (Cytoscape's canvas) actively resizes itself to
    match its own container on every layout pass (`useCytoscape.ts`,
    already named in this file's earlier entries). With no clipping
    boundary between the canvas and `main`, that resize can nudge `main`
    itself past its own box by a sub-pixel amount, `main` grows a
    scrollbar, the scrollbar consumes ~15px, the graph's container shrinks
    to fit inside the smaller space, the overflow reason disappears, the
    scrollbar is removed, and the container grows back — forever. Whether
    Cytoscape's specific `ResizeObserver` is the listener that re-triggers
    each cycle was deliberately not chased further (explicit instruction):
    the loop exists regardless of which listener closes it, and stopping
    the toggle matters more than naming its exact participant.
  - **Fixed by making the graph panel its own overflow-clipping boundary,
    not by reserving the scrollbar's space.** `overflow-hidden` added to
    `DependencyGraph.tsx`'s root `<section>` (both the populated and
    empty-state variants). Argued from the mechanism, not preference:
    `scrollbar-gutter: stable` on `main` would have stopped the VISUAL
    toggle by reserving 15px unconditionally, but `main`'s `overflow: auto`
    would keep re-evaluating overflow on every one of Cytoscape's resizes
    forever, on every tab, permanently, for a defect that only ever existed
    on one of them. `overflow-hidden` on the panel itself is a real CSS
    containment boundary: whatever Cytoscape does inside it can no longer
    be seen by `main`'s own scroll accounting, at all, regardless of what
    triggers a future resize — the mistake being fixed is "a
    self-resizing canvas panel sitting inside an auto-scrolling ancestor
    with nothing between them," not "a scrollbar that shows up too often."
    A canvas that manages its own pan/zoom never legitimately needs a
    native scrollbar; other tabs keep `main`'s `overflow-auto` completely
    unchanged, since they have real scrollable content this tab never did.
  - **Verified with the same measurement that found it, not a different
    one:** re-ran the identical 100-sample, 150ms-apart poll against the
    real CacttusEdu repo, real IPC path, on the rebuilt release binary.
    **Zero transitions.** `main.clientWidth`/`clientHeight` held at exactly
    `1521x737` for all 100 samples across 16.6s — the same two values that
    previously alternated now never move at all. Independently confirmed a
    second way: `e2e/graph-layout.spec.ts`, which previously could not even
    get past its own settle-detection because of this exact oscillation
    (the prior table-height entry named this as a residual), now passes
    cleanly — "stays within its available space across 8 remounts" — on
    real WebView2, real `tauri-driver`, no tolerance widened to get there.
  - **KI-11 is superseded by this entry, not merely referenced by it.** The
    original `docs/KNOWN_ISSUES.md` entry characterized this as an
    unexplained ~16px curiosity with no visible symptom, deliberately left
    open rather than tuned away. On a real repo it was a visible flicker in
    the app's headline feature, at ~15px amplitude — the same mechanism,
    not a coincidence at similar magnitude. Marked resolved in
    `docs/KNOWN_ISSUES.md`, with the confirmed zero-transition result above
    as the closing evidence, not an assumption.

- **The `@radix-ui/react-dialog` duplicate: fixed, and the choice on
  conflicting versions stated rather than left implicit.** Real cause,
  confirmed: `dashboard` and `frontend` (CacttusEdu) both independently
  declare it as a dependency; `detectManifests` reading every workspace
  directory (this file, above) made two entries for one logical dependency
  possible where a single root-only manifest read never could produce
  that. `buildDependenciesWithCounts` (`analyze-assemble.ts`) did — and
  still does — a straight 1:1 map with no dedup; the fix is at the source,
  `detectManifests` itself (`dedupeDependencies`, `manifests.ts`).
  - **The choice, stated:** keep the FIRST occurrence by
    `(ecosystem, name, scope)`, in the existing root-then-path-ascending
    iteration order — a later package's conflicting `versionSpec` is
    dropped, not merged, not flagged. `DependencyInfoValue` has no field
    for "which package(s) declared this" or "these specs disagree," so
    showing two unlabeled entries for one name is not a more honest answer
    than showing one — it just spreads the same missing information across
    two rows instead of one. If which-version-wins ever turns out to
    matter for a real repo, the honest fix is a schema change (represent
    that the specs disagree), not a smarter heuristic for picking a winner
    silently. Not done here — this fix restores "one dependency, one row,"
    the invariant that held by construction before this file's own change
    broke it.
  - Verified at both levels: a unit test in `stack.test.ts` pins the exact
    chosen behavior (two packages, two versions, one surviving entry, the
    first by sorted path) rather than just "no duplicates"; a second unit
    test confirms a real, non-bug case — the same name at different
    *scopes* (`dependencies` vs `devDependencies`) — is not conflated with
    it. `inferred-workspaces.test.ts`'s existing end-to-end fixture gained
    the same shared-dependency shape, proving the fix through the real
    `analyze()` pipeline, not just the unit-level function. All 5 engine
    snapshots and `verify:determinism` (20/20) stayed unaffected — none of
    the vendored fixtures has two manifests declaring the same package.

- **Entry points: filed, not fixed — a real, separate coverage gap, sized
  for a v0.1.5 conversation.** CacttusEdu's entry points still read as the
  two Python `docs/` scripts after Option B, and the reason is now
  precisely known rather than assumed cosmetic: `detectEntryPoints`
  correctly loops over the discovered workspace packages (it already did,
  before Option B existed) and finds nothing in any of the three, for
  three distinct reasons, not one:
  - `backend/package.json#main` is `"dist/server.js"`, and `dist` is in
    the engine's own default exclude list (`constants.ts`) — that path
    never exists in the walked file set regardless of workspace discovery.
    Its `scripts.start` (`"node dist/server.js"`) hits the identical wall.
    Its real entry, `src/server.ts`, is referenced only via `scripts.dev`,
    which `startScriptCandidate` does not check.
  - `dashboard` and `frontend` (CacttusEdu) declare no `main`, no `bin`,
    and no `scripts.start` (`dev`/`build`/`preview` instead). Their real
    entry, `src/main.tsx`, is the standard Vite convention — and
    `CONVENTION_FILES` (`entry-points.ts`) lists only
    `src/index.ts`/`src/index.js`/`index.ts`/`index.js`: no `.tsx`
    extension, no `main.*` name, at all.
  - Net effect: the Python module-guard scripts are not outranking real
    candidates by priority (`main` is priority 0, module-guard is priority
    5, the lowest) — there are no other candidates anywhere in the 500-file
    repo, so priority 5 wins by being the only bid.
  - This is a pre-existing gap in `entry-points.ts`'s heuristic coverage
    that Option B's workspace loop simply made reachable for the first
    time, not a defect in Option B or something "entryPoints correct
    themselves for free" failed to deliver on. Section 8.2's convention
    list predates common Vite tooling shapes; excluding `dist` is correct
    and deliberate, and `main`/`scripts.start` pointing into it is common
    for any repo that has not been built yet. Options, not decided here:
    recognize `scripts.dev` as an entry-point signal; extend
    `CONVENTION_FILES` to include `main.ts`/`main.tsx`/`src/main.ts`/
    `src/main.tsx`; or treat a `main`/`scripts.start` target that resolves
    into an excluded directory as a distinct, lower-confidence signal
    worth reporting differently from "no signal at all." Costing these
    (including whether any changes `EntryPointValue`'s shape or evidence
    strings, which are part of the frozen contract) is a v0.1.5
    conversation with its own options, not a rendering-fix side effect.
- **Tooling (2026-09-08) — `docs:check` had gone red on `main`, `commit:check`
  had gone inert, and the repair script reported success while fixing neither.**
  Found while running the gates for unrelated feature work. Recorded in full
  because the failure is not the stale hashes; it is that three separate
  safeguards each degraded quietly.
  - **What broke it.** `git filter-repo` has now rewritten this repository
    TWICE. The second run re-hashed all 62 commits from the Phase 0 scaffold
    forward — established from `.git/filter-repo/commit-map`, whose NEW column
    contains the current tip (`edc36a6`), so the rewrite necessarily postdates
    the newest commit (2026-09-07 23:39). Its `ref-map` also carries branches
    created on 2026-08-03, so it is not the 2026-07-28 run. Every SHA cited in
    `docs/` dated from the era between the two rewrites and stopped resolving.
  - **Why `rewrite-doc-shas.py` did not catch it.** The tool built for exactly
    this expanded each short SHA by asking `../onboard-prerewrite-backup.git`
    to resolve it, then looked the result up in the commit map. That backup
    predates the FIRST rewrite, so it has never contained the hashes the second
    rewrite invalidated. `resolve_in_backup` returned `None`, the replacement
    function returned the token untouched, and the script printed success —
    its only refusal condition was "zero references rewritten", and it was
    rewriting other things. A repair tool whose failure mode is silence is not
    a repair tool. It now expands short SHAs against the commit map's own keys
    by prefix (the map always covers the era being repaired, with no external
    repository involved), imports `docs-check.py`'s classifier so the repair
    covers exactly what the gate examines, and EXITS NON-ZERO when a
    gate-checked reference is still unresolvable.
  - **The gate was green over six wrong citations.** `docs:check` only examines
    a hash when a citing phrase appears within 220 characters. Six citations
    used phrasings the list did not contain — a smoke run recorded as
    "tag -> <sha>", a scope written as "from boundary <sha> forward", a fix
    cited as "(<sha>, two commits later)" — so they were stale and unreported.
    `tag ->`, `tag →`, `boundary` and `commits later` are now citing contexts.
    This is the same defect as an inert exemption, one level up: the check
    proving what it happens to look at rather than what matters.
  - **`commit:check` was inert, and repairing it surfaced a real violation.**
    `GATE_LANDED` was the full hash of the commit that added the script. After
    the rewrite it resolved to nothing, and the script's own guard against a
    non-resolving boundary (correctly refusing rather than silently widening
    scope) meant criterion 28's CI job examined ZERO commits. Repointed to
    `a203731`, it examines 62 — and reports `8d7df06` ("fix(graph,engine):
    bound the sr-only table on both axes; …") with a 114-character subject
    against a 100 maximum. That commit is contained in tag **v0.1.4**, so the
    two ways out — amend the subject (another history rewrite, invalidating
    the tag and every hash repaired here) or record a documented exception —
    are both product decisions, not tooling ones. LEFT RED DELIBERATELY and
    escalated rather than papered over; criterion 28 is not satisfied today.
  - **Dead hashes were in code, not only prose.** Besides the eight prose
    citations: `GATE_LANDED` in `commit-message-check.py`; three strings in
    `criteria-map.py`, which GENERATES `docs/CRITERIA_MAP.md` (fixing only the
    generated file would have been reverted by the next `criteria:map` run, and
    did in fact break `criteria:check-drift` until the generator was fixed too);
    a scope comment in `.github/workflows/ci.yml`; and an illustrative example
    in `docs-check.py`'s own docstring.
  - **One citation could not be repaired honestly.** A commit cited for having
    a 103-character subject resolves in no surviving map, and no commit in the
    current history has a subject of that length. Rather than guess a mapping
    or leave a hash that looks live, the fact is now stated in prose without a
    hash, in both `DECISIONS.md` and `commit-message-check.py`'s scope comment.
  - **`docs/COMMIT_MAP.md` was itself stale and is now composed, not
    regenerated.** Its right-hand column held post-first-rewrite hashes, which
    the second rewrite killed — the translation table for the audit trail no
    longer translated to anything that exists. Regenerating it from the current
    map would have lost the original pre-2026-07-28 hashes entirely, since no
    surviving map contains them. Each published row is instead carried forward
    through the second map (62/62 compose, verified), and a second table lists
    the between-rewrites hashes, which is the era the broken citations came
    from.
- **Criterion 28 (2026-09-08) — `8d7df06` is exempted from `commit:check` by
  hash, and the criterion goes green with the exemption named in
  `docs/CRITERIA_MAP.md`.** Repairing the inert gate (see the tooling entry
  above) surfaced one real violation: a 114-character subject against a
  100-character maximum, in a commit contained in tag **v0.1.4**.
  - **Why exempt rather than amend.** Amending means a third `git filter-repo`
    run. That invalidates v0.1.4's tag, every SHA reference repaired earlier
    the same day, and `docs/COMMIT_MAP.md` — trading a working audit trail for
    a formatting fix with no user impact. The violation is real but cosmetic;
    the cost of "fixing" it is not.
  - **It is a hash, not a rule.** Boundary-forward enforcement is unchanged and
    no rule was relaxed: `MAX_SUBJECT_LENGTH` still applies to every commit in
    scope. `EXEMPT_COMMITS` names one commit, with its reason stored beside it,
    and `commit:check` PRINTS the exemption and its justification on every run
    — a gate that goes green by ignoring something should say what it ignored.
  - **The exemption breaks rather than rots.** This file spent the same day
    repairing references that had degraded silently, so an exemption that could
    outlive its commit would be the same defect wearing a different hat. Three
    guards each FAIL the gate: (1) an exempted hash that no longer resolves —
    which is precisely what a future history rewrite would produce — with an
    error naming `docs/COMMIT_MAP.md` as the way to re-point it; (2) a hash
    outside the enforced range; (3) a hash whose subject now conforms, i.e. an
    inert exemption, the same check `docs-check.py` applies to its own context
    phrases. `exemption_self_test()` proves all three fire, and guard 1 was
    additionally verified by hand: substituting a dead hash turns the gate red
    with the intended message.
  - **The original note said "with NO exceptions list."** That reasoning was
    about RULES and still holds — an allowlist that grows one argued-away
    violation at a time is worthless. It did not survive contact with a commit
    inside a published tag, where the remedy costs more than the defect. The
    note has been rewritten rather than quietly contradicted.
- **Phase 8, AMENDMENT (2026-09-08) — the dependency graph opens on a bounded
  "entering view" instead of on the whole repo. This changes what
  `GRAPH_AUTO_COLLAPSE_THRESHOLD = 600` means and what Section 11's graph
  budgets measure.** This is an amendment against Section 9 Phase 8 and
  Section 11, not a config tweak, and it is recorded here because the spec's
  own numbers no longer describe the shipped behaviour.
  - **The finding it comes from.** Phase 8's rule was "auto-collapse
    directories at depth >= 2 WHEN node count > 600" — show every file by
    default, collapse only once the graph got expensive. That rule optimises
    render cost, and it left the default view of any repo under 600 nodes as
    one fitted force-directed layout of every file at once. Such a view is
    not readable at any zoom, and no amount of tuning the label-hiding
    threshold (0.35) or the collapse threshold (600) makes it readable: a
    node-link diagram's legibility collapses well below 500 nodes at real
    edge density. The problem was never those constants; it was that
    "everything at once" was the default state at all.
  - **The rule now.** `computeEnteringCollapsedDirectoryPaths`
    (`collapse.ts`) always collapses, whatever the repo's size, choosing the
    DEEPEST level of detail whose visible node count still fits
    `GRAPH_ENTERING_VIEW_MAX_NODES = 60`. A repo small enough to fit whole
    still shows every file (the set comes back empty — strictly the old
    behaviour for small repos). Expanding is deliberate: tapping a directory
    (`toggleDirectory`), a keyboard move revealing a file (`revealPath`), or
    the toolbar's "Expand all". "Collapse all" now means "back to the
    entering view", recomputed from the `AnalysisResult` rather than
    remembered, so it is the same view however deep the user drilled.
  - **`GRAPH_ENTERING_VIEW_MAX_NODES = 60` is a judgment call, not a derived
    number.** fcose fits its result to the viewport, so on a maximised
    ~1600x900 canvas 60 nodes leaves each roughly a 180x150px cell — enough
    for the node plus its label without neighbours colliding. It was
    validated by screenshot against CacttusEdu and is guarded against
    regression by `collapse.test.ts`, which asserts that the entering view of
    a real 500-file repo shape never exceeds it. On CacttusEdu (500 files, 90
    directories, engine-measured 2026-09-08) the rule resolves to depth 1:
    **11 visible nodes** — 6 top-level directories and 5 repo-root files.
  - **What `GRAPH_AUTO_COLLAPSE_THRESHOLD = 600` means now.** It no longer
    gates collapse; nothing does, because collapse is unconditional. The
    constant survives under the name `GRAPH_DRAFT_LAYOUT_NODE_THRESHOLD` in
    `useCytoscape.ts`, with the one job it still does: the visible-node count
    past which fcose drops to `quality: 'draft'`. A graph only reaches that
    size now by the user explicitly pressing "Expand all". The old name is
    gone from the codebase; Phase 8's paragraph still carries it, which is
    why this entry exists.
  - **What the Section 11 budgets should measure.** `graphFirstPaint1kMs`,
    `graphPanP95_1kMs` and `graphPanP95_5kMs` were written when 1,000/5,000
    nodes on screen was the default state. That is now a state users reach
    only on purpose, so those budgets were measuring something almost nobody
    sees. They are renamed in `bench/budgets.json` to
    `graphEnteringViewFirstPaint1kFilesMs` /
    `graphEnteringViewPanP95_1kFilesMs` / `graphEnteringViewPanP95_5kFilesMs`
    — same numbers, now honestly labelled as measuring the entering view of a
    1k/5k-FILE repo. Measured after this change (`bun run bench:graph`,
    headless Edge, 2026-09-08): first paint **140.2 ms** at 1,000 files and
    **81.7 ms** at 5,000 files against a 1,500 ms budget, pan p95 16.9 ms at
    both — roughly a tenth of the allowance, which is the point: what the
    budget measures got cheap because the entering view is bounded (13
    visible nodes for both synthetic repos). Two new entries,
    `graphExpandAllFirstPaint1kMs` and `graphExpandAllPanP95_5kMs`, name the
    deliberate all-nodes state and are marked not-yet-measured (the same
    convention `webviewHeap5kMb` already uses): that state is what the
    original numbers were really about, and it now needs its own bench
    scenario rather than inheriting the default one's.
- **Phase 8, AMENDMENT (2026-09-08) — the keyboard model and the canvas were
  diverging, and criterion 20 could not see it.** `keyboard-nav.ts` traverses
  the FULL `AnalysisResult` (every file, by importance rank); the canvas shows
  only what is currently expanded. Before this change `focusNodeById` did
  `cy.getElementById(id)`, found nothing for a file inside a collapsed
  directory, and returned silently — so `ArrowDown`/`[`/`]` announced a file
  through `aria-live` that no sighted user could see, and moved no camera.
  That was already true above 600 nodes; collapsed-by-default would have made
  it the normal case. `UseCytoscapeApi.focusNodeById` is therefore replaced by
  `focusPath(path)`, which expands whatever hides the target first
  (`collapse.ts`'s `revealPath` — the whole collapsed-ancestor chain, not just
  the shallowest one `resolveVisibleNodeId` reports) and centres only once the
  reveal layout has settled. `DependencyGraph.test.tsx` now asserts the
  focused node is really on the canvas (materialised AND not
  `hidden-by-collapse`) after a keyboard move — the assertion criterion 20's
  axe and keyboard checks structurally cannot make, since both can pass while
  the canvas shows nothing. `GraphListFallback` is unaffected: it renders from
  the `AnalysisResult`, never from the Cytoscape core, and never did.
- **Phase 8, BUG FIX (2026-09-08) — an animated fcose run does not reliably
  emit `layoutstop`, which silently hung first paint and every drill step.
  THE FIX: `animate: false` for the graph layout, unconditionally.** This is a
  shipped-code defect, not an observation: any repository whose top-level areas
  do not import each other lands on it, which is most monorepos.

  **THE FINDING IS THAT THE OBVIOUS PREDICATE IS WRONG — read this before
  narrowing the flag again.** An unconditional `animate: false` looks
  over-broad, and the natural instinct is to re-scope it to "only the case that
  actually hangs". That instinct was followed once already, and shipped: the
  first fix animated only when `visibleEdgeCount > 0`, on the reasoning that a
  layout with edges has forces and will converge. It was WRONG. A drill step
  into `backend` — which HAD visible edges — hung exactly the same way, so
  `layoutstop` never fired, and the packing pass silently never ran. The
  property the hanging graphs actually share is a top level with no edges
  ACROSS it, which is not the same as having no edges, and there is no cheap
  runtime predicate for "will fcose converge on this graph". Nothing short of
  running the layout answers it. Re-narrowing therefore needs a reproducible
  characterisation of the hang, not a plausible-sounding condition; without
  one, the flag stays unconditional. The cost is a brief motion on drill; the
  purchase is an event that always fires, which four separate mechanisms
  depend on.
  Measured
  live in the webview against CacttusEdu's entering view (11 visible nodes, 0
  visible edges): `layoutstart` and `layoutready` fire, `layoutstop` never
  does, still nothing after 9 seconds; the identical graph with
  `animate: false` completes and fires all three. No forces, no convergence.
  Everything downstream waits on that event — `isReady`, the entering-view
  fit, and reveal-then-centre — so all three hung. An edgeless view is not a
  corner case: a monorepo of independent workspaces has no cross-directory
  imports at all (all 1,227 of CacttusEdu's edges live inside a single
  top-level directory, so its entering view has exactly zero).

  **Why it was never seen before.** Phase 8's own rule sets `animate: false`
  whenever `prefers-reduced-motion` is set, so anyone testing with that
  preference on — which is the configuration criterion 21 is checked under —
  took the working path every time. The bug was invisible to exactly the
  people most likely to be exercising the graph deliberately, and visible only
  to a default-settings user opening a repo whose workspaces are independent.
  A gate that tests the accessible path can hide a defect on the default one.
- **Phase 8, AMENDMENT (2026-09-08) — the entering-view fit runs from a React
  effect, not from `layoutstop`.** At `layoutstop` Cytoscape is still working
  from the container size it captured when the layout began, which during a
  tab switch is not the final one: fitting there computed zoom 0.96 where the
  settled container needs 0.68, leaving the largest directory boxes hanging
  off the bottom edge of the panel. `fitToVisible` is called from an effect
  keyed on `isReady`, which React runs after the DOM commit, when the panel
  has its real height. (A `requestAnimationFrame` deferral inside the
  `layoutstop` handler was tried first; its callback never ran at all.)
- **Phase 8, AMENDMENT (2026-09-08) — the Cytoscape stylesheet is now
  theme-aware.** A canvas gets no CSS, so every colour in `graph-style.ts` is
  a literal and none of the app's `dark:` Tailwind variants reach it. That was
  survivable while the graph was a field of coloured file dots whose labels
  were incidental. It is not survivable now that collapsed DIRECTORY boxes and
  their labels are the entering view's entire content: rendered against the
  app's dark theme (which is `prefers-color-scheme`-driven — this app sets no
  `dark` class), the old fixed palette drew near-black labels on dark boxes,
  i.e. the entering view was "legible" only in a light theme nobody was
  running. `resolveGraphPalette()` picks a light or dark `GraphPalette`, and
  `useCytoscape` rebuilds the stylesheet on a `prefers-color-scheme` change.
- **Phase 8, AMENDMENT (2026-09-08) — collapsed directories are sized and
  coloured, and `cytoscape-expand-collapse`'s cue layer is off.** A
  lazily-collapsed directory has no children in the core, so Cytoscape gave it
  the default node size: in an entering view that is mostly collapsed
  directories, every directory rendered as the same small grey blob whatever
  it contained. Their box area is now proportional to `descendantFileCount`
  and tinted by the module owning most of their files
  (`computeDominantModuleByDirectory`), so "this box holds half the repo" is
  legible before reading a single label. Separately, the extension's
  `cueEnabled` is now `false`: its cues collapse a node by hiding children it
  can see, which would be a SECOND source of truth for collapse state
  alongside `collapsedDirsBox` — and it already could not expand a
  lazily-collapsed directory, whose children it has never seen. A11 keeps the
  extension registered; `toggleDirectory` owns the interaction, in both
  directions, so drilling is reversible. The cost is that the +/- cue is gone,
  leaving the label ("backend / 138 files") and the border style to signal
  "clickable" — worth a designer's eye.
- **Phase 8, FIX (2026-09-08) — top-level boxes are packed deterministically
  when the top level has no edges (`pack-layout.ts`).** This closes the two
  residuals this change originally filed, which had one root cause: fcose
  positions nodes by forces, and when no edge joins two top-level nodes there
  are no forces at that level. The visible results were an arbitrary scatter
  with large empty regions, and — worse, because it is WRONG rather than untidy
  — unrelated root files coming to rest INSIDE an expanded directory's compound
  box, drawing containment that does not exist. Measured on CacttusEdu after
  expanding `backend`: four root-level nodes inside its box; zero after.
  `shelfPack` places the boxes tallest-first in rows, ties broken by id so the
  same repo always packs the same way. It runs only when no visible edge
  crosses two top-level nodes, so an arrangement that does carry force
  information (after "Expand all", say) is left alone, and it never touches
  what is INSIDE a compound — fcose keeps the job it is good at.

  **Where it runs is load-bearing.** Positions written from inside a
  `layoutstop` handler are overwritten by the layout that just emitted it: the
  packed arrangement was computed and applied, and the canvas still rendered
  fcose's. The initial paint therefore packs from a React effect (after the
  commit) and drill/wholesale relayouts from a macrotask. This is the same
  lesson as the entering-view fit, which had to move for the same reason —
  `layoutstop` is not "the layout has finished writing".
- **Phase 8, AMENDMENT (2026-09-08) — remaining residuals, filed not fixed.**
  (a) The viewport label budget (`GRAPH_VIEWPORT_LABEL_BUDGET = 25`) ranks by
  importance but does no collision detection, so two equally low-ranked
  root-file labels can still overlap. (b) The graph does not re-fit when the
  panel is resized; only the entering view and packed relayouts are fitted.
  (c) INSIDE an expanded directory, sibling collapsed sub-directory boxes can
  still slightly overlap each other — the packer deliberately does not touch a
  compound's interior, so fcose's arrangement stands there. Visible on
  CacttusEdu's `backend` (`prisma` and `src` touch). Less serious than the
  cross-compound case it replaced: it is untidy, not a false relationship.
- **Phase 9 — noted, not decided: `ModuleMap` and the graph's entering view
  may now be converging.** With the graph opening on a directory tree rather
  than a file cloud, the first thing the graph tab shows and the thing the
  Module map tab shows are both "the repo's top-level areas, one box/card
  each". They are not identical — modules are derived (Section 8.6's
  clustering), directories are structural, and CacttusEdu has 17 modules
  against 6 top-level directories — but the overlap in what a newcomer
  actually *does* with them is real. Worth answering deliberately (are these
  two views of one thing, or two different things?) before either grows
  further.
- **Phase 8, BUG FIX (2026-09-08) — the fit was conditional on the packer, so
  every repository whose top-level directories import each other never fitted
  at all except on first paint.** Reported from the shipped installer, then
  diagnosed against the release binary over CDP rather than a dev server —
  the two previous verifications used a dev server and missed it twice.
  - **The defect.** `settleAfterLayout` read
    `if (packTopLevelIfUnforced(cy)) fitToVisible(cy)`. The packer declines,
    correctly, whenever a visible edge crosses two top-level nodes. So on any
    such repo the drill path and the wholesale path (Expand all, Collapse all,
    every tap, every keyboard reveal) ran a layout and then never corrected
    the viewport. Derived audit of the three layout paths: initial paint fitted
    unconditionally; drill and wholesale were both gated. Two of three.
  - **Why testing never caught it.** Not fixture bias — audited, and two of
    four fixtures (`sample-analysis.json`, `buildRepoShapedResult`) already
    exercise the declining branch. The reason is that **no unit test can
    observe a fit at all**: jsdom has no canvas, `supportsCanvasRendering()` is
    false, the core runs headless, and `fitToVisible` bails on a 0x0
    container. The branch ran; its consequence was invisible. The invariant —
    *after any layout on any path, the content bounding box lies inside the
    viewport* — is therefore asserted in `bench/graph`'s browser harness,
    which has a real canvas, and `bench:graph` now FAILS when it does not
    hold. It is blind to which branch ran, which is the point.
  - **The aspect problem, fixed at its source.** fcose produced a roughly
    SQUARE layout that was then fitted into a ~2.35:1 panel. The fit is limited
    by the short axis, so two thirds of the width went unused and the zoom fell
    to 0.409 — where a 13px directory label renders at 5px: drawn, and
    unreadable. `layoutBoundingBox` now constrains the layout to a box with the
    PANEL's aspect, scaled to the node count, so the mismatch never arises.
  - **The readability floor, derived rather than picked.**
    `GRAPH_MIN_READABLE_ZOOM = 0.75` — directory labels are 13px, 10px is the
    conventional floor for legible UI text, 10/13 = 0.77, rounded down so the
    boundary does not thrash. `readableNodeBudget` inverts the fit arithmetic
    to answer "how many nodes can this panel show and still be read", and the
    entering view takes the smaller of that and the 60-node ceiling. On a
    1521x648 panel that is ~48. The collapsed view exists so it can be READ, so
    a panel that cannot show the ceiling legibly shows fewer nodes rather than
    smaller ones.
  - **`fit: false` on the layout is not "no fit".** Every layout is now
    followed by an unconditional `fitToVisible`. The layout's own `fit` uses
    the container as measured when it STARTED — the stale value that put boxes
    off the panel edge — so the settle step owns fitting. This supersedes the
    earlier choice to preserve the viewport across a drill for spatial memory:
    a viewport the user cannot read is worth nothing.
  - **Verified on the reported repository, in the shipped binary.** CacttusEdu,
    driven through the real UI (a raw `analyze_repo` invoke cannot retarget the
    app — it bypasses the store that owns repo state): entering view 11 nodes,
    6 directories labelled `backend / 138 files`, `cacttus-edu-front / 239
    files`, `dashboard / 104 files`, `docs / 9 files`, `deploy / 4 files`,
    `.claude / 1 file`; zoom 1.41, so those labels render at 18px; content
    inside the viewport. Collapse all holds the same. Residual: the canvas is
    still ~50% empty, which is legible but not yet well-composed.
