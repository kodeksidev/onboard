# The engine contract

The analysis engine is a separate process that speaks newline-delimited
JSON-RPC 2.0 over stdio. This document is the contract: what it is asked, what
it returns, what can go wrong, and every constant that shapes its output.

The schemas themselves live in `packages/contract` and are the single source of
truth. `contract:check-drift` fails if the emitted schema and the committed one
disagree, so this document describes a contract that cannot silently drift from
the code — but the schema, not this page, is authoritative.

## Invoking the engine

```
onboard-engine --grammars-dir <path to tree-sitter wasm grammars>
```

The grammar directory is passed explicitly and has no fallback. An engine
started without it cannot parse anything, and this is deliberate: a silent
default would let a build ship with missing grammars and still appear to work,
returning a structurally valid but entirely empty analysis. That failure mode
has occurred twice in this project's history, which is why the E2E suite and the
installed-app check both assert on *substance* (symbol and edge counts) rather
than on a clean exit.

## Methods

| Method | Purpose |
|---|---|
| `engine.version` | Handshake. Mismatch is fatal — see `E_ENGINE_VERSION_MISMATCH`. |
| `engine.analyze` | Analyse a repository; returns an `AnalysisEnvelope`. |
| `engine.search` | Query an existing analysis. |
| `engine.shutdown` | Terminate cleanly. |

`engine.analyze` carries a much longer timeout than the others, because it is
the only call whose cost scales with the repository. Progress arrives as
notifications on the same channel.

## What `engine.analyze` returns

An `AnalysisEnvelope` wrapping an `AnalysisResult` containing, in outline:

- **files** — every analysed file, with a repo-relative POSIX path, a
  `classification` (its inferred role), and an importance score.
- **edges** — import relationships between files.
- **symbols** — exported and declared symbols, with their declaring line.
- **modules** — clusters of related files.
- **roadmap** — a suggested reading order for someone new to the repository.
- **stats** — counts, including `filesParsed`.
- **diagnostics** — per-file problems, e.g. `PARSE_FAILED`.

Two properties are asserted by tests rather than assumed:

- **Every path is repo-relative POSIX**, on every platform. No absolute paths,
  no backslashes.
- **The result contains nothing machine-specific** — no timestamp, no duration,
  no absolute path, no hostname. This is what makes the determinism gate
  possible: the same repository analysed twice, on different machines, produces
  byte-identical output.

## Error codes

Every code the application can surface. The Rust side is authoritative
(`apps/desktop/src-tauri/src/error.rs`); the user-facing text for each lives in
`apps/desktop/src/copy/messages.ts` and is asserted byte-exactly by tests.

An `AppError` carries a `code`, a `message` (the sentence a user reads), an
optional `detail`, and an optional `path`. **Raw OS and provider strings belong
in `detail`, never in `message`** — a rule this project has broken once and now
tests for.

### Analysis and filesystem

| Code | Means |
|---|---|
| `E_PATH_NOT_FOUND` | The chosen folder no longer exists. |
| `E_NOT_A_DIRECTORY` | The chosen path is a file. |
| `E_PERMISSION_DENIED` | The folder cannot be read. |
| `E_NO_SUPPORTED_FILES` | Nothing in the folder is a language the engine parses. |
| `E_REPO_TOO_LARGE` | More source files than `MAX_REPO_FILES`. |
| `E_ANALYSIS_IN_PROGRESS` | A second analysis was started while one runs. Refused, not queued. |
| `E_NO_ANALYSIS` | A query arrived with no analysis loaded. |
| `E_FILE_TOO_LARGE` | The viewer was asked for a file above `MAX_VIEWER_FILE_BYTES`. |
| `E_PATH_ESCAPES_REPO` | A path traversed outside the repository. Refused. |

### Engine lifecycle

| Code | Means |
|---|---|
| `E_ENGINE_NOT_STARTED` | The engine was never spawned — missing from the installation, or the OS refused to execute it. Distinct from a crash: there was no process. |
| `E_ENGINE_CRASHED` | A running engine died mid-work. Retrying usually helps; the cache keeps completed files. |
| `E_ENGINE_TIMEOUT` | The engine stopped responding and was killed. |
| `E_ENGINE_VERSION_MISMATCH` | The handshake reported a contract version the shell does not speak. |

### Settings and secrets

| Code | Means |
|---|---|
| `E_INVALID_SETTINGS` | Settings on disk failed validation. |
| `E_KEYCHAIN_UNAVAILABLE` | The OS keychain could not be reached. |

