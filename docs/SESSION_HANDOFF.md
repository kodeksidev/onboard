# Session handoff — updated 2026-07-29

Written so the next session can resume without re-deriving state. Read this
first, then verify rather than trust it: `git log --oneline -15`, `gh run list`,
`git status -sb`.

---

## 1. THE BLOCKING DECISION IS RESOLVED

The product owner chose **(D) upgrade to ESLint 10**, 2026-07-29. Recorded as an
AMENDMENT in `docs/DECISIONS.md` (bottom of file), with the Section 4 departure
named.

Two corrections to the analysis this was decided from, both found by inspecting
the resolved tree rather than reading an exit code:

- The upgrade alone does **not** close the advisory, and the override is **not**
  removable. Without it, `recursive-readdir` -> `minimatch@3`, `mocha`/`glob@8`
  -> `minimatch@5` and `typescript-estree`/`glob@10` -> `minimatch@9` still pull
  `brace-expansion` 1.1.16 and 2.1.3; `bun audit` reports 9 vulnerable paths.
  **ESLint 10 *and* the override retained** is the configuration that works.
- `@eslint/js` versions independently: it moves to `~10.0.1`, not `~10.8.0`.

After `rm -rf node_modules && bun install`, the tree contains exactly one copy of
the package: `brace-expansion@5.0.8`.

Option (A) was not taken, so no risk acceptance was recorded and none is owed.

---

## 2. REPOSITORY STATE

- Branch: **`phase13/gate-evidence`**, PR **#1** open against `main`.
- `main` = pre-rewrite Phase 13 code. All this week's work is on the branch.
- **Check for unpushed commits** — at handoff time `bd82742` was local-only.
- Remote: `https://github.com/uruqierisi/onboard.git`

**History was rewritten** with `git filter-repo` on 2026-07-28 to remove
credential-SHAPED (never real) literals that blocked GitHub push protection.

- Backup: **`C:\Users\codex\Desktop\ElevateUrBox\onboard-prerewrite-backup.git`**
  (mirror clone, verified 62/62 commits + matching refs).
  **Do not delete until CI is green and the work is merged.**
- `docs/COMMIT_MAP.md` translates pre-rewrite → post-rewrite hashes.
- `HEAD^{tree}` was byte-identical before and after — the rewrite touched only
  history.

---

## 3. CI STATE — updated 2026-07-29

Workflow triggers on `push: branches: [main]` and `pull_request`. **A branch
push alone triggers nothing** — that is why PR #1 exists.

Latest run: everything green **except** `rust gates (windows-2022)`.

| Job | Result |
|---|---|
| `verify` ×3 (macos-14, windows-2022, ubuntu-22.04) | **PASS** |
| `verify (path containing a space)` | **PASS** |
| `engine determinism gate` ×3 | **PASS** — criterion 3, first time off Windows |
| `engine no-network gate` (`unshare -rn`) | PASS |
| `rust gates (ubuntu-22.04)`, `rust fmt`, `dependency audit` | PASS |
| `rust gates (windows-2022)` | **FAIL** — darwin sidecar cross-compile |

### The one remaining failure: darwin cross-compile on Windows

```
built onboard-engine-x86_64-pc-windows-msvc.exe     <- Windows target fine
error: Failed to extract executable for 'bun-darwin-aarch64-v1.3.14'
```
Failed identically three times — not flaky. `build:sidecar` **succeeds on
ubuntu-22.04** for all four triples, so A9's "all four triples from one runner"
holds on **Linux, not Windows**. Phase 14's release job should run on Linux.
Classified **PRODUCT** (build system).

Note separately: a runner *producing* a darwin binary does not prove that binary
*runs* on macOS. Still CI-blocked.

---

## 4. THE UNVERIFIED-RESULTS FINDING — recorded, half-retired

Recorded in `docs/SECURITY_AUDIT.md` §6 in the owed terms. Every green run
before 2026-07-28 executed against a `node_modules` no clean checkout
reproduces — not wrong, *unverified*.

Durable fix landed: `--frozen-lockfile` at every workflow install site, enforced
by `scripts/ci-install-check.py` over a derived scope. `verify` now passes on a
wiped `node_modules` locally and on all four CI jobs, so the figures are being
reproduced rather than merely attested — but the audit's own numbers predate
that and have not each been re-derived.

---

## 5. QUEUED WORK — re-derived 2026-07-29

DERIVED from `docs/CRITERIA_MAP.md`, which is generated (`bun run criteria:map`)
and drift-checked inside `verify`. Do not hand-edit either. Re-run the generator
after any CI change and this list follows.

### CI-blocked, strictly

> **CI-BLOCKED means: cannot be settled without a machine we do not have.**
> A criterion waiting on an unconfigured tool, an unwritten document, or an
> unfinished paragraph is not blocked — it is unfinished. Calling it blocked
> launders ordinary remaining work into an external constraint.

**4 of 28** — #11, #12, #22, #23

- **#11** — wall-clock budgets need a consistent runner; a shared one cannot measure them honestly
- **#12** — 10s cold-open needs a real desktop session and a human with a stopwatch
- **#22** — wdio port race is tooling, but the macOS smoke half needs a Mac
- **#23** — LAUNCHING the .dmg needs a Mac; building it does not

### Not blocked, under their real cause

