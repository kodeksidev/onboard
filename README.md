# Onboard

Point it at a local repository and get an onboarding map: what the project is,
its stack, its entry points, its most important files, an interactive dependency
graph, a module map, a guided "start here" reading roadmap, and a "where is X
handled?" search that jumps to exact files and line numbers.

It is a desktop application. There is no server, no account, and no upload step.

## The privacy model, which is the architecture

Onboard exists because developers run it on proprietary code they are legally
forbidden to upload anywhere. So "your code never leaves your machine" is not a
promise made in this file — it is a property of how the app is built, and it is
enforced in four independent places:

1. **The analysis engine has no network capability.** `packages/engine` cannot
   open a socket. It is not a policy: ESLint refuses `net`, `http`, `https`,
   `tls`, `dgram` and `dns` imports (bare or `node:`-prefixed) inside that
   package, a runtime guard blocks them, and `bun run verify:no-network` scans
   the compiled bundle for network identifiers *and* runs a full analysis of
   every fixture with network namespaces unshared (`unshare -rn`) on Linux CI.
2. **The webview cannot reach the network either.** A test asserts
   `tauri.conf.json`'s Content-Security-Policy contains no remote origin and
   that `capabilities/default.json` grants the webview neither `http:` nor
   `fs:` permissions.
3. **There is exactly one door.** All outbound traffic — which exists only when
   you turn AI on — goes through a single chokepoint in the Rust layer, and a
   CI job (`check_egress_chokepoint`) fails the build if a second one appears or
   if a banned HTTP/TLS crate is added.
4. **Nothing outbound is unredacted.** A redaction pass runs in Rust before any
   byte leaves the process.

**Static mode makes no network calls whatsoever.** With AI off, the whole
product — roadmap, graph, module map, search, file viewer — works, and the mode
indicator reads exactly:

```
🔒 Static mode · no network · nothing leaves this machine
```

There is no telemetry, no crash reporting, no analytics, no "anonymous usage
stats", and no update check. Not configurable-off: absent.

## Determinism

The same repository analysed twice produces byte-identical output. That is a
gate, not an aspiration: `bun run verify:determinism` runs 20 fingerprint
comparisons across five fixture repositories — cold-vs-cold, cold-vs-warm,
shuffled directory-read order, and warm-fast-path-vs-full-rebuild — and CI runs
it on macOS, Windows and Ubuntu on every push.

## Install

**Windows and Linux only in the first release. macOS is built but not
published.** Linux ships as `.deb` and `.rpm`; the `.AppImage` does not build
(KNOWN_ISSUES KI-9).

The macOS build compiles and its artefact is verified for format and
architecture, but **no macOS build has ever been executed on a Mac** — the
project has no Apple hardware, and CI can produce a darwin binary without being
able to run one. Publishing it would ship an assumption. It will be released
once `docs/MACOS_SMOKE.md` is signed off on real hardware.

v1 ships **unsigned installers**. Windows SmartScreen will object, and the exact
steps to proceed are in **[docs/INSTALL.md](docs/INSTALL.md)** — which also
carries the macOS steps for whoever runs that verification. Code signing and
notarization are deliberately out of scope for v1; the path is documented in
[docs/SIGNING.md](docs/SIGNING.md).

## What is not verified

Four things this project cannot check on its own hardware. They are listed in
plain terms because "criterion 11 is CI-blocked" tells you nothing:

- **Speed has not been measured on your machine.** The performance budgets —
  how fast a large repository opens, how quickly the graph lays out — are
  checked only on developer machines. A shared CI runner's timings move by 3x
  under load, so a number from one would be worse than no number. On a big
  repository or a slow disk, Onboard may be slower than intended.
- **The 10-second first-open target is unmeasured.** The goal is that pointing
  Onboard at a fresh 1,000-file repository gives you the overview, graph,
  roadmap and search in under ten seconds. That has been observed by hand, never
  timed by a gate.
- **The end-to-end UI flows are not run automatically.** Individual components
  and the whole analysis engine are tested on every change across three
  operating systems; driving the real application window from start to finish is
  not, because the test harness races itself on fixed ports. Component and engine
  coverage is good; whole-app coverage is manual.
- **The installers are unsigned, and the macOS one is unpublished.** See above.
  Nothing about installation is automatically verified on any platform — the
  build produces installers, and no gate installs one and launches it.

None of these is a known defect. They are things nobody has proven, stated as
such. [docs/CRITERIA_MAP.md](docs/CRITERIA_MAP.md) is generated from what CI
actually runs and carries the full picture; [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)
carries the defects that were found and what was done about each.

## Optionally enabling AI

AI is off until you turn it on, and turning it on takes two things: a stored key
**and** the master toggle. Either alone leaves the app in static mode.

1. Open **Settings**.
2. Choose a provider — **Anthropic** (cloud) or **Ollama** (local).
3. Paste an API key and click **Test key**. You get an inline result.
4. Turn the AI master toggle on.

What changes when you do:

- The mode indicator changes to name the provider and model, and states that
  snippets are sent:
  `☁️ AI mode · <provider>/<model> · snippets sent to <provider>`
- Every AI action shows the **actual** number of files and bytes sent, counted
  from what was sent rather than what was requested.
- An outbound payload never exceeds 24 files or 98,304 bytes.
- Every snippet passes the redaction pass first.
- An AI answer citing a file that is not in the index is rejected **wholesale**,
  and the offending path is shown. A citation that cannot be resolved is not
  displayed with a caveat; the answer is refused.

Choosing **Ollama** keeps everything on your machine — it talks to
`127.0.0.1:11434` and nothing else.

**Your API key is never written to `settings.json`, never logged, and never
returned in any IPC response.** It lives in the OS keychain. On Linux with no
Secret Service or KWallet available, Onboard offers a session-only in-memory
key rather than writing a plaintext secret to `~/.config`.

To turn AI off again, flip the master toggle. Every `ai_*` operation then
returns `E_AI_DISABLED`.

## Building from source

Requires [Bun](https://bun.sh) and a Rust toolchain.

```bash
bun install --frozen-lockfile
bun run verify          # typecheck, lint, gates, tests
bun run build:sidecar   # compile the engine sidecar
bun run stage:sidecar   # copy it into the Tauri shell
```

`bun run verify:report` runs the same stages without stopping at the first
failure — use it when you want the whole picture rather than the first error.

## What v1 deliberately does not do

JS/TS/TSX and Python only. No Go, Rust, Java, C#, Ruby, PHP or C/C++ grammars.
No git history analysis, blame or churn. No editing of the repository you point
it at — Onboard is strictly read-only on your code. No multi-repo workspaces, no
remote or cloned repositories, no server component of any kind.

The full list, with the constraint behind each exclusion, is in
[docs/V2_BACKLOG.md](docs/V2_BACKLOG.md).

## Project state

[docs/CRITERIA_MAP.md](docs/CRITERIA_MAP.md) is generated, not written: it
derives every acceptance criterion's status from what CI actually runs. Start
there rather than trusting this section.

## Licence

MIT. See [LICENSE](LICENSE).
