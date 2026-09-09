# Security audit — Phase 13

**Scope:** whole repository at `main` / HEAD `28b96f4`.
**Auditor:** `agent-security` (read-only; no source file was modified by this audit).
**Method:** code reading plus targeted execution — `cargo test`, `cargo audit`, `bun audit`, and a
throwaway probe crate *outside* the repo that links `onboard_lib` and calls the real
`privacy::verify_citations` / `privacy::patterns` functions. Every finding cites the code that
produces it and states how it was verified. Nothing here is speculative.

---

## 1. The threat model as implemented

### What this app defends against

Section 12 names the adversary: **accidental data exfiltration** — "a stray HTTP client, an
over-broad AI payload, a key written to disk, a log line with a token." There is no server and no
remote attacker. The asset is the user's source code.

As built, the defences are:

| Defence | Where it lives | Kind |
|---|---|---|
| Exactly one outbound door | `src-tauri/src/ai/http.rs` (only `reqwest` consumer) | structural + CI checker |
| The door needs proof AI is on | `ai::permit::EgressPermit` (private field, one constructor) | compile-time |
| The door only accepts redacted content | `privacy::redact::RedactedPayload` -> `ai::prompt::PromptSpec` | compile-time |
| The door only accepts a settings-derived host | `ai::endpoint::ResolvedEndpoint` <- `StoredAiSettings` | compile-time |
| The door builds its own request body | `ai::http::build_body` (no `body` parameter exists) | compile-time |
| The mandatory step order | `ai::pipeline::PipelineTrace::ensure_ready_to_send` | fail-closed runtime |
| What was sent is auditable | `ai::transcript::record` (records `build_body`'s own output) | runtime |
| The model cannot invent paths | `privacy::verify_citations` + `AnswerMarkdown`'s `citedPaths` gate | runtime, two layers |
| The engine has no network at all | `packages/engine/src/guard/no-network.ts` + bundle scan + `unshare -rn` | runtime + build-time |
| Keys never touch disk | `secrets::ai_key` (OS keychain / in-memory session fallback) | runtime |
| Webview cannot reach network or filesystem | CSP with no remote origin; no `http:`/`fs:` capability | config, asserted by `tests/lockdown.rs` |
| Repo confinement | `util::paths::confine_to_repo`, `engine/src/rpc/repo-path-guard.ts` | runtime, canonicalising |

### What it explicitly does not defend against

Stated so no reader mistakes silence for coverage:

1. **A malicious contributor with commit access.** `redact.rs`'s own doc comment concedes it: a
   same-crate caller can hand-build an `EngineSnippet` (its fields must be public for `Deserialize`).
   The type system stops accidents, not sabotage.
2. **A user who deliberately points the app at a hostile host.** `ollamaBaseUrl` /
   `openaiCompatibleBaseUrl` are user-configurable by design (S6.2). See M2 for where this collides
   with the UI's privacy claim.
3. **A compromised OS account.** `settings.json` is a plain file; anything running as the user can
   flip `ai.isEnabled`. The keychain is only as strong as the OS.
4. **Prompt injection from repo content.** Snippets from the repo being onboarded flow into the
   prompt, so a repo can steer the model's output text. The defences are that model output is
   rendered only as React text nodes through a tiny grammar, and that citations are verified — see
   H1 for a real gap in that second half.
5. **Provider-side handling.** Once bytes reach Anthropic / an OpenAI-compatible host / Ollama they
   are out of scope. The promise is only that AI is off by default and that, when on, exactly the
   redacted, capped, transcript-recorded payload leaves.
6. **The unsigned-binary supply chain.** Phase 14 ships unsigned installers; the download path is
   not a control this audit can assess.

---

## 2. Findings

Severity per the project rule: **CRITICAL** = security vulnerability or data-loss risk ·
**HIGH** = bug or significant quality issue · **MEDIUM** = maintainability · **LOW** = style/minor.

### CRITICAL

**None found.**

That reflects what was checked, not a guarantee of absence. Specifically checked and not found: a
second network client; a route to `http::send` carrying unredacted content; a route past
`RedactedPayload` / `PromptSpec` / `ResolvedEndpoint` / `EgressPermit`; a key reaching
`settings.json`, a log, a transcript, an `AppError`, or the webview; a path-traversal escape in
`read_repo_file`, `engine.readFile`, or `engine.snippets`; SQL or command injection; an HTML
injection sink.

---

### HIGH

#### H1 — Model-authored `[[path:line]]` tokens bypass citation verification entirely  — **RESOLVED**

**File:** `apps/desktop/src-tauri/src/privacy/verify_citations.rs:274-314` (the scanning loop) and
`:192-213` (`parse_span`).

**The problem.** `verify_citations` inspects only text inside backtick spans and well-formed
`[text](target)` markdown links; everything else is copied verbatim into the output buffer. The
`[[path:line]]` token is supposed to be a value only this function can produce (S8.10 step 4), but
nothing stops the model from writing one itself: `[[src/x.ts:1]]` is not a code span and is not a
well-formed link (no parentheses), so `parse_span` returns `None`, the `[` is copied through as a
literal, and the token reaches the UI unverified.

**Verified by execution,** not by reading. A probe crate linking the real `onboard_lib` called:

```
index      = { "src/index.ts": 22 lines }
answer     = "Start at `src/index.ts:1`. Also see [[src/index.ts:9999]] and [[src/ghost.ts:1]]."
result     = ACCEPTED
markdown   = "Start at [[src/index.ts:1]]. Also see [[src/index.ts:9999]] and [[src/ghost.ts:1]]."
citedPaths = ["src/index.ts"]
count      = 1
```

The same answer written with backticks (`src/ghost.ts` in a code span) is rejected wholesale — proven
by the existing test `one_bad_citation_among_several_good_ones_rejects_everything`. The bypass is
purely a matter of which delimiter the model chooses.

**Concrete impact.**

1. S8.10 step 3's "reject the WHOLE answer" is evadable. A model (or repo content steering it) that
   emits `[[src/ghost.ts:1]]` gets that hallucinated path **displayed to the user** as text, where a
   backticked mention would have withheld the entire answer. `AnswerMarkdown.tsx:49-51` renders it as
   inert grey text rather than a link — which is why this is not CRITICAL — but the app does show a
   path it never verified, contradicting the copy it ships ("Onboard never shows paths it can't
   verify").
2. The line-range strengthening (`verify_citations.rs:169-177`) is fully bypassed for any path that
   also appears legitimately in the answer. `[[src/index.ts:9999]]` has its path in `citedPaths`, so
   `AnswerMarkdown.tsx:52` renders a real `CitationLink` — a clickable jump to a line the file does
   not have. The module's doc comment claims this case "is rejected wholesale, same as an unknown
   path." It is not.
3. `citation_count()`'s `NonZeroUsize` non-vacuousness guarantee is weakened in practice: one real
   citation licenses any number of fabricated tokens in the same answer.

**Would the test still pass if the control were removed?** For this case, yes — every existing test
in `verify_citations.rs` feeds the verifier answers written with backticks or markdown links. None
feeds it an answer that already contains a `[[` token. That is the vacuity: the tests exercise only
the input shapes the control handles.

**Fix.** The token grammar is generated exclusively by this function, so a `[[` in the *raw* answer
is by definition illegitimate. At the top of `verify_citations`, before any rewriting, either
(a) reject when `answer_markdown.contains("[[")` — the fail-closed choice, consistent with the rest
of the module; or (b) neutralise the delimiters (e.g. rewrite `[[` to `[ [`) so a model-written token
can never be confused with a verified one. Add a test whose input already contains `[[...]]` in
prose, and a UI test asserting that a token with a verified path but an out-of-range line does not
become a link.

---

#### H2 — Every Rust-side security control is unenforced in CI  — **RESOLVED**

**Files:** `.github/workflows/ci.yml:1-96`; `package.json:13,22`.

**The problem.** CI runs exactly three jobs: `bun run verify` on three OSes, the same from a path
containing a space, and the egress-chokepoint checker. `bun run verify` expands to
`typecheck && lint && contract:check-drift && test`, and `test` is
`contract && engine && apps/desktop` — **TypeScript only**. There is no `cargo test`, no
`cargo clippy -- -D warnings`, no `cargo audit`, no `bun audit`, no `bun run verify:no-network`, no
`bun run e2e`, no `bun run bench`.

**Verified** by reading the workflow and `package.json`, and by confirming `ci.yml` is the only file
under `.github/`.

**Concrete impact.** Everything this audit's verdict rests on lives in the Rust suite and can regress
with a fully green CI: the >=30-secret redaction corpus and the idempotence property test,
`ai::permit`'s gating matrix, `ai::pipeline`'s fail-closed order checks, all of
`privacy::verify_citations`, the five compile-fail suites that prove `RedactedPayload` /
`EgressPermit` / `ResolvedEndpoint` / `PromptSpec` have no public constructor, and
`tests/lockdown.rs`'s CSP + capability + devtools assertions. Phase 13's own gate
(`cargo audit` / `bun audit` clean) is likewise not automated. This is precisely the failure class
the project has been bitten by before — the gates exist and are well written; they are simply never
run.

**Fix.** Add a `rust` job to `ci.yml` (Windows + Linux at minimum — several tests are
platform-conditional and the keychain backend differs) running
`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`,
`cargo clippy --all-targets -- -D warnings`, and `cargo audit`; add `bun audit` and
`bun run verify:no-network` to the existing verify job. Note the keychain tests need a usable secret
store on the Linux runner (`gnome-keyring` under `dbus-run-session`) or they will silently exercise
only the A18 session-only fallback.

---

#### H3 — The three `ai_*` features are dead in the shipped app  — **RESOLVED**

**Files:** `apps/desktop/src/ipc/tauri-ipc.ts:73-82,130-135` versus
`apps/desktop/src-tauri/src/lib.rs:149-151`.

**The problem.** `lib.rs` registers `ai_project_summary`, `ai_explain_module` and `ai_ask` as real
Tauri commands, but the production IPC adapter still returns the Phase-12-step-5 placeholder:

```ts
const AI_NOT_YET_IMPLEMENTED: AppError = { code: 'E_AI_DISABLED', ... };
aiProjectSummary: () => aiNotYetImplemented<AiActionResult>(),
```

**Verified** by grep across `apps/desktop/src`: the only non-test references to `aiProjectSummary` /
`aiAsk` are `ipc.ts` (interface), `mock-ipc.ts` (fixture mode), `aiStore.ts` (caller) and the three
stubs. No file calls `invoke('ai_project_summary', ...)`.

**Concrete impact.** In any build that is not `VITE_IPC=mock`, the entire Phase 12 step 6 pipeline —
permit -> snippets -> redact -> caps -> prompt -> transcript -> send -> verify — is unreachable. It
fails closed, so this is not a vulnerability; but (a) acceptance criteria 14, 17 and 18 cannot be
true of the shipped app, (b) the pipeline has never run end to end outside Rust unit tests, and
(c) the error the user sees is misleading: it says AI is disabled when the feature is simply not
wired, so a user who has correctly stored a key is told to store a key.

**Fix.** Wire the three methods to `call('ai_project_summary', { repoId })`,
`call('ai_explain_module', { repoId, moduleId })` and `call('ai_ask', { repoId, question })`, and
delete `AI_NOT_YET_IMPLEMENTED`. Add an assertion (E2E or an adapter unit test) that the real
adapter invokes the real command name, so the stub cannot silently return.

---

### MEDIUM

#### M1 — `test_ai_key` reaches the one egress door outside the traced pipeline

**Files:** `src-tauri/src/commands/ai.rs:96-130`; `src-tauri/src/ai/anthropic.rs:116-138` (and the
`run_test` twins at `ollama.rs:119-148`, `openai_compatible.rs:85-107`).

`test_ai_key_core` calls each adapter's `test_with_model`, which calls `http::send` directly. There
is no `PipelineTrace`, no `transcript::record`, and no `ai_rate_limiter.acquire()` on this path.

**Verified** by enumerating all six `http::send` call sites (`grep -rn "http::send" src/`) and by
reading the command wrapper (`commands/mod.rs:192-203`), which does `validate_provider` and nothing
else.

**Impact.** No repo content can ride along: `run_test` builds its payload from
`redact(&EngineSnippetsResult { snippets: vec![] })`, so the payload is structurally empty and
`build_body` has no other content source. But two Section 12 statements are not literally true —
"the exact payload ... is written to the local session transcript" (this outbound request is recorded
nowhere) and the AI rate limits (a webview loop can hammer the provider with test requests, and this
is also the one path that transmits the API key).

**Fix.** Route `test_ai_key_core` through `state.ai_rate_limiter.acquire()` and write a transcript
line for the connectivity check (it needs a repo-id-free file name, e.g.
`transcripts/connectivity.jsonl`, or a `repoId: null` entry).

#### M2 — Ollama's key exemption assumes a local host that nothing enforces

**Files:** `src-tauri/src/commands/settings.rs:55-60`; `src-tauri/src/ai/endpoint.rs:101-106,121-130`;
`apps/desktop/src/copy/messages.ts:27-28`.

`requires_stored_key()` returns `false` for Ollama on the stated grounds that it is "local and
unauthenticated — nothing leaves the machine at all". But `resolve` accepts **any** `http://` or
`https://` base URL for Ollama (`validate_http_base_url` checks only the scheme), and the mode
indicator renders `snippets sent to ollama` — the provider name, never the host.

**Verified** by reading `validate_http_base_url` (no host check) and `MODE_INDICATOR.ai` (no host
interpolation), and by the module's own test `ollama_resolves_from_the_real_stored_base_url`, which
happily resolves `http://10.0.0.5:11434/api/chat`.

**Impact.** A user — or anything that can write `settings.json` — can set provider `ollama` with a
remote `ollamaBaseUrl` and have repo snippets sent to an arbitrary remote host, with **no credential
gate at all** and a UI that implies the traffic is local. This is a user-controlled setting rather
than an attack, hence MEDIUM; but the reasoning that justifies skipping the credential check is not
enforced by anything.

**Fix.** Either restrict `ollamaBaseUrl` to loopback / link-local / private addresses in
`validate_http_base_url`, or interpolate the resolved host into the mode indicator and the
`SentPayloadDisclosure` line so the privacy claim always names where bytes actually go. Prefer the
second — it closes the same gap for `openai-compatible`.

#### M3 — `analyze_repo` does not enforce the path-provenance half of its capability check

**File:** `src-tauri/src/commands/analyze.rs:33-52`.

Section 12's capability table requires the analysed path to be "user-selected via the dialog or
present in `recentRepos`". `validate_path` checks non-empty, `<= PATH_ARG_MAX_BYTES`, exists, is a
directory, and is not a system root — the provenance check is absent, and there is no `DECISIONS.md`
entry recording it as an accepted deviation (grep for `recentRepos` / `user-selected` in `docs/`
returns nothing).

**Impact.** Any path the webview supplies becomes an analysed session; `read_repo_file` then confines
to *that* root, and with AI on `engine.snippets` will read from it. Not currently exploitable — the
CSP has no remote origin, there is no `dangerouslySetInnerHTML` anywhere (grep matches only two doc
comments saying it is not used), and model output is rendered exclusively as React text nodes — so
this is defence-in-depth that the spec asked for and did not get.

**Fix.** Have `pick_repo_folder` record the picked path (in `recentRepos` or a session set) and have
`analyze_repo` require membership, refusing anything else with the existing `E_PATH_NOT_FOUND` copy.
Alternatively record an explicit deviation in `DECISIONS.md` if the owner judges the check redundant.

#### M4 — Redaction corpus gaps: several common secret shapes survive R2  — **RESOLVED**

**File:** `src-tauri/src/privacy/patterns.rs:104-133,242-279`.

**Verified by execution** against the real `apply_single_line_rules`:

| Input line | Result |
|---|---|
| `Authorization: Basic YWRtaW46c3VwZXJzZWNyZXRwYXNzd29yZA==` | **not redacted** |
| `Authorization: Bearer abcdef1234567890abcdef1234567890` | **not redacted** |
| `const s = "d41d8cd98f00b204e9800998ecf8427e5f2a3b4c";` | **not redacted** |
| a high-entropy secret inside a backtick template literal | **not redacted** |
| `MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEA...` (PEM body, no markers) | **not redacted** |
| `// key: sk-proj-Ab1Cd2...` | redacted (rule 11) |
| `//registry.npmjs.org/:_authToken=npm_aBcD...` | redacted (rule 11) |
| `an `sk-ant-` prefix followed by 30 lowercase-alphanumeric characters (elided: the literal itself is credential-shaped and blocks push protection — see `privacy::fake_secrets::anthropic_key()`, which assembles it)` | redacted (rule 8) |

Why each gap exists: rule 11's value group is a run of non-space, non-quote characters starting
**immediately** after the `:`/`=`, so in `Authorization: Basic ...` the value it sees is `Basic`
(5 characters, below the 8-character minimum) and the whole rule fails; rule 12 recognises only
double- and single-quoted literals, so backtick template literals are invisible to it; a
40-character hex string has 2 character classes (below `HIGH_ENTROPY_MIN_CHAR_CLASSES` = 3) and
about 3.8 bits/char (below 4.0), so it fails rule 12 twice over.

**Impact.** A secret in any of those shapes is sent to the provider verbatim and written into the
transcript. R3 does **not** catch this: idempotence detects a rule that fails to converge, never a
rule that never matched. The corpus test cannot catch it either — it asserts that every *planted*
secret is redacted, and these shapes are not planted.

**Fix (additive; log in `DECISIONS.md`, since 8.9's rule list is frozen):** allow an auth scheme
between the operator and the value in rule 11, or add an explicit case-insensitive
`authorization: (basic|bearer|token) <token>` rule; extend rule 12's literal detection to
backtick-delimited strings; add a long-hex-blob rule, which is the standard shape rule 12's
character-class requirement structurally cannot reach. Add each new shape to `PLANTED_SECRETS` so
the corpus test covers it.

#### M5 — The egress-chokepoint checker can be defeated three ways  — **RESOLVED**

**File:** `src-tauri/src/bin/check_egress_chokepoint.rs:91-125,193-210`.

The brief asked whether this checker can be defeated rather than trusted. It can:

1. **Manifest sections it never reads.** `parse_direct_dependency_keys` enters dependency-scanning
   mode only on a line that is exactly the `[dependencies]` header. A `[dependencies.ureq]`
   sub-table header, or a platform-conditional `[target."cfg(windows)".dependencies]` header, both
   turn scanning OFF instead, so a second HTTP client added in either form passes the check.
2. **Import aliasing.** `scan_source_imports` matches the literal substring `name::`. Writing
   `use reqwest as h;` and then `h::blocking::Client::new()` never produces `reqwest::` in that
   file, so a second client in a second file passes the "exactly one file" check. (The common
   `use reqwest::blocking::Client;` form *is* caught — that `use` line contains the substring.)
3. **Doors that need no crate at all.** The banned list is HTTP/TLS crates only. `std::net::TcpStream`,
   `std::net::UdpSocket`, `std::process::Command` invoking curl, and the already-granted
   `shell:allow-execute` capability are outside its scope entirely.

**Verified the crate is clean today regardless:** a grep for `std::net`, `TcpStream` and `UdpSocket`
under `src/` matches only inside `#[cfg(test)]` modules (`ai/anthropic.rs:210`, `ai/ollama.rs:215`,
`ai/openai_compatible.rs:179`, `commands/ai.rs:497` — all local `TcpListener`s in tests);
`Command::new` appears only at `sidecar/spawn.rs:24`; `reqwest` appears in exactly one file
(`ai/http.rs`, 18 occurrences).

**Fix.** Parse the manifest with the `toml` crate, or at minimum treat any header beginning
`[dependencies` or containing `.dependencies]` as in scope; match a `use <name>` prefix in addition
to `name::` to catch aliasing; add `std::net::`, `std::process::Command` and `Command::new` to a
second, *reporting* list scanned outside `sidecar/spawn.rs`, so a new process or socket door is at
least visible in CI output.

#### M6 — The AI transcript has no lifecycle: no clear button, no bound, no rotation

**File:** `src-tauri/src/ai/transcript.rs:71-103`; UI: nothing.

Section 12 states the transcript "is cleared by a Settings button". A case-insensitive grep for
`transcript` across `apps/desktop/src` returns **zero matches** — the button does not exist, and
neither does a `clear_transcript` command. The file grows unbounded (append-only, one JSON line per
request, each carrying up to 98,304 bytes of source text) with no rotation, unlike `onboard.log`,
which does rotate.

**Fix.** Add a `clear_ai_transcript` command plus the Settings button Section 12 promises, and either
cap the file or rotate it the way `util::logging::RotatingLogger` already does.

#### M7 — Transcript files are created with default permissions

**File:** `src-tauri/src/ai/transcript.rs:95-99`.

`OpenOptions::new().create(true).append(true)` yields umask-default permissions (commonly `0644`) on
Unix and inherits the parent ACL on Windows. The file holds real — redacted, but real — excerpts of
the user's private source, and is the one artefact this design deliberately writes to disk.

**Fix.** On Unix set mode `0600` via `std::os::unix::fs::OpenOptionsExt`, and create `transcripts/`
with mode `0700`.

---

### LOW

- **L1** `commands/settings.rs:254-262` — `store_ai_key_core` does not call `validate_provider`; only
  the Tauri wrapper (`commands/mod.rs:165`) does. The core is `pub`, so a future caller could create
  arbitrary keychain accounts. Move the validation into the core.
- **L2** `ai/snippets.rs:49-54`, `commands/search.rs:74-79`, `commands/analyze.rs:96-101` — a raw
  `serde_json` error string is interpolated into `AppError.message`. Section 12's error hygiene puts
  raw strings in `.detail`; `ai/http.rs` follows that rule correctly and these three do not.
- **L3** `commands/settings.rs:145-150` — `read_settings_file` swallows every read/parse failure and
  silently returns `Settings::default()`. Fail-safe for AI (defaults to off), but a corrupt
  `settings.json` discards the user's configuration with no diagnostic and no `E_INVALID_SETTINGS`.
- **L4** `apps/desktop/src/components/AiPanel/ai-availability.ts:19-21` — a second definition of the
  provider-aware credential rule, mirroring `AiProvider::requires_stored_key` as a not-equal-to-ollama
  test. It is display-only and fails safe for an unknown provider, but it is the one place the
  "defined exactly once" invariant is not literally true. Prefer deriving it from a backend value.
- **L5** `capabilities/default.json:17-27` — `shell:allow-execute` is granted to the webview although
  the sidecar is spawned from Rust (`sidecar/spawn.rs:24`, `std::process::Command`). The scope is
  correctly tightened (one binary, one literal flag, a validator on the value — all asserted by
  `tests/lockdown.rs:69-115`), but the capability appears unused and could be removed entirely,
  leaving the webview with no process-spawn primitive at all.
- **L6** `apps/desktop/src/state/aiStore.ts:57-61` — `AiActionResult` enters the store without a zod
  re-parse, unlike `AnalysisEnvelope` (`repoStore.ts:97`) and `Settings` (`settingsStore.ts:56`).
  Section 12 names only `AnalysisEnvelope`, so this is consistency rather than a violation.
- **L7** `apps/desktop/src/ipc/ipc.ts:10` — `mock-ipc` is imported unconditionally, so the fixture
  implementation ships in the production bundle even though `resolveIpcMode()` can never select it
  when `VITE_IPC` is unset. Dead weight, not a leak (the fixture contains no real data).

---

## 3. Invariants: what was verified, and how

| # | Invariant | Verdict | How verified |
|---|---|---|---|
| 1 | `reqwest` in exactly one file | **HOLDS** | `grep -rn reqwest --include=*.rs src/ tests/` gives 18 hits, all in `src/ai/http.rs`. `Cargo.toml:47` is the only HTTP client in `[dependencies]`. |
| 1 | `EgressPermit` is the sole gate | **HOLDS** | Private field, no public constructor (`ai/permit.rs:62-71`); `http::send`'s first parameter is `&EgressPermit` (`ai/http.rs:243-250`); all six `send` call sites pass a permit from `permit::acquire`. `tests/ai_permit_compile_fail.rs` builds real external crates and asserts the specific rustc error code (E0451/E0599/E0277) plus a keyword, not merely "it failed". |
| 1 | `permit::acquire` is the only production read of the gate flags | **HOLDS (one benign exception)** | `grep -rn is_enabled src/`: the only non-test read is `ai/permit.rs:80`. `grep -rn has_key src/`: non-test reads are `ai/permit.rs:83` (the gate) and `commands/settings.rs:170`, where `get_settings_core` recomputes the display-only `hasStoredKey` flag — not a gate, and it overwrites the on-disk value rather than trusting it. |
| 1 | `requires_stored_key` defined once; no ollama special case | **HOLDS in Rust** | Defined once at `commands/settings.rs:55-60`, called once at `ai/permit.rs:83`. No provider-equality gate anywhere; the other `Ollama` matches are closed-enum dispatch (`provider_shape`, `endpoint::resolve`, adapter selection) plus one error-copy remap (`ai/ollama.rs:142`). A display-only TS mirror exists — see L4. |
| 1 | The chokepoint checker cannot be defeated | **DOES NOT HOLD** | See M5 — three concrete evasions found by reading `parse_direct_dependency_keys` and `scan_source_imports`. The crate is nevertheless clean today, verified independently by grep. |
| 2 | `RedactedPayload` has no public constructor | **HOLDS** | Private `files` field; no `new`/`Default`/`Deserialize`/`From` (`privacy/redact.rs:113-115`); the only struct literal is inside `redact()` at `:256`. `tests/redaction_compile_fail.rs` compiles four real external crates and asserts E0451/E0599/E0277 with keyword matching — a genuinely non-vacuous compile-fail harness. |
| 2 | Nothing reaches the wire without redaction | **HOLDS** | `send` takes `&PromptSpec`; `PromptSpec` has private fields and is built only by `prompt::build(feature, payload)` (`ai/prompt.rs:183-198`); `build_body` (`ai/http.rs:164-194`) draws content only from `task()`, `subject()` and `payload()`. There is no `body` parameter. `ai::http::test_support` walks every string leaf of a really-received body against an allow-set. |
| 2 | R3 idempotence abort | **HOLDS** | `redact.rs:202-208,233-235`; both directions unit-tested; the `proptest` idempotence and line-count properties pass. `cargo test --lib privacy::` ran during this audit: 49 passed, 0 failed. |
| 2 | The rule corpus is complete | **DOES NOT HOLD** | See M4 — five shapes demonstrated surviving, via a probe calling the real `apply_single_line_rules`. |
| 3 | Every `ai_*` runs the ordered pipeline | **HOLDS** | One implementation (`commands/ai.rs:352-439`); the three commands differ only in their `AiRequest`. `trace.ensure_ready_to_send()` at `:412` precedes the send at `:415`; `ensure_complete_and_ordered()` at `:429` precedes the return. `cargo test --lib ai::pipeline` ran during this audit: 6 passed, including missing-transcript, wrong-order and empty-trace cases. The transcript-ordering test samples the file's existence from the *server thread at request arrival*, which is real ordering evidence rather than "both happened". |
| 3 | No route to `http::send` bypassing the trace | **PARTIALLY** | All six call sites enumerated. The three `complete` paths are reachable only through `run_ai_feature`. The three `run_test` paths (`test_ai_key`) bypass the trace — see M1. They cannot carry repo content (empty payload by construction), so redaction is intact; the transcript and rate-limit guarantees are not. |
| 4 | Cited paths must exist in the index | **HOLDS for backtick/link citations** | `verify_citations.rs:164-166`, tested both directions. Normalisation tricks checked: `..` segments and absolute paths survive `normalize_path` and simply miss the index, so they are rejected (fail-closed); a backslash cannot appear in a candidate at all because the extraction character class is word-characters, dot, dash and slash only, so a Windows-style path fragments into a non-indexed candidate and is rejected; percent-encoding and unicode lookalikes are likewise outside the class. Index keys pass through the same `normalize_path` (`:85-92`), so there is no asymmetry to exploit. |
| 4 | A cited line must exist | **DOES NOT HOLD** | Correct for backticked and linked citations (`:169-177`); bypassed by injected tokens — see H1. |
| 4 | An uncited answer is rejected | **HOLDS** | `NonZeroUsize::new(...).ok_or_else(AppError::ai_answer_uncited)` at `:316-317`; `VerifiedAnswer` has private fields and one constructor. Confirmed empirically: an answer consisting only of an injected token yields `E_AI_CITATION_REJECTED` with count 0. |
| 4 | The UI cannot linkify what the verifier did not check | **HOLDS as a second layer** | `answer-tokens.ts:42` treats only the `[[path:line]]` form as a citation; `AnswerMarkdown.tsx:49-52` additionally requires the path to be present in `citedPaths`, rendering anything else as inert text. This is what keeps H1 out of CRITICAL. |
| 5 | Keys never reach `settings.json` | **HOLDS** | `Settings`/`AiSettings` have no key field (`commands/settings.rs:71-110`); `has_stored_key` is recomputed live at `:170` and never read as a gate. |
| 5 | Keys never reach logs, transcript, errors or the UI | **HOLDS** | `AiKey`'s `Debug`/`Display` render the redaction marker; `reveal()` is `pub(crate)` and called only in the two `build_headers` functions; `transcript::record` records the body and deliberately never the headers (`ai/transcript.rs:21-24`), and `build_body`'s output contains no header data; `map_http_error` and `build_network_error` keep provider bodies in `.detail` only, with four dedicated tests; the UI key input is a password field held in local component state, cleared after store and never persisted (`AiSettingsSection.tsx:113-142`, `settingsStore.ts:64-68`). |
| 5 | Transcript location and contents | **HOLDS, with M6/M7** | Path is `<appDataDir>/onboard/transcripts/<repoId>.jsonl` (`commands/mod.rs:217`, `ai/transcript.rs:44-46`); `repoId` is validated against the 16-hex pattern *before* it becomes a file name (`commands/ai.rs:361`), so no traversal is possible. Contents are the post-redaction body only — asserted byte-identical to what `send` builds, and cross-checked against a real socket. Lifecycle and permissions are the gaps. |
| 6 | CSP has no remote origin | **HOLDS** | `tauri.conf.json:23`; `tests/lockdown.rs:13-38` parses the real file and checks `connect-src` token by token rather than by substring — passed during this audit. |
| 6 | No `http:` or `fs:` capability | **HOLDS** | `capabilities/default.json:6-28`; `tests/lockdown.rs:40-67` — passed. |
| 6 | Sidecar arg scope still closed | **HOLDS** | `capabilities/default.json:24` allows exactly the literal `--grammars-dir` plus one validator-constrained value; `tests/lockdown.rs:69-115` fails if `args` becomes a boolean, if the list is not exactly two entries, if the literal changes, or if the value loses its validator — passed. See L5 on whether the capability is needed at all. |
| 6 | Path traversal on every path-taking command | **HOLDS** | `read_repo_file`: repo-id regex, non-empty and at most 4096-byte path, absolute/root-component rejection, `canonicalize` of both root and target, then component-wise `Path::starts_with` (`util/paths.rs:78-113`) — a string-prefix sibling such as a `repo-evil` directory cannot pass. `engine.snippets`/`engine.readFile`: dot-dot segment rejection plus `realpathSync` containment (`engine/src/rpc/repo-path-guard.ts`). Repo picking: see M3 for the one missing check. |
| 7 | Input validation at every boundary | **MOSTLY HOLDS** | Tauri commands: repo id 16-hex, query 1-200, limit 1-200, path 1-4096 bytes, key 8-512, module id 1-200, question 1-500, provider enumerated. Sidecar to Rust: `serde_json::from_value` into typed contract structs, and a malformed JSON-RPC frame poisons the connection rather than being partially trusted (`sidecar/rpc.rs:147-221`). Provider responses: parsed defensively with option chains, never `unwrap`. Settings: typed serde with a defaulted field for backward compatibility. Gaps: M3, L3. |
| 8 | Dependencies | **HOLDS** | Re-run during this audit — see section 4. |

---

## 4. Dependencies

### UPDATE 2026-09-08 — four HIGH advisories in `bun audit`, none of them shipped

`bun audit` reports **4 high-severity advisories** and has done for at least
two `main` runs. Criterion 26 turns on this document, so the question is not
whether the advisories exist but whether any of them reaches a user. **None
does**, and the evidence for that is two independent lines that agree.

| advisory | package | installed | fixed in |
|---|---|---|---|
| GHSA-2v37-7h3g-55p8 — infinite loop when `size` is zero | nanoid | 3.3.16 | **3.3.18** |
| GHSA-5p4m-2wfm-xmqj — quadratic CPU in `!!omap` | js-yaml | 4.3.0 | **4.3.1** |
| GHSA-ggr8-5vv4-36mx — stack exhaustion on recursive graphs | deepmerge-ts | 7.1.5 | — |
| GHSA-jmr9-qjv8-65gv — unvalidated symlink path traversal | extract-zip | 2.0.1 | — |

**Line 1 — dependency path.** Every one terminates at a `dev` dependency of
`@onboard/desktop`, traced with `bun why`:

- `nanoid` <- `postcss` <- `vite` <- `vite-node` <- `vitest` (test runner)
- `js-yaml` <- `mocha` <- `@wdio/mocha-framework` (e2e)
- `deepmerge-ts` <- `@wdio/config` <- `@wdio/cli` (e2e)
- `extract-zip` <- `@puppeteer/browsers` <- `@wdio/utils` (e2e driver download)

**Line 2 — signature scan of the artefacts themselves**, which is the claim
that actually matters, because "dev dependency" is a statement about intent and
a bundler can still inline something. All nine shipped artefacts were scanned
for library-specific byte signatures (`useandom-26T198340PX75px…` and
`urlAlphabet` for nanoid; `YAMLException`; `deepmergeCustom`; `ZipFile`) — the
four frontend chunks in `apps/desktop/dist/assets`, the four compiled engine
sidecars, and `onboard.exe`. **Zero matches.**

**A false positive worth recording, because it nearly became the conclusion.**
A plain `grep nanoid` over the frontend bundle DOES match, twice, and was
initially reported as "nanoid ships". It does not: both hits are **zod's
string-format validator name** — `z.string().nanoid()` — the word appearing as
a format identifier in zod's own code, with no nanoid library present. Grepping
for a package NAME finds the name; only a signature finds the package.

**Assessment.** No open CRITICAL or HIGH finding reaches a shipped artefact, so
criterion 26 holds. The advisories are real and remain open in the dev
toolchain, where the exposure is a developer running the test suite or the e2e
driver download — not a user running Onboard.

**Remedy, and it is cheap for the two that name a fix.** `nanoid` 3.3.18
satisfies `postcss`'s `^3.3.16`, and `js-yaml` 4.3.1 satisfies `mocha`'s
`^4.1.0` — both are lockfile-only bumps with no API change and no major move.
`deepmerge-ts` and `extract-zip` name no fixed version in the advisory data as
read here and need checking separately. Filed as its own change rather than
folded into v0.1.5, which was already tagged when this was found.

### UPDATE 2026-09-09 — the sweep above was resolved, and three of its statements were wrong by the time it was read

The remedy the entry above proposed was applied. Doing so found that **the
advisory set had moved underneath the document in the 24 hours between writing
it and acting on it**, in three separate ways — which is itself the finding, and
the reason this correction is appended rather than the table above being
quietly edited.

**Correction 1 — it was never four; it is six.** Two advisories landed after
that entry was written: a second `js-yaml` one (GHSA-2883-xcg3-v3hh) and a
second `extract-zip` one (GHSA-7pqw-9j4j-h8q3). A third, against `vitest` /
`@vitest/mocker` (GHSA-82fw-gwwq-j7x9, moderate, path traversal via the mocker
redirect), was present and **not counted at all** — the entry above says "4
high-severity advisories", which was true of the highs and silently dropped the
moderate. `bun audit` reported 8 vulnerability records across 6 packages.

**Correction 2 — `js-yaml` 4.3.1 is not enough.** The entry names 4.3.1 as the
fix. That closes GHSA-5p4m-2wfm-xmqj only; the newer GHSA-2883-xcg3-v3hh is
`>=4.0.0 <4.3.2`. The correct target is **4.3.2**, which still satisfies
`mocha`'s `^4.1.0` — so the remedy is the same shape, one version further on.

**Correction 3 — `deepmerge-ts` does have a fix.** The table above records "—"
for it. `deepmerge-ts` 8.0.0 closes GHSA-ggr8-5vv4-36mx and 8.0.2 is published.
It crosses a major from the installed 7.1.5, and the four `@wdio/*` consumers
declare `^7.0.3`, so it needs an override rather than a resolution bump — but
its export surface at v8 is a strict superset of v7's (checked directly against
both `dist/index.mjs`), and `verify:js` is green on it.

**What was applied.** Five of the six fixed, one accepted:

| advisory | package | was | now | how |
|---|---|---|---|---|
| GHSA-2v37-7h3g-55p8 | nanoid | 3.3.16 | **3.3.18** | root `overrides` |
| GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh | js-yaml | 4.3.0 | **4.3.2** | root `overrides` |
| GHSA-ggr8-5vv4-36mx | deepmerge-ts | 7.1.5 | **8.0.2** | root `overrides` |
| GHSA-82fw-gwwq-j7x9 | vitest, @vitest/mocker | 3.2.7 | **4.1.11** | direct dep bump in `apps/desktop` |
| GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3 | extract-zip | 2.0.1 | 2.0.1 | **no fix exists** — see `docs/KNOWN_ISSUES.md` KI-13 |

`bun audit` now exits 0 with the two extract-zip IDs named explicitly in
`.github/workflows/ci.yml`, and exits 1 if either name is removed.

**A trap in the remedy, recorded because the obvious spelling is the wrong
one.** The first attempt wrote the overrides as `>=3.3.18` / `>=4.3.2`, matching
the `>=` style of the three overrides already in `package.json`. Open-ended
ranges do not stop at the fix: bun resolved **nanoid 6.0.1** and **js-yaml
5.4.1** — two major versions past the advisory, into an ESM-only `nanoid` that
`postcss` (CJS, `^3.3.16`) cannot load and a `js-yaml` 5 that `mocha`'s
`^4.1.0` does not admit. A patch-level security bump had become an unrequested
major upgrade of two transitive dependencies. The overrides are therefore
written `^3.3.18` / `^4.3.2` / `^8.0.0` — bounded to the major that carries the
fix. The pre-existing `>=` overrides are left alone deliberately: they resolve
correctly today, and changing them is a separate question from this one.

**And a trap in the verification, which is the more important half.**
`bun audit` reads the **lockfile**. After an incremental `bun install`, the
lockfile said `deepmerge-ts@8.0.2` and `bun audit` was clean — while
`node_modules/.bun/@wdio+config@.../node_modules/deepmerge-ts` on disk was
**still 7.1.5**, a stale directory the incremental install had not pruned. The
gate was green and the installed tree was not fixed. Only `rm -rf node_modules
&& bun install` collapsed it to one copy of each, which is the state the table
above is verified against. **A lockfile-reading gate proves what would be
installed, never what is installed** — the same distinction that made every
pre-2026-07-28 green run in this repository unreproducible, arriving from the
other direction.

---

Re-verified at HEAD `28b96f4`.

- **`bun audit`** (bun 1.3.14, repo root): **No vulnerabilities found.** The `overrides` block in
  `package.json:24-27` (`brace-expansion >= 5.0.8`, `serialize-javascript >= 7.0.7`) is what keeps it
  that way; both are dev-only transitive dependencies.
- **`cargo audit`** (`apps/desktop/src-tauri`, 549 crates scanned against 1170 advisories):
  **0 vulnerabilities; 17 allowed warnings.**

Assessment of the 17 informational findings against *this* threat model:

- **16 unmaintained** — the GTK3 binding family (`atk`, `atk-sys`, `gdk`, `gdk-sys`,
  `gdkwayland-sys`, `gdkx11`, `gdkx11-sys` and siblings), the `unic-*` family, and
  `proc-macro-error`. The GTK3 crates are Linux-only transitive dependencies of Tauri's WebKitGTK
  webview; the `unic-*` crates are IDNA/unicode tables reached through `url`/`idna`;
  `proc-macro-error` is build-time only and is not present in the shipped binary. "Unmaintained" is a
  maintenance signal, not a vulnerability, and none of them is a direct dependency (verified against
  `Cargo.toml:31-48`).
- **1 unsound — RUSTSEC-2024-0429, `glib` 0.18.5**: unsoundness in the `Iterator` and
  `DoubleEndedIterator` implementations for `glib::VariantStrIter`. Reachable only by code that
  constructs and iterates a `VariantStrIter`. This crate never touches glib — a grep for `glib::`
  under `apps/desktop/src-tauri/src` returns nothing — so the only possible reach is inside
  Tauri/WebKitGTK internals, on Linux, driven by data the app itself supplies. Under Section 12's
  threat model (no remote attacker, local trusted input) the practical risk is negligible.

**Conclusion:** no unpatched high-severity advisory. All 17 are accepted; they are resolvable only by
Tauri moving off GTK3, which is outside this project's control. Re-check on every Tauri bump — and
note that neither audit runs in CI today (H2), so "clean" is a point-in-time statement about this
commit only.

---

## 5. Summary

| Severity | Open | Resolved | Findings |
|---|---|---|---|
| **CRITICAL** | **0** | — | — |
| **HIGH** | **0** | 3 | ~~H1 citation-token injection~~ · ~~H2 Rust security suite unenforced in CI~~ · ~~H3 `ai_*` features unwired in the real IPC~~ |
| **MEDIUM** | **5** | 2 | M1 `test_ai_key` outside the pipeline · M2 unenforced Ollama locality · M3 missing repo-provenance check · ~~M4 redaction corpus gaps~~ · ~~M5 defeatable chokepoint checker~~ · M6 transcript lifecycle · M7 transcript permissions |
| **LOW** | **7** | — | L1-L7 above |

**Phase 13 gate status: MET.** Zero open CRITICAL, zero open HIGH.

### Resolution log

| ID | Status | Fix | Verified by |
|---|---|---|---|
| H1 | **RESOLVED** | The verifier's output grammar is now illegitimate in its input: a `[[…]]` token anywhere in the raw answer rejects the whole answer (`reject_forged_tokens`), and `ensure_every_token_was_emitted` re-derives the same property from the finished buffer. | Reproduced first as two failing tests, then green. Mutation probes: disabling the rule leaves the post-condition catching every forgery; disabling the post-condition leaves the rule catching the end-to-end cases; each layer now has its own direct test, so deleting either fails something. 28 tests in the module. |
| H2 | **RESOLVED** | CI extended to run `cargo test --no-fail-fast`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo fmt --all --check`, `cargo audit --deny warnings`, `bun audit`, the chokepoint checker and the engine's `verify:no-network`. | Every added command run locally with output recorded. `--no-fail-fast` proved necessary: a plain `cargo test` stopped at the failing lib target and never ran `lockdown.rs` or any compile-fail suite. Each gate was additionally shown catching a planted regression. |
| H3 | **RESOLVED** | The three `ai_*` commands are wired through the real Tauri IPC; the lying `aiNotYetImplemented` stub is deleted. | A seam guard mocked at `@tauri-apps/api/core`'s `invoke` asserts command name and args per command, requires adapter/mock key parity, and reads `lib.rs` to assert set equality with the commands Rust registers. Shown failing against the stub (8 failures) before the fix, and against a typo'd name, a dropped arg, and a drifted table entry. |
| M4 | **RESOLVED** | R2 gains rules 13-15 (auth headers, hex blobs, base64 blobs) by appending; rule 12 additionally recognises backtick template literals. | Before/after produced by running the real `apply_single_line_rules` at git HEAD vs. now: all five demonstrated misses redact. Corpus 30 -> 37 planted secrets, 5 negative controls still byte-identical, R3 idempotence proptests still pass. |
| M5 | **RESOLVED** | Sub-table and `target.cfg` dependency headers, aliased imports, and `std::net` / `std::process::Command` are all now caught; an unparseable dependency table is a violation rather than a skip. | Each of the four evasions planted in the real tree: old checker exits 0, hardened checker exits 1. Probes then removed. |

**Caveat on H2.** The workflow is validated (`actionlint` clean, YAML parses) and every command it runs
was executed locally, but the workflow itself has not yet run on GitHub. Three things can only be
confirmed by a real CI run: the apt package list building the crate on ubuntu-22.04, whether
`unshare -rn` is permitted on the runner, and Linux keychain behaviour under A18's session-only
fallback. All three fail loudly rather than silently if wrong.

**Caveat on M4.** The corpus proves the shapes it contains are caught. It is not a proof of
completeness, and R3 idempotence is not coverage — a secret shape no rule matches is idempotently
un-redacted. This row is "resolved" for the demonstrated shapes only.

Remaining open findings (5 MEDIUM, 7 LOW) do not block the gate and are carried into Phase 14:
M1/M2/M3/M6/M7 to `rust-tauri`, L4/L6/L7 to `react-ui`. Two handoffs also arose from the fixes: the
`wdio.conf.ts` fixed-port race that makes e2e unfit for a per-push gate (`react-ui`), and a
`rust-toolchain.toml` pin so `stable` drift cannot break `-D warnings` (`rust-tauri`).

---

## 6. Coverage of this audit — added 2026-07-28

### The claim this document is entitled to make

**"Zero open CRITICAL and zero open HIGH" is a claim about what was examined, not a
claim about what exists.**

That sentence is added because a real fail-open was found afterwards, in a method this
audit had inspected twice.

### The evidence behind every figure in this document is also narrower than it looks

**Every green run in this project before 2026-07-28 — every `verify` exit 0, every
coverage figure, every test count, including the ones cited in this audit — executed
against a `node_modules` that no clean checkout reproduces.** Those results are not
known to be wrong. They are *unverified*: nothing has yet re-derived them on a tree
that a fresh checkout actually produces.

The cause is mundane and was invisible from inside the machine that had it. A stale
local install carried `brace-expansion@1.1.16` and `@2.1.2` alongside `@5.0.8`, so
`minimatch@3` resolved to a compatible copy here and to the incompatible v5 on every
clean install — the divergence that GHSA-mh99-v99m-4gvg's override introduces
everywhere else. `bun install` is permitted to resolve differently from `bun.lock` and
rewrite it in place, so CI reproduced the same class of drift rather than catching it.
Wiping `node_modules` and reinstalling from the frozen lockfile changed nothing else
about the tree.

This is the same defect as INV-3 one level out: the checks ran, reported, and were
believed, and no one asked what they were running *against*. The durable half of the
fix is `--frozen-lockfile` at every workflow install site, enforced by
`scripts/ci-install-check.py` over a derived scope so a new job cannot reintroduce it.
The remaining half is a green run: **until `verify` completes on a frozen clean
install, treat every figure in this document as attested but not reproduced.**

### INV-3, and how it was missed

`engine.snippets` silently discarded any path that failed repo containment. This audit
examined that method and recorded two conclusions, both correct:

- §2 CRITICAL, "specifically checked and not found": *"a path-traversal escape in
  `read_repo_file`, `engine.readFile`, or `engine.snippets`"*
- §3 invariant 6, **HOLDS**: *"`engine.snippets`/`engine.readFile`: dot-dot segment
  rejection plus `realpathSync` containment"*

Both asked **whether a path can escape**. Neither asked **what the method does with a
path that fails**. The answer was: drop it, return a shorter array, tell nobody.

It was not undiscoverable. `docs/DECISIONS.md`'s Phase 5 entry flagged it explicitly —
*"flagged here for the AI-path owner to confirm or override"* — in the same file this
audit was reading. A search of this document for "silently omit" / "partial" / "drops"
returns nothing.

### Why it reached the user interface

Nothing between the engine and the UI compared paths requested against snippets
returned. So a dropped path produced a shorter array, `redact()` saw only survivors,
and `RedactedPayload::sent_file_count()` — which counts what survived, not what was
asked for — reported it as the total. The UI displayed **"23 files sent"**.

That number is accurate. It satisfies acceptance criterion 17's *"the UI displays the
actual `sentFileCount`"*. **The criterion was met, and meeting it is what hid the
refusal.** A user auditing what left their machine saw a truthful count with no
indication that a security control had fired.

### The method finding, which generalises

This audit's method was: enumerate the invariants and check that each holds. That
method catches *"can the guard be bypassed"* and **cannot, structurally, surface what a
guard does when it fires** — no invariant in §3's table asks that question. Every
fail-open in this codebase is invisible to it. INV-3 is the one now known.

A derived sweep of every guard, refusal and validation point — recording, for each,
what it does when it fires (errors, returns null, drops silently, logs, continues) —
is tracked in `docs/KNOWN_ISSUES.md`.

### Status

Fixed. `engine.snippets` refuses the whole request on any bad path (Section 8.9 R3's
precedent: never send a partially validated set), and `ai::snippets::fetch` treats
`returned.len() != requested.len()` as an error so a future silent drop anywhere
upstream fails at the boundary instead of laundering into a smaller number.

**Acceptance criterion 26 was PARTIAL** until a re-audit was performed with a method
that can see fail-open behaviour. That sweep is now done — `docs/KNOWN_ISSUES.md`,
derived by `scripts/guard-disposition-scan.py` over 285 absorbing sites in 181 files.

It found two further fail-opens, both on security boundaries, and both are FIXED with
a test that fails against the old code: a cited line number too large for `u64`
bypassed the citation range check entirely (KI-1), and the no-network module poison
was reversible by plain assignment while `fetch` was not (KI-2).

Two limits of that sweep bound what this criterion can now claim. It scans OUR code,
and both of this project's `Parser.init()` defects degraded inside a dependency — so
`web-tree-sitter` and `bun:sqlite`, the two Section 4 names whose failure modes reach
our results, are covered only by assertions on output, never by the scan. And ~280 of
the 285 sites were classified rather than individually reviewed; the triage went to
the sites matching INV-3's shape on privacy, AI, secrets, RPC, walk and cache paths.

---

## 7. M4 — what the redaction corpus proves, measured — added 2026-07-28

### The corpus proves shape coverage, not completeness

M4 accepted the corpus on the grounds that it demonstrates the SHAPES it contains are
caught, and explicitly not that the rule set is complete. Two things sharpen that,
both now measured rather than asserted.

**R3 idempotence is not coverage.** It detects a rule that fails to converge, never a
rule that never matched. Unchanged from M4's original statement, repeated here because
it is the most common misreading of what the property test buys.

### Criterion 16's evidence is the dependence proof, not the entry count

Acceptance criterion 16 asks for "≥ 30 planted secrets ... all replaced". The corpus
has 37 entries and they all pass — but **entry count is the weaker claim**, because
entries overlap. Measured directly: `aws1` (`aws_access_key_id = AKIA...`) stays
redacted with the AWS rule disabled, because rule 11's assignment heuristic also
catches it. An entry can therefore be present, passing, and never exercise the rule it
was written for.

The stronger evidence is `privacy::redact::per_rule_non_vacuity`: for each of the
eight scanner-relevant families, **at least one corpus entry survives when that
family's rule alone is disabled**. That is what proves each rule is genuinely
exercised. Eight families, eight demonstrations. Cite that test for criterion 16, not
the entry count.

### R2.12 is the only catch-all, and exactly two entries depend on it

Every rule except R2.12 (high-entropy quoted literal) keys off a recognisable prefix
or structure, so R2.12 is the whole of the corpus's defence against a secret shape
nobody enumerated.

Measured by `privacy::redact::r2_12_reliance`, which disables R2.12 alone and counts
what escapes:

> **2 of 37 corpus entries are caught ONLY by R2.12: `entropy3` and `entropy4`.**

Both use the variable name `blob`. `entropy1` and `entropy2` use `token` and
`apiSecret`, so rule 11 catches them first — which is why the corpus deliberately
includes `blob` variants. Without them, R2.12 would have no uniquely-dependent entry
and the catch-all would be untested.

**Read that number as a floor on exposure, not a reassurance.** It says the corpus
exercises R2.12 through two entries. It says nothing about the space of real secret
shapes that only R2.12 could catch, which is unbounded and unenumerated — that is
precisely M4's point. The figure is pinned by an assertion so a future rule change
fails the test rather than silently invalidating this section.
