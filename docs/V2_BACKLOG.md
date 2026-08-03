# v2 backlog

Work deliberately excluded from v1 by Section 3's non-goals and the frozen
assumptions in Section 2. Nothing here is a defect; each item is a scope
boundary with the constraint that put it there.

The rule Section 3 states for everything on this list: *"Do not build any of
the following. If you find yourself writing one, stop and delete it."*

---

## Additional AI adapters — DeepSeek, OpenAI, Azure, Bedrock, and any other

**Deferred by:** A4 — "v1 ships exactly **two AI adapters: Anthropic and
Ollama**. DeepSeek and generic OpenAI-compatible are v2 against the same
interface." · Section 3 non-goal 2 — "DeepSeek, OpenAI, Azure, Bedrock, or any
adapter beyond Anthropic and Ollama (A4)."

**Status: removed after being built in violation of both.** A generic
`openai-compatible` adapter was implemented during Phase 12 and shipped
through Phase 13. It has been deleted in full — the adapter module, the
`AiProvider` enum variant on both sides of the IPC boundary, the
`ProviderShape` body variant, the `openaiCompatibleBaseUrl` setting and its
Settings-dialog field, the keychain account, and every test that asserted the
adapter worked. See the "Phase 13 follow-up" entry in `docs/DECISIONS.md` for
how it got built and what that implies.

**When v2 picks this up**, the interface is already the right shape and no
redesign is owed:

- `ai::provider::AiProvider` is the trait every adapter implements; adding one
  is a new module plus one enum variant, not a structural change.
- `ai::http::send` remains the single egress door. A new adapter names a
  `ProviderShape`; it must never construct a body, hold a `reqwest::Client`,
  or take an endpoint argument.
- `ai::endpoint::resolve` is the only route to a URL, and it reads exclusively
  from stored settings.

**Carry this forward, because it was a real finding, not a hypothetical:**
M2 in `docs/SECURITY_AUDIT.md` observed that `validate_http_base_url` checks
only the URL *scheme*, so a user-configurable base URL can point anywhere,
while the mode indicator names only the *provider*. Any v2 adapter with a
user-supplied base URL reintroduces that gap on day one. Resolve M2 — most
likely by interpolating the resolved host into the mode indicator and the
`SentPayloadDisclosure` line — **before** the second configurable-endpoint
adapter lands, not after.

**Migration already handled:** a `settings.json` written by the version that
shipped the removed adapter still loads. An unknown `openaiCompatibleBaseUrl`
key is ignored, and a file pinned to `provider: "openai-compatible"` fails
enum deserialization and falls back to `Settings::default()`, which has AI
**off**. Both cases are covered by tests in `commands/settings.rs`.

---

## Additional language grammars — Go, Rust, Java, C#, Ruby, PHP, C/C++

**Deferred by:** A2 · Section 3 non-goal 1 — "v1 is JS/TS/TSX + Python."

The parse layer is already grammar-table driven (`parse/grammar-loader.ts`,
`parse/queries/*.scm`), so a new language is a grammar plus a query file plus
classification rules, not an engine change.

---

## Code signing, notarization, stapling, auto-update, app-store submission

**Deferred by:** A3 · Section 3 non-goal 3.

v1 ships unsigned / ad-hoc installers. `docs/SIGNING.md` documents what would
be required and states explicitly that it is out of scope; `docs/INSTALL.md`
carries the exact `xattr -dr com.apple.quarantine` and SmartScreen
"More info → Run anyway" steps users need as a result.

---

## A published npm CLI / `npx onboard` / a web-hosted version

**Deferred by:** Section 3 non-goal 4 — "The engine is *shaped* for reuse; it
is not *distributed* in v1."

`packages/engine` is already a standalone package with a typed JSON contract
and no Tauri dependency, which is the shaping that non-goal refers to.

---

## Other standing non-goals

Listed so v2 planning starts from the frozen set rather than re-deriving it.

