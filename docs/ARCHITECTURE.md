# Architecture

Onboard is a desktop application in three parts, each a separate process or
runtime boundary. The split is not incidental — it is what makes the privacy
claim in `docs/PRIVACY.md` enforceable rather than merely intended.

```
┌──────────────────────────────────────────────────────────┐
│  React + TypeScript UI            (inside the webview)   │
│  graph, roadmap, module map, search, file viewer         │
└───────────────┬──────────────────────────────────────────┘
                │  Tauri IPC  (typed commands, no HTTP)
┌───────────────▼──────────────────────────────────────────┐
│  Rust shell  (apps/desktop/src-tauri)                     │
│  window, filesystem access, OS keychain, settings,        │
│  sidecar supervision, redaction, THE ONLY HTTP CLIENT     │
└───────────────┬──────────────────────────────────────────┘
                │  stdio JSON-RPC 2.0, newline-delimited
┌───────────────▼──────────────────────────────────────────┐
│  Analysis engine  (packages/engine, compiled to a binary) │
│  tree-sitter parsing, import graph, ranking, search       │
│  NO network code compiled in, at all                      │
└──────────────────────────────────────────────────────────┘
```

## Why the engine is a separate process

It would be simpler to compile the analysis into the shell. It is a separate
process on purpose:

1. **The privacy claim becomes structural.** The engine binary contains no HTTP
   client. It cannot leak your code because it has no way to send anything
   anywhere — verified by a static scan and by running a real analysis inside
   `unshare -rn`, a network namespace with no interface.
2. **A crash is survivable.** Parsing untrusted source files is the riskiest
   thing this program does. When the engine dies, the shell restarts it and
   reports `E_ENGINE_CRASHED`; the window does not go with it.
3. **The contract stays honest.** Talking over stdio with typed JSON forces the
   boundary to be explicit and versioned, rather than a shared mutable object.

## The three layers

### The UI (`apps/desktop/src`)

React and TypeScript inside Tauri's webview. It holds no analysis logic: it
renders what the engine produced and calls typed commands. State lives in small
Zustand stores. The dependency graph is Cytoscape on a canvas, which is why the
graph also renders a visually-hidden accessible table — a canvas has no DOM for
a screen reader to read.

The webview runs under a Content-Security-Policy with no remote origin, and a
test asserts that.

### The Rust shell (`apps/desktop/src-tauri`)

Owns everything the webview must not: the filesystem, the OS keychain, settings
on disk, the log, and the network. Specifically:

- **Sidecar supervision** (`sidecar/supervisor.rs`) — starts the engine,
  performs a version handshake, restarts it within a budget, and converts
  transport failures into named errors.
- **The egress chokepoint** (`ai/http.rs`) — the single `reqwest` client in the
  repository. `check_egress_chokepoint` fails the build if a second one appears.
- **Redaction** (`privacy/`) — runs before any outbound payload, and fails
  closed.
- **Command handlers** (`commands/`) — the typed surface the UI calls.

### The engine (`packages/engine`)

A TypeScript program compiled to a standalone binary per platform, shipped
beside the app as a Tauri `externalBin`. It parses with tree-sitter (WASM
grammars shipped as resources), builds the import graph, ranks files, and
answers search queries. `docs/ENGINE_CONTRACT.md` documents what it returns.

## How the shell finds the engine

This is worth stating precisely, because getting it wrong shipped a broken
installer.

Tauri copies an `externalBin` **next to the main executable**, stripping the
`-<target-triple>` suffix. So in an installed app the layout is:

```
<install dir>/onboard.exe            <- the shell
<install dir>/onboard-engine.exe     <- the engine
<install dir>/resources/grammars/*.wasm
```

There is **no `binaries/` subdirectory** in an installed app. The shell resolves
the path via `tauri-plugin-shell`, which knows this convention and applies the
platform executable suffix. A development build additionally falls back to the
staging directory the build scripts populate — that fallback is
`#[cfg(debug_assertions)]`, so a release build cannot take it, and a release
build that cannot resolve its engine reports `E_ENGINE_NOT_STARTED` rather than
guessing at a path.

## The RPC boundary

Newline-delimited JSON-RPC 2.0 over the engine's stdin/stdout. Nothing else
crosses: no shared memory, no files written by one and read by the other except
the analysis cache, no sockets.

Requests carry timeouts. A full analysis is allowed considerably longer than
other calls, because analysis is the only operation whose cost scales with the
repository. A call that exceeds its budget kills the process and reports
`E_ENGINE_TIMEOUT`; a call that finds the engine gone reports
`E_ENGINE_CRASHED`; a version handshake mismatch reports
`E_ENGINE_VERSION_MISMATCH` rather than proceeding against an unknown contract.

An engine that **answers** with an error it does not describe in terms the
shell has a named state for reports `E_ANALYSIS_FAILED`, not
`E_ENGINE_CRASHED`. The two are distinguished by the transport, not by
guesswork: a dead transport arrives as a closed connection, while a JSON-RPC
`error` object means the process is alive and replying. The distinction is
load-bearing because the copy differs — `E_ENGINE_CRASHED` tells the user that
retrying usually works and that the cache keeps completed files, and for a
deterministic engine-side failure both statements are false. v0.1.0 reported
one such failure under `E_ENGINE_CRASHED`; see `docs/DECISIONS.md`.

Progress arrives as notifications on the same channel and is forwarded to the
UI as events.

## Concurrency

The shell is synchronous by design: `std::process` and `std::thread`, no async
runtime outside the HTTP client's own private one. The engine's `analyze()` is
**not** re-entrant, and a second concurrent analysis is refused outright with
`E_ANALYSIS_IN_PROGRESS` rather than left to chance. Refusing is a deliberate
position: the alternative was hoping the shared parser state happened to be safe.

## Where things live

| Path | What |
|---|---|
| `apps/desktop/src` | React UI |
| `apps/desktop/src-tauri` | Rust shell (the bundled package) |
| `apps/desktop/src-tauri/dev-tools` | Developer binaries — **never shipped** |
| `apps/desktop/e2e` | WebdriverIO suite (Windows + Linux) |
| `packages/engine` | Analysis engine |
| `packages/contract` | The typed contract shared by all three layers |
| `scripts/` | Build, staging and gate scripts |

`dev-tools` is a separate crate for a specific reason: Tauri's bundler bundles
every `[[bin]]` target of the package it is bundling. While the test stub and
the source checker lived in the shell's own package, they were installed onto
users' machines. A test asserts the bundled package has exactly one binary, so
re-adding one is a visible manifest change rather than an accident.

## Testing and gates

- `bun run verify` — typecheck, lint, contract drift, docs, tests, on three OSes.
- `verify:determinism` — the same repository analysed twice produces identical
  output.
- `verify:no-network` — the engine analyses a repository with no network
  namespace.
- `bun run --cwd apps/desktop e2e` — WebdriverIO against a real built app,
  Windows and Linux (macOS has no Tauri WebDriver support).
- Release workflow — builds installers, then **installs them on clean runners**
  and asserts the shell starts, resolves its engine, and analyses a repository.
  `publish` depends on those jobs.

`docs/CRITERIA_MAP.md` records which of these have been observed green, with run
ids, and distinguishes that from merely being wired.