- **#26** (authoring) — PARTIAL by the audit's own §6 until a fail-open-aware re-audit is written
- **#10** (tooling) — coverage thresholds are enforced nowhere
- **#28** (tooling) — conventional-commit linting is not wired
- **#24** (unwritten) — docs
- **#25** (unwritten) — docs

### Work items that are not criteria, in order

1. **`analyze()` is not concurrency-safe** — now REFUSED on both sides rather
   than left to luck (DECISIONS.md, cross-domain entry). Still open: locate the
   shared mutable state (tree-sitter parser instances first) and make it
   re-entrant, so the engine can support concurrency instead of rejecting it.
2. **`wdio.conf.ts` fixed-port race** — the tooling half of #22. Allocate a free
   port per session, or poll until the driver's port accepts, before
   `newSession`.
3. M6 (transcript bound/rotation — reuse `util::logging`'s RotatingLogger;
   **the transcript is not a log**, prefer a bound with a visible notice plus
   the Settings clear button over silent deletion).
4. The Windows DACL (verify-only, `windows-sys` 0.61 authorised). Note the
   DECISIONS amendment that removed every `unsafe` from the crate: this work
   introduces the FIRST one, not the fourth.
5. INV-2 / INV-4 / INV-5 / INV-6 / INV-7..INV-11.
6. The guard-disposition sweep into `KNOWN_ISSUES.md` (the file does not exist
   yet; `SECURITY_AUDIT.md` §6 forward-references it).
7. The ~28 unread DECISIONS entries, and the DECISIONS.md restructure
   (RECORDS / AMENDMENTS / INVALIDATES / CROSS-DOMAIN).

### Closed this session

- The ESLint 10 / brace-expansion decision, with all six repo rules proven to
  still fire.
- `--frozen-lockfile` everywhere, CI stage aggregation, `setup-python`.
- The fixture files no clean checkout received, and machine-bound snapshots.
- Criterion 3 PROVEN on three platforms; the pre-registration resolved.
- The darwin cross-compile red job — by asking why it built darwin at all.
- **#24 and #25** — README.md, docs/INSTALL.md and docs/SIGNING.md now exist.

---
## 6. PRE-REGISTERED PREDICTION — RESOLVED

`docs/CI_PREREGISTRATION.md` now carries its own resolution section. Summary:
the prediction was **wrong**. Two PRODUCT findings landed first — uncommitted
fixture inputs, and snapshots bound to one machine's checkout path — and both
presented identically on all three OSes, so neither was platform-related at all.

`verify:determinism` had never been in the workflow; a gate that does not exist
reads exactly like a gate that passes. With it added on three platforms, all
three pass. **Criterion 3 is PROVEN across macOS 14, Windows 2022 and Ubuntu
22.04.** The predicted `readdir`-order mechanism was not observed anywhere.

`.gitattributes` was read and is already correct — `packages/engine/fixtures/**
-text` pins the deliberate CRLF fixture. That question stays closed.

---

## 7. ENVIRONMENT NOTES

- `bun` and `cargo` are **not on PATH** in fresh shells. Prefix:
  `$env:PATH = "$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"`
- Python is at `C:\Users\codex\AppData\Local\Programs\Python\Python312\python.exe`.
  `python3` resolves to a non-functional WindowsApps stub — do not use it.
- `git filter-repo` installed via pip; invoke as `python -m git_filter_repo`.
- `gh` CLI is installed and authenticated as `uruqierisi`.
- **Use Python scripts, not shell one-liners,** for anything touching Rust
  string literals or irreversible operations. Shell escaping cost several
  rounds of churn earlier in this work.

---

## 8. STANDING RULES ESTABLISHED THIS WEEK

These were learned expensively; do not rediscover them.

- **A check's scope must be derived, never hand-enumerated** — and the
  derivation must assert it matched something. Violated four times (bench prose
  scraping, guard tree list, RepoPath field list, docs-check allowlist).
- **An allowlist entry that matches nothing must fail**, or a renamed target
  widens the allowance silently.
- **Exempt by context, not by value**, when the value is content-addressed.
- **A gate that reports without holding is worse than no gate**; so is one that
  always fires.
- **Non-vacuity is mandatory**: every guard needs a case proving it fires on
  the thing it exists to catch.
- **Any new mechanism must be applied to the commit that introduces it.**
- **Derive summary figures; never hand-tally.** Three counting errors came from
  stated rather than derived totals.
- **Report a figure as derived, or say plainly it is a hand tally.**

- **A gate that is never invoked reads exactly like a gate that passes.**
  `verify:determinism` was a package script no CI job ran; criterion 3 looked
  PROVEN for weeks. Check that a gate is *wired in*, not just that it exists.
- **A `&&` chain in CI throws away every result after the first failure.**
  Fail-fast is right at a terminal and wrong in a run whose purpose is the full
  picture. `verify:report` runs all stages and aggregates the exit code.
- **Test inputs must be proved committed, not assumed.** A fixture's own
  `.gitignore` outranks the repository's safety net, so the files a fixture
  exists to exercise are exactly the ones git will silently drop.
- **Expected values must not embed the machine that produced them.** A snapshot
  containing a path-derived hash passes only where it was generated.
- **A check must distinguish "I found a problem" from "I cannot answer."**
  `docs:check` on a shallow clone reported correct documentation as stale — a
  wrong finding, which is worse than a missing one.