### AI (only reachable with AI enabled)

| Code | Means |
|---|---|
| `E_AI_DISABLED` | AI is off, or no key is retrievable. Checked before any other AI work. |
| `E_AI_KEY_INVALID` | The provider rejected the key. |
| `E_AI_RATE_LIMITED` | The provider rate-limited the request. |
| `E_AI_NETWORK` | The provider could not be reached. |
| `E_AI_MODEL_NOT_FOUND` | The configured model does not exist for that provider. |
| `E_AI_OLLAMA_UNREACHABLE` | A local Ollama instance is not answering. |
| `E_AI_PAYLOAD_UNSAFE` | Redaction could not prove its own output clean. The request is abandoned — it fails closed. |
| `E_AI_CITATION_REJECTED` | The answer cited a path absent from the index; rejected whole. |

---

# Constants

Every tuning constant the engine exposes, from
`packages/engine/src/constants.ts`. They are listed here in full because a
number that shapes user-visible output and lives only in code is a number
nobody can review. `docs:check` asserts that each one is named somewhere in
this documentation, so a new constant cannot arrive undocumented.

## Repository scanning

| Constant | Value | Meaning |
|---|---|---|
| `MAX_REPO_FILES` | 25,000 | Above this, analysis is refused with `E_REPO_TOO_LARGE`. |
| `MAX_PARSE_BYTES` | 1,572,864 | Files larger than this are not parsed. |
| `MAX_VIEWER_FILE_BYTES` | 2 MiB | Above this the viewer declines to render. |
| `BINARY_CHECK_BYTES` | 8,192 | Prefix inspected to decide whether a file is binary. |
| `HARD_IGNORE_DIRS` | list | Directories never walked (dependency and build directories). |
| `HARD_IGNORE_GLOBS` | list | Path globs never walked. |
| `MINIFIED_MAX_LINE_LENGTH` | 5,000 | A single line this long marks a file minified. |
| `MINIFIED_MEAN_LINE_LENGTH` | 400 | Mean line length that marks a file minified. |

## Classification

How a file's role is inferred. Role feeds ranking, the roadmap, and search
penalties, so these lists are load-bearing rather than cosmetic.

| Constant | Meaning |
|---|---|
| `TEST_SEGMENT_PATTERN` | Path segment marking a test directory. |
| `TEST_BASENAME_PATTERNS` | Filename patterns marking a test file. |
| `FIXTURE_SEGMENTS` | Directories holding fixtures or mocks. |
| `STYLE_EXTENSIONS` | Stylesheet extensions. |
| `DOCS_EXTENSIONS` / `DOCS_SEGMENT` | Documentation files and directory. |
| `CONFIG_FILENAMES` / `CONFIG_EXTENSIONS` / `CONFIG_SEGMENT` | Configuration by name, extension, and directory. |
| `GENERATED_HEADER_MARKERS` | Header text marking generated code (`@generated`, `DO NOT EDIT`). |
| `GENERATED_HEADER_CHECK_LINES` | How many leading lines are searched for those markers. |
| `GENERATED_BASENAME_INFIXES` | Filename infixes marking generated code. |
| `ROUTE_SEGMENTS` | Directories holding routes. |
| `CONTROLLER_SEGMENTS` | Controllers, handlers, views, resources. |
| `SERVICE_SEGMENTS` | Services, use-cases, domain, core, business logic. |
| `MODEL_SEGMENTS` | Data models. |
| `COMPONENT_SEGMENTS` | UI components. |
| `PASCAL_CASE_TSX_PATTERN` | A PascalCase `.tsx` file is treated as a component. |
| `HOOK_BASENAME_PATTERN` / `HOOK_SEGMENT` | React hooks by filename and directory. |
| `STORE_SEGMENTS` | State stores, reducers, slices, context. |
| `UTIL_SEGMENTS` | Utility directories. |
| `SCRIPT_SEGMENTS` | Scripts, bin, tools. |
| `ASSET_EXTENSIONS` | Static assets. |

## Modules

| Constant | Value | Meaning |
|---|---|---|
| `MODULE_MIN_FILES` | 3 | Fewer files than this is not reported as a module. |
| `MAX_MODULES` | 40 | Upper bound on modules reported. |

## Importance ranking

