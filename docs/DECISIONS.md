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
- **Phase 8 — `bench:graph` reports headless Cytoscape timings and explicitly
  does not claim to measure the gate's real budgets.** Attempted a genuine
  browser-based measurement first: `playwright-core` driving the machine's
  installed Microsoft Edge via `executablePath` (no browser download
  needed). The Edge process launched and exited immediately (exit code 255)
  every time, and the Vitest/jsdom environment has no working 2D canvas
  either (no `canvas` npm package) — so no real compositor is reachable
  from this environment at all, by either route. Rather than fabricate a
  first-paint or frame-time number, `bench/graph/run-bench-graph.ts` prints
  this gap explicitly, reports the real Section 9 Phase 8 budget numbers as
  the *target* (not a result), and measures — genuinely — headless
  `cytoscape` + `cytoscape-fcose` + `cytoscape-expand-collapse` construction
  and layout-completion time against the same deterministic synthetic
  graphs Phase 11's real, browser-based `bun run bench` (Section 11) will
  use at the same node counts. The script still exits non-zero on a true
  hang (300s sanity ceiling) so a real regression is not silent.
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
