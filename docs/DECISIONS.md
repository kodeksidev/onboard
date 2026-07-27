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