**Section 3 names TWELVE non-goals and every one is accounted for here** —
1 to 4 have sections of their own above, 5 to 12 are below. The numbers are
kept so the correspondence can be checked against the spec rather than trusted;
this list was found short of 10, 11 and 12 when it was audited against Section 3
during Phase 15, which is exactly the kind of omission an unnumbered list hides.

- Git history analysis, blame, churn, PR integration (non-goal 5).
- Any write to the analyzed repository — Onboard is strictly read-only on user
  code (non-goal 6).
- Call-graph analysis, type inference, dead-code proof, cross-file symbol
  resolution beyond import edges (non-goal 7).
- Multi-repo workspaces, remote repos, clone-by-URL, network filesystems as a
  supported target (non-goal 8).
- Telemetry, crash reporting, analytics, update checks (A17, non-goal 9).
- **Server-side anything. There is no backend** (non-goal 10). This one is not
  merely deferred: it is load-bearing for the guarantee in `docs/PRIVACY.md`.
  A v2 that grows a server changes what the product *is*, and the privacy
  document would have to be rewritten rather than extended.
- Streaming token-by-token AI rendering, AI-driven refactoring suggestions, or
  AI writing to the index (non-goal 11). The last of the three is the one to be
  careful with: an AI that can write to the index would put unverified model
  output where the citation check currently reads ground truth from.
- Custom themes, plugin systems, or user-authored analyzers (non-goal 12). A
  plugin system is also an egress surface — arbitrary user code inside the app
  would end the single-HTTP-client guarantee that `check_egress_chokepoint`
  enforces today.

---

## `onboard <path>` — open a repository from the command line

**Deferred 2026-07-29.** Wanted as a feature in its own right, and explicitly
NOT as test scaffolding.

`onboard ~/src/some-repo` is what a developer expects from a developer tool,
and it is the reason to build it. It came up for a different reason, which is
the reason it is deferred: driving an INSTALLED release build to a rendered
graph in CI needs some way to open a repo without the native folder picker,
because `window.__onboardE2E` is gated on `import.meta.env.MODE === 'e2e'`
(`apps/desktop/src/main.tsx`) and a release bundle therefore does not have it.

Three reasons that justification was rejected:

1. **"So a test can pass" is not a product justification.** This project
   already carries one case of a plausible local justification adding scope
   that then survived thirteen phases. A feature added after the ship decision
   to make a gate go green is the same move.

2. **It would add a third provenance source for `analyze_repo`.** Section 12's
   capability check currently reasons about a bounded set of ways a repo path
   can reach the engine. Argv would be another, and it is the least
   trustworthy of them — M3 is already open against exactly that list. Adding
   to it while a check against it is unresolved is the wrong order.

3. **Proportionality.** The install jobs prove what actually broke — shell
   launch and sidecar resolution. The rendered graph is the UI half, already
   covered by 368 UI tests and four axe suites, and (from 2026-07-29) by the
   manual smoke checklist in `docs/SMOKE_CHECKLIST.md` on all three platforms.
   The marginal confidence does not pay for a feature added after the ship
   decision.

**If it lands**, it goes through the same capability checks as every other
provenance source and amends Section 12 explicitly, rather than arriving as a
convenience.

---

## Managed deployment on Windows — MSI, Group Policy, Intune, SCCM

**Deferred by:** the AMENDMENT dated 2026-08-03 in `docs/DECISIONS.md`, which
dropped the `.msi` and left `setup.exe` as the only published Windows artefact.

**This is a capability that was removed, not one that was never built** — which
is why it is written down here rather than left implicit. Until 2026-08-03 a
Windows administrator could push Onboard to a fleet: `msiexec /i /qn`, a Group
Policy software-installation object, an Intune line-of-business app, an SCCM
package, an MST transform to preset an install directory. All of that is a
property of the MSI format, and none of it survives in NSIS. `setup.exe /S`
installs silently, and that is genuinely all it offers an administrator — no
declarative file table, no rollback, no per-machine scope, no transforms.

