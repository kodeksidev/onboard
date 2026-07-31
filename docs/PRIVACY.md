# Privacy

## The claim, in one sentence

**With AI turned off, Onboard makes no network connections at all, and your
code never leaves your machine.**

That is the product's central promise, and it is the default: AI is off until
you turn it on, paste a key, and confirm. This document says what that promise
covers, how it is enforced, and — at least as importantly — **what has and has
not actually been verified**.

## What "static mode" means

Static mode is the default state. In it:

- Onboard reads files from the repository you pick, and nothing else.
- It writes an analysis cache into your own application-data directory.
- It opens no sockets. There is no telemetry, no crash reporting, no analytics,
  and no update check — those are frozen non-goals, not features postponed.
- The window shows, verbatim:

  > Static mode · no network · nothing leaves this machine

That string is frozen and asserted byte-exactly in the test suite, so it cannot
drift into a softer claim without a test failing.

### How it is enforced, not just intended

- **One HTTP client in the whole repository.** `reqwest` appears exactly once,
  in `apps/desktop/src-tauri/src/ai/http.rs`. A build-time checker
  (`check_egress_chokepoint`) fails the build if a second HTTP or TLS crate is
  added, or if any other module reaches for the network. It is not a lint you
  can quietly disable — it runs in CI as its own job.
- **The engine has no network code at all.** The analysis engine is a separate
  process with no HTTP client compiled into it. CI verifies this two ways: a
  static scan of the bundle, and running a real analysis inside `unshare -rn`,
  a namespace with no network interface. If it tried to connect, it would fail.
- **The webview is locked down** by a Content-Security-Policy with no remote
  origin, asserted by a test rather than trusted.

## What changes when you enable AI

Enabling AI is explicit: you turn it on, choose a provider, and store a key.
From then on, and only for the three AI features, Onboard sends a **redacted,
capped payload** to the provider you chose.

- **Your key** is stored in the OS keychain, never in a settings file.
- **Only snippets** the engine selected are eligible to be sent — never whole
  files, and never the repository.
- **A payload is capped** at 24 files and 98,304 bytes.
- **Redaction runs first**, and if the redaction pass cannot prove its own
  output clean on a second scan, the request is **abandoned** rather than sent
  (`E_AI_PAYLOAD_UNSAFE`). Failing closed is the intended behaviour.
- **Answers are checked against the index.** An answer citing a file that does
  not exist is rejected whole (`E_AI_CITATION_REJECTED`) rather than shown with
  a broken link.
- The indicator changes to name the provider and model, so the window always
  states which mode you are in.

If you never enable AI, none of this code path runs.

---

# What is actually verified — and what is not

The section above describes the design. This section is about evidence, and it
is deliberately unflattering where the evidence is thin. A privacy claim that
only describes its own intentions is not worth much.

## The redaction corpus proves less than it appears to

There is a corpus test with ≥ 30 planted secrets, and every one is replaced.
That is real, and it is a floor, not a ceiling:

- It proves the redactor catches **the shapes in the corpus** — API keys,
  tokens and credentials of the forms someone thought to plant.
- It does **not** prove the redactor catches secret shapes nobody anticipated.
  A corpus test can only fail on what it contains.
- It says nothing about a secret embedded in an unusual encoding, split across
  lines, or in a format added to some vendor's product after the corpus was
  written.

The idempotence re-scan is the stronger guarantee, because it is
shape-independent: if a full redaction pass leaves anything the scanner still
matches, the request is abandoned. That protects against a redactor that
half-works, not against one that never recognised the secret at all.

## The security audit asked the wrong question, and we found out the hard way

This is the most important limitation on this page.

The audit enumerated invariants and asked, of each, **whether it holds**. That
is a real question and it catches real defects — *can this guard be bypassed?*
But it is structurally blind to a different one: **what does this guard do when
it fires?** A check that exists, runs, and then silently permits passes an
"does it hold" audit perfectly.

The concrete miss was `engine.snippets`. It dropped a path that failed
repository containment, returned a shorter array, and told nobody. The audit
had inspected that method **twice** and recorded two conclusions, both correct.
Correct, and blind to what the guard did on failure.

Asking the second question across the codebase — 285 absorbing sites in 181
files — found **four fail-open defects** (`KI-1`, `KI-2`, `KI-3`, `KI-6` in
`docs/KNOWN_ISSUES.md`). Every one is now dispositioned **FIXED plus a
regression TEST**, never "recorded". That policy exists because of a specific
failure: `Parser.init()`'s fail-open was *already documented in its own file
header* — and six months later the same function acquired a second fail-open of
the same shape, with the same symptom. **Documenting a fail-open does not close
it.**

**And the sweep cannot see everything.** It scans our code. Both `Parser.init()`
defects degraded inside a *dependency* — `web-tree-sitter`'s global WASM runtime
— and surfaced as a structurally valid analysis with nothing in it. No scan of
our source would have found either. Dependency degradation is covered only by
assertions on *output*, so read "no findings in a dependency" as **not looked
at**, not as clean.

`docs/KNOWN_ISSUES.md` is the honest list, with severities and dispositions.
This page links it rather than restating it, because two copies of a defect list
is how one of them goes stale.

## macOS is unverified

Everything above is verified on Windows and Linux. **On macOS it is not.**

- Tauri has no WebDriver support on macOS, so the E2E suite cannot run there
  at all.
- No macOS hardware has been available to this project, so the installer has
  never been launched on a Mac.
- `docs/MACOS_SMOKE.md` is the manual checklist that would establish it, and
  every box in it is unchecked.

The macOS binaries are *built* in CI. A runner that can produce a darwin binary
cannot run one. Treat macOS as untested rather than as working.

## The installed app was broken, and the gates did not see it

Recorded here because it is exactly the kind of thing a privacy page should not
hide. Version 0.1.0's Windows installer shipped an app that installed, launched,
and then could not start its analysis engine at all. Every automated gate passed,
because each developer machine resolved the engine through a development
fallback that does not exist on a user's machine, and the one CI job that
touched an installed package drove the engine directly instead of starting the
app.

It was found by a human installing the real thing in a clean Windows Sandbox.
Both halves are now fixed: the resolution bug, and the gap in the gates that let
it ship. The draft release carrying that installer has been deleted rather than
superseded. But the general lesson stands, and it applies to the claims on this
page too: **a gate that has never run reads exactly like a gate that passes.**
`docs/CRITERIA_MAP.md` now distinguishes gates that are wired from gates that
have been observed green, with run ids.

## What we would still like to be able to say

- That the rendered UI of an *installed* build has been driven end to end
  automatically. It has not: the test bridge is absent from release bundles by
  design, so this is covered by the manual checklist in
  `docs/SMOKE_CHECKLIST.md` instead.
- That macOS has been verified at all.
- That coverage thresholds are enforced rather than measured.

## Reporting a problem

If you find a case where Onboard sends something it should not, that is the
most serious class of bug this project has. Please open an issue with the
shape of the data (never the secret itself) and the mode you were in.