| Constant | Value | Meaning |
|---|---|---|
| `PAGERANK_DAMPING` | 0.85 | Standard PageRank damping factor. |
| `PAGERANK_MAX_ITERATIONS` | 100 | Iteration cap. |
| `PAGERANK_EPSILON` | 1e-6 | Convergence threshold. |
| `PAGERANK_PRECISION` | 6 | Decimal places retained — rounding is what makes scores reproducible across platforms. |
| `W_PAGERANK` | 0.55 | Weight of PageRank in the importance score. |
| `W_IN_DEGREE` | 0.3 | Weight of how many files import this one. |
| `W_ROLE` | 0.15 | Weight of the file's inferred role. |
| `ROLE_BOOST_ENTRYPOINT` | 1.0 | Role boost for an entrypoint. |
| `ROLE_BOOST_HIGH` | 0.8 | Boost for `ROLE_BOOST_HIGH_CLASSIFICATIONS`. |
| `ROLE_BOOST_HIGH_CLASSIFICATIONS` | route, controller, service, store | |
| `ROLE_BOOST_MEDIUM` | 0.6 | Boost for `ROLE_BOOST_MEDIUM_CLASSIFICATIONS`. |
| `ROLE_BOOST_MEDIUM_CLASSIFICATIONS` | model, component, hook | |
| `ROLE_BOOST_LOW` | 0.3 | Boost for `ROLE_BOOST_LOW_CLASSIFICATIONS`. |
| `ROLE_BOOST_LOW_CLASSIFICATIONS` | util, config | |
| `TOP_IMPORTANT_FILES` | 20 | How many files the overview highlights. |

## Roadmap

| Constant | Value | Meaning |
|---|---|---|
| `MAX_ROADMAP_SEEDS` | 5 | Starting points considered. |
| `MAX_ROADMAP_DEPTH` | 12 | Traversal depth cap. |
| `ROADMAP_TARGET_LENGTH` | 12 | Steps aimed for. |
| `ROADMAP_MAX_LENGTH` | 25 | Hard cap on steps. |
| `ROADMAP_DEPENDS_ON_CAP` | 8 | Dependencies listed per step. |
| `MAX_UNREACHED_STEPS` | 10 | Cap on files reported as unreached. |
| `ROADMAP_LEAF_UTILITY_SEGMENTS` | list | Directories treated as leaf utilities, not roadmap steps. |
| `ROADMAP_LEAF_UTILITY_CLASSIFICATIONS` | util, config | Roles treated the same way. |

## Cache and identity

| Constant | Value | Meaning |
|---|---|---|
| `CACHE_SCHEMA_VERSION` | 2 | Bumping this invalidates every cached analysis. |
| `REPO_ID_HEX_LENGTH` | 16 | Length of the repository identifier. |
| `SHA256_HEX_LENGTH` | 64 | Length of a content hash. |
| `MAX_LINES_PER_TOKEN` | 20 | Cap on lines indexed per token. |

## Search

| Constant | Value | Meaning |
|---|---|---|
| `MIN_SEARCH_TERM_LENGTH` | 3 | Shorter terms are dropped — and *surfaced* as dropped, never silently discarded. |
| `EXPANSION_DECAY` | 0.6 | Weight decay applied to expanded (synonym) terms. |
| `MAX_SEARCH_CANDIDATES` | 2,000 | Candidate cap before ranking. |
| `W_SYMBOL_EXACT` | 100 | An exact symbol-name match. |
| `W_SYMBOL_PREFIX` | 60 | A symbol-name prefix match. |
| `W_SYMBOL_SUBSTRING` | 30 | A symbol-name substring match. |
| `W_FILENAME_EXACT` | 45 | An exact filename match. |
| `W_FILENAME_SUBSTR` | 20 | A filename substring match. |
| `W_PATH_SEGMENT` | 15 | A path-segment match. |
| `W_CONTENT_CAP` | 24 | Ceiling on content-match contribution, so a file cannot win on repetition alone. |
| `W_EXPORTED_BONUS` | 8 | Bonus for an exported symbol. |
| `W_IMPORTANCE` | 25 | Weight of the file's importance score. |
| `P_TEST` | −20 | Penalty for a test file. |
| `P_GENERATED` | −30 | Penalty for generated code. |
| `P_FIXTURE` | −15 | Penalty for a fixture. |
| `SEARCH_SCORE_PRECISION` | 3 | Decimal places retained in scores. |
| `MAX_LINE_HITS` | 5 | Line hits shown per result. |
| `LINE_HIT_PREVIEW_MAX_CHARS` | 200 | Preview truncation per hit. |

Search results report **why** they matched (`symbol-exact`, `symbol-prefix`,
`symbol-substring`, filename, path), so ranking is explainable rather than a
black box — and so a test can assert that a hit was a real symbol match rather
than a filename coincidence.