**The trade that was made, so v2 can re-examine it rather than re-derive it.**
The MSI installs `perMachine` into `Program Files` and requires elevation;
Tauri's `WixConfig` exposes no install-scope key, so that is not tunable. The
NSIS installer installs `currentUser` into `%LOCALAPPDATA%` and requires none.
Onboard's audience is developers reading proprietary code, often on managed
laptops with no local administrator rights, and for them the two formats are
not "one is nicer" — the MSI is uninstallable and the NSIS one works. Given one
format, the individual-without-admin case beat the administrator-with-a-fleet
case. Given two, both are served, and the cost is two sets of installer artwork
on a surface this project has already failed to enumerate three times.

**When v2 picks this up**, the shape is known and cheap:

- `release-formats.json` is the single table; adding `"msi"` to the Windows
  entry's `bundles` and `".msi"` to its `extensions` regenerates the build
  matrix, the upload glob and the asset check together.
- `WixConfig.bannerPath` (493x58) and `WixConfig.dialogImagePath` (493x312)
  must be set in the same change. Unset, they render WiX's stock CD-disc
  artwork — this is exactly what shipped unnoticed through v0.1.0, and the
  amendment above exists partly because nobody had looked at those screens.
- `bundle.upgradeCode` should be PINNED before the first MSI ships. Unset,
  Tauri derives a UUIDv5 from `<productName>.exe.app.x64`, so renaming the
  product would orphan every installed copy.
- `installed-windows` would need to cover both formats rather than swap
  between them. Its current form asserts the install is per-user; an MSI would
  need its own job asserting the per-machine layout, not a relaxation of that
  assertion.

**Do not take this as a defect.** A single per-user installer is the right
default for this product. This item exists so that the day someone asks "can we
deploy Onboard across the company", the answer is a scope boundary with a known
cost, not a rediscovery.

---

## Intra-file structure — the graph's unit becomes the symbol, not the file

**Deferred by:** Section 3 non-goal 7 — "Call-graph analysis, type inference,
dead-code proof, cross-file symbol resolution beyond import edges."

**The observation that produced this item, 2026-08-03.** A user pointed Onboard
at a single 20,000-line file rather than a repository. The result: a one-node
dependency graph, an empty module map, a one-step roadmap — while the symbol
outline, search and external dependencies all worked normally.

**That is correct behaviour, not a defect, and the distinction matters for how
this is picked up.** Onboard's graph is a FILE-to-FILE graph: `FileNode` is a
path, `ImportEdge` runs `fromPath` to `toPath`. One file means one node and no
edges, because there is no second file to point at. Nothing is failing; the
input has no structure of the kind the graph displays. Do not "fix" this by
making the graph tolerant of small inputs — the unit is wrong for the input,
and only changing the unit changes the answer.

**What v2 would actually build.** The graph's node becomes a SYMBOL rather than
a file, with edges derived from references between symbols within a file — the
20,000-line file becomes a real graph of its own functions and types.

**What it costs, honestly.** This is call-graph analysis. Resolving "this
identifier refers to that declaration" is exactly what non-goal 7 excludes from
v1, and the exclusion is not arbitrary: it needs scope and binding resolution
per language, which is where a tree-sitter-based engine stops being cheap. It
is a significant piece of work, not a display change.

**It is also a BREAKING CONTRACT CHANGE.** `FileNode` and `ImportEdge` both
change shape — a node gains a symbol identity and a within-file location, an
edge gains a reference kind that is not an import. That bumps
`SCHEMA_VERSION` (`packages/contract/src/analysis-result.ts`, currently `1`) and
every cache written by the current engine becomes unreadable. Budget the
migration, not just the analysis.

### A smaller, separate question that does NOT need the v2 feature

**A single-file input is not an error state today, so the empty panels read as a
failure.** The user sees a blank module map and a one-step roadmap and cannot
tell "Onboard has nothing to show for this input" from "Onboard broke". No
call-graph work is required to fix that — it is a copy and empty-state question:
whether those panels should say something like *"this repository has one file;
the structure view is the symbol outline"* and point at the outline that already
works.

Filed here so it is not lost, but it belongs with the Section 10 empty states
rather than with this feature, and it should not wait for it.
