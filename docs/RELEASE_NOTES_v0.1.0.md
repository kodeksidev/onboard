# Onboard v0.1.0

**Understand an unfamiliar codebase without sending it anywhere.**

Point Onboard at a repository on your machine and it reads it locally: builds
the import graph, ranks files by how much of the codebase depends on them,
groups them into modules, and proposes a reading order for someone seeing the
project for the first time. You get a dependency graph you can navigate by
keyboard, a "where is X?" search that explains *why* each result matched, and a
file viewer.

With AI off — the default — **it makes no network connections at all.**

## Platform status, plainly

| platform | status |
|---|---|
| **Windows** | Verified end to end. The `.msi` is installed on a clean machine in CI, the app is launched, it resolves its engine and analyses a real repository. |
| **Linux** | Same, via the `.deb` on a clean machine. `.rpm` is built from the same run. |
| **macOS** | **Built, never run.** No macOS hardware has been available to this project. The binaries exist and are not included in this release. |

macOS is excluded deliberately rather than forgotten. Publishing a binary that
has never been executed would ship an assumption; it is released when
`docs/MACOS_SMOKE.md` is signed off on real hardware.

One further limit worth stating here rather than in a footnote: what CI proves
is that an installed app **starts, finds its engine, and analyses**. That the
rendered interface works on an installed build is verified by a **human running
a checklist** (`docs/SMOKE_CHECKLIST.md`), because the test bridge is absent
from release builds by design and the native folder picker cannot be automated.

## Downloads

| file | platform |
|---|---|
| `Onboard_0.1.0_x64_en-US.msi` | Windows (installer) |
| `Onboard_0.1.0_x64-setup.exe` | Windows (NSIS) |
| `Onboard_0.1.0_amd64.deb` | Debian / Ubuntu |
| `Onboard-0.1.0-1.x86_64.rpm` | Fedora / RHEL |

**These installers are unsigned.** Windows SmartScreen will object and macOS
Gatekeeper would too. The exact click path for each is in
[docs/INSTALL.md](docs/INSTALL.md); code signing and notarization are out of
scope for v1, and [docs/SIGNING.md](docs/SIGNING.md) says what they would
require.

## Privacy

The central claim, and its limits, are in **[docs/PRIVACY.md](docs/PRIVACY.md)**.
It states the guarantee plainly and then says what has *not* been verified: what
the redaction corpus does and does not prove, that the security audit asked
whether each guard holds and was structurally blind to what a guard does when it
fires, the four fail-open defects that asking the second question found, and
that macOS is unverified.

Read it before trusting the claim. A privacy document that only makes claims
would not be worth much.

## Known issues

**[docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)** is the honest list, with a
severity and a disposition for every entry. Every fail-open defect it records is
fixed *and* carries a regression test — never merely "recorded", because this
project has direct evidence that documenting a fail-open does not close it.

## What this release does not do

v1 deliberately omits Go/Rust/Java/C#/Ruby/PHP/C++ grammars, AI providers beyond
Anthropic and Ollama, git-history analysis, any write to your repository,
call-graph or type inference, multi-repo workspaces, telemetry of any kind, and
plugins. The full list and the reasoning are in
[docs/V2_BACKLOG.md](docs/V2_BACKLOG.md).

## Verification status

Of 28 acceptance criteria: **19 proven**, **5 partial**, **4 unproven**.
Three of the four unproven need hardware or a consistent runner this project
does not have; the fourth is a coverage threshold that is measured but not
enforced. Every criterion backed by CI has been **observed green with a
recorded run id** — none is claimed on the strength of a job merely existing.
The full table is [docs/CRITERIA_MAP.md](docs/CRITERIA_MAP.md).
