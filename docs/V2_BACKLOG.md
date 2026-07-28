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

Listed so v2 planning starts from the frozen set rather than re-deriving it:

- Git history analysis, blame, churn, PR integration (non-goal 5).
- Any write to the analyzed repository — Onboard is strictly read-only on user
  code (non-goal 6).
- Call-graph analysis, type inference, dead-code proof, cross-file symbol
  resolution beyond import edges (non-goal 7).
- Multi-repo workspaces, remote repos, clone-by-URL, network filesystems as a
  supported target (non-goal 8).
- Telemetry, crash reporting, analytics, update checks (A17, non-goal 9).
