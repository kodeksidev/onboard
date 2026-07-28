# Session handoff — 2026-07-28

Written so the next session can resume without re-deriving state. Read this
first, then verify rather than trust it: `git log --oneline -15`, `gh run list`,
`git status -sb`.

---

## 1. ONE DECISION IS BLOCKING WORK

Everything below is queued behind a choice the product owner has not yet made.
**Do not pick one unilaterally.**

`bun run verify` fails at `eslint` on **every** platform, including locally on a
clean install. Root cause, fully diagnosed:

- Root `package.json` has `"overrides": { "brace-expansion": ">=5.0.8" }`,
  added by `76f84be` to close advisory **GHSA-mh99-v99m-4gvg** (high, DoS/OOM).
- The advisory's authoritative data has **one** vulnerable range (`<= 5.0.7`)
  and **one** patched version (`5.0.8`). There is no patched v1/v2/v3/v4 line.
  (Verified via `gh api /advisories/GHSA-mh99-v99m-4gvg` — this is NOT the
  familiar June-2025 ReDoS that had per-line fixes.)
- `eslint@9.39.5` → `@eslint/config-array@0.21.2` → `minimatch@3.1.5`, which
  requires `brace-expansion@^1.1.7` and calls it as `module.exports = expand`.
  v5 changed that export shape → `TypeError: expand is not a function`.

Options, all investigated:

| | Outcome |
|---|---|
| **(a)** per-line pinning | **Impossible** — no patched v1/v2 line exists |
| **(b)** drop the override, let normal resolution close it | **Fails** — resolves `1.1.16`/`2.1.3`, both vulnerable; `bun audit` flags 9 paths |
| **(c)** drop the override, accept advisory | **Rejected** — reopens what `76f84be` closed |
| **(A)** scope override away from ESLint's subtree | Works, but ESLint then runs a vulnerable `brace-expansion`. Dev-only DoS, linter globbing our own repo, not attacker-controlled. Needs owner acceptance + a `DECISIONS.md` entry. |
| **(D)** upgrade to ESLint 10 | `@eslint/config-array` there requires `minimatch ^10.2.4` — closes the advisory everywhere and **removes the override entirely**. Cost: Section 4 pins `eslint ~9.39.0`, so this needs an AMENDMENT. |

**Owner was asked to choose between A (with recorded risk acceptance) and D
(with a Section 4 amendment). No answer yet.**

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

## 3. CI STATE

Workflow triggers on `push: branches: [main]` and `pull_request`. **A branch
push alone triggers nothing** — that is why PR #1 exists.

Latest PR run (`30401760805`):

| Job | Result |
|---|---|
| `dependency audit` | PASS |
| `engine no-network gate` (`unshare -rn`) | **PASS** — criterion 8, first time off this machine |
| `rust fmt` | PASS |
| `rust gates (ubuntu-22.04)` | **PASS** — clippy + full `cargo test` + chokepoint |
| `verify` ×3 + space-path | FAIL — eslint (section 1) |
| `rust gates (windows-2022)` | FAIL — sidecar cross-compile |

### Darwin cross-compile: failed twice, identically — not flaky

```
built onboard-engine-x86_64-pc-windows-msvc.exe     <- Windows target fine
error: Failed to extract executable for 'bun-darwin-aarch64-v1.3.14'
```
`build:sidecar` **succeeds on ubuntu-22.04** for all four triples. So A9's
"all four triples from one runner" holds on **Linux, not Windows**. Phase 14's
release job should run on Linux. Classified **PRODUCT** (build system).

Note separately: a runner *producing* a darwin binary does not prove that
binary *runs* on macOS. Still CI-blocked.

---

## 4. THE UNVERIFIED-RESULTS FINDING

**Every green run in this project before 2026-07-28 — every `verify exit 0`,
every coverage figure, every test count — executed against a `node_modules`
that no clean checkout reproduces.** Not wrong; *unverified*.

Cause: a stale local tree carried `brace-expansion@1.1.16` and `@2.1.2`
alongside `@5.0.8`, so `minimatch@3` resolved to a compatible copy locally and
to v5 everywhere clean. Fixed locally by wiping `node_modules` and
`bun install --frozen-lockfile`; nothing else changed when it was wiped.

**Owed:** a sentence in `SECURITY_AUDIT.md` next to the "what was examined, not
what exists" line, in those terms. Not yet written.

---

## 5. QUEUED WORK, in order

1. **The override decision** (section 1) — blocks everything below.
2. `--frozen-lockfile` at all five `bun install` sites in `ci.yml` (lines 80,
   105, 230, 325, 362). Durable fix, independent of brace-expansion, **its own
   commit**.
3. The override fix, whichever option is chosen. Verify the advisory is
   actually closed by **inspecting the resolved tree**, not by trusting
   `bun audit`'s exit code.
4. The `SECURITY_AUDIT.md` sentence (section 4).
5. **CI stage aggregation** — `verify` stops at `lint`, so one ESLint bug
   produced a run that told us nothing about tests, determinism or coverage on
   any platform. In CI, run stages so all report even when an earlier fails and
   let the job exit code aggregate. Locally fail-fast is fine.
6. Then the remaining queue: M6 (transcript bound/rotation — reuse
   `util::logging`'s RotatingLogger; **the transcript is not a log**, prefer a
   bound with a visible notice plus the Settings clear button over silent
   deletion), the Windows DACL (verify-only, `windows-sys` 0.61 authorised),
   INV-2 / INV-4 / INV-5 / INV-6 / INV-7..INV-11, the guard-disposition sweep
   into `KNOWN_ISSUES.md`, the ~28 unread DECISIONS entries, and the
   DECISIONS.md restructure (RECORDS / AMENDMENTS / INVALIDATES / CROSS-DOMAIN).

---

## 6. PRE-REGISTERED PREDICTION — STILL UNRESOLVED

`docs/CI_PREREGISTRATION.md` predicts the first PRODUCT finding will be
criterion 3 (`verify:determinism`) on macOS/Linux, from `readdir` order.

**It has never executed on any platform** — `eslint` fails before it in the
`verify` chain. Per the pre-registered rule, that is **not evidence either
way**. Once `verify` clears lint, the outcomes stand as written:

- holds on all three → criterion 3 PROVEN across platforms
- diverges by platform → the core guarantee fails on exactly the case Section
  8.8 exists for, and it gets its own turn

`cargo fmt --check` failing on `main` was **not** this: it was whitespace
re-indentation of `http::send`'s parameters, not line endings. `.gitattributes`
was read and is **already correct** — `packages/engine/fixtures/** -text` pins
the deliberate CRLF fixture. That question is closed.

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
