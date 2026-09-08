# Known issues — the guard-disposition sweep

## Method

The Phase 13 audit enumerated invariants and asked, for each, **whether it
holds**. That method catches *"can this guard be bypassed"* and cannot,
structurally, surface *"what does this guard do when it fires"*. INV-3 is what
it missed: `engine.snippets` dropped a path that failed repo containment,
returned a shorter array, and told nobody. The audit had inspected that method
twice and recorded two conclusions, both correct.

So this sweep asks the second question. `scripts/guard-disposition-scan.py`
derives the sites where a failure is **absorbed rather than propagated** — a
caught error with no rethrow, a discarded `Result`, a default substituted for a
real answer — across `packages/engine/src`, `packages/contract/src`,
`apps/desktop/src` and `apps/desktop/src-tauri/src`. 181 files, 285 absorbing
sites.

### A catalogue is not a disposition

**This is the most important sentence in this document.**
`packages/engine/src/parse/grammar-loader.ts` already documented a
`Parser.init()` fail-open in its own file header — a compiled binary whose WASM
lookup failed with `ENOENT`, in that header's words *"silently degrading every
parse to `PARSE_FAILED` rather than throwing"*. That warning was written, was
committed, and was in the file.

It did not prevent the second one. Six months of process later, the same
function acquired a second fail-open of the same shape — a per-loader memo over
a process-global initialization — and it produced the same symptom: every parse
failing, an empty-but-well-formed `AnalysisResult`, no error anywhere.

**Documenting a fail-open does not close it.** Therefore every entry below
carries a disposition of **FIXED** or **TEST**, never "recorded". An entry whose
disposition is a line in this file is a defect that has been described, not
defended against. Where an item is genuinely accepted, it says so and names what
makes the acceptance safe.

### What this sweep cannot see

Stated plainly, because the output would otherwise read as broader than it is.

**It scans our code only.** Both `Parser.init()` defects degraded inside a
**dependency** — `web-tree-sitter`'s global WASM runtime — and surfaced as a
valid result with nothing in it. No scan over `packages/` and `apps/` would have
found either, and none of the 285 sites below corresponds to them.

Section 4 names the dependencies whose failure modes reach our results:
**`web-tree-sitter`** (every symbol and every edge) and **`bun:sqlite`** (the
cache that can serve a stale answer). Their silent degradation is covered only
by assertions on OUTPUT — `packages/engine/test/analyze/empty-is-not-success.test.ts`
refuses a run in which every parse attempt threw — and never by a scan of this
kind. Treat "no findings in a dependency" here as "not looked at", not "clean".

**It over-reports rather than under-reports**, deliberately. `snippets-method.ts`
and `repo-path-guard.ts` appear in the raw output and are not defects: both
convert the caught error into a refusal within a few lines. That direction is
the right one for a scan whose purpose is to find things nobody was looking for.

---

## Findings

### KI-1 — a cited line number too large for `u64` bypassed the range check

| | |
|---|---|
| **Severity** | HIGH |
| **Criterion** | 18 (citation rejection), Section 8.10 step 3 |
| **Blocks** | **a release** |
| **Family** | fail-open |
| **Disposition** | **FIXED** + **TEST** |

`verify_citations.rs` matched citations with `(\d+)` and then parsed the capture
with `.parse::<u64>().ok()`. Digits always match, so the parse fails only on
**overflow** — and `.ok()` collapsed that to `None`, which skipped the
line-range check entirely:

```rust
let line = line_group.and_then(|group| group.as_str().parse::<u64>().ok());
if let Some(line) = line { /* range check — never reached on overflow */ }
```

`src/index.ts:99999999999999999999999` was therefore **accepted**, and rendered
as a resolved citation to `src/index.ts` with no line. The line number was in
the model's output, was matched, and then silently vanished — exactly INV-3's
shape, on the control that exists to stop an unresolvable citation reaching the
user. It also defeats this project's standing rule that a citation must
*resolve*, not merely exist.

Fixed: a digit run too large for `u64` is by definition larger than any real
line count, so it takes the same refusal as any other out-of-range line, and the
refusal names what the model actually wrote.
`rejects_a_cited_line_number_too_large_to_parse` fails against the old code
(verified by reverting), and `still_accepts_an_in_range_line_on_the_same_path`
stops the fix from becoming "reject all line numbers".

### KI-2 — the no-network module poison could be undone

| | |
|---|---|
| **Severity** | MEDIUM |
| **Criterion** | 8 (no-network), Section 12 |
| **Blocks** | **a release** |
| **Family** | fail-open (durability) |
| **Disposition** | **FIXED** + **TEST** |

`globalThis.fetch` was poisoned with `writable: false, configurable: false`. The
network **modules** were poisoned by plain assignment, leaving the stubs
`writable: true, configurable: true` — measured directly:
`http.default.request = () => 'restored'` succeeded and the replacement was
callable. The same mutability that makes the CJS default object poisonable made
the poison reversible, so any code running later could undo the engine-side half
of Section 12's egress defence.

Fixed with `Object.defineProperty(..., { writable: false, configurable: false })`.
A stub that cannot be locked is still poisoned but recorded in
`unlockedNetworkEntryPoints`, and a test asserts that list is empty — so a
runtime that makes some export non-configurable produces a **named** gap rather
than a quietly weaker guard. Twelve tests cover holding, non-assignability,
non-redefinability, and post-install imports.

**Not closed by this:** a dependency that captured a reference *before* the
guard installed, and named-import bindings, which are frozen per spec and cannot
be poisoned at all. The file's header documented that already; it remains true,
and it is why the bundle scan and the `unshare -rn` run exist.

### KI-3 — `analyze()` overlapping itself corrupted results

| | |
|---|---|
| **Severity** | HIGH |
| **Criterion** | 3 (determinism) |
| **Blocks** | **a release** |
| **Family** | fail-open |
| **Disposition** | **FIXED** + **TEST** |

Root cause and full measurement in `docs/DECISIONS.md`. Two concurrent
`analyze()` calls disagreed on 107 leaves because `Parser.init()` was memoized
per loader. Fixed by hoisting the memo to module scope; 107 → 3, and the
remaining 3 are the path-derived identity fields that two *sequential* runs also
differ by. The regression test's load-bearing word is `COLD`.

### KI-4 — a broken symlink is dropped from the walk with no diagnostic

| | |
|---|---|
| **Severity** | LOW |
| **Criterion** | none directly; affects analysis completeness |
| **Blocks** | **a README line** |
| **Family** | silent drop (not a security boundary) |
| **Disposition** | **ACCEPTED**, documented here |

`walk.ts` returns `null` for a symlink whose target cannot be `stat`ed, and the
entry is excluded with no `Diagnostic`. A user whose repository contains a
broken symlink gets a map that silently omits it.

Accepted rather than fixed, and the reason is not "it is minor": emitting a
diagnostic per broken symlink would change every fixture fingerprint, and this
sweep's remit was to fix silent drops **on a security boundary**. This is not
one — no control is firing, and no claim about the user's code is weakened
beyond completeness. It is recorded so that "the map shows every file" is not
believed without qualification.

**This entry is why the method section says what it says.** Its disposition is a
line in a document, and by this sweep's own argument that is a description, not
a defence. It is listed as accepted so the distinction stays visible.

### KI-8 — the `brace-expansion` override breaks consumer after consumer; fixed by overriding `minimatch` instead

| | |
|---|---|
| **Severity** | LOW (blocks gates, not the product) |
| **Criterion** | 10 (coverage thresholds), 22 (E2E suite) |
| **Blocks** | nothing, as of 2026-07-29 |
| **Family** | dependency override with unscopeable blast radius |
| **Disposition** | **MITIGATED, not resolved** — `"minimatch": ">=10.2.5"` clears all three known occurrences, but it is the same manoeuvre one package up. See "The residual risk" below |

`"overrides": { "brace-expansion": ">=5.0.8" }` closes GHSA-mh99-v99m-4gvg by
forcing one patched copy across the whole tree. v5 changed the package's export
shape, so **every consumer written against the v1/v2 default import breaks**.

This happened three times:

1. **ESLint 9** — `@eslint/config-array` → `minimatch@3` →
   `TypeError: expand is not a function`. Resolved by upgrading to ESLint 10,
   whose `config-array` requires `minimatch@^10`. Recorded as an AMENDMENT in
   `docs/DECISIONS.md`.
2. **`@vitest/coverage-v8@3.2.7`** — `TypeError: (0 ,
   brace_expansion_1.default) is not a function` at
   `V8CoverageProvider.getUntestedFiles`. **UI coverage cannot run at all**,
   which is why criterion 10 was unwired for that package.
3. **`@wdio/cli@9.20.1`** — `SyntaxError: The requested module
   'brace-expansion' does not provide an export named 'default'`, thrown while
   loading `minimatch@9.0.9`'s **ESM** build. The E2E suite could not start at
   all, so criterion 22 was unmeasurable. Note the asymmetry that hid this:
   minimatch's **CJS** build survives v5 (verified — it returns correct
   results), so only ESM consumers break. Nothing in `verify` loads that path.

**The fix — override the intermediary, not the leaf.** `minimatch@10` is
written against brace-expansion 5's *named* `expand` export, which is exactly
the incompatibility. Overriding `minimatch` to `>=10.2.5` collapses the tree to
one copy of each, compatibly:

```json
"overrides": {
  "minimatch": ">=10.2.5",
  "brace-expansion": ">=5.0.8"
}
```

This works because the toolchain had already moved: `eslint@10.8.0`,
`@eslint/config-array`, `@typescript-eslint/typescript-estree` and
`test-exclude@7.0.2` all already declare `^10.2.x`. The override only drags the
stragglers forward — `glob@10.5.0` (`^9.0.4`), `mocha` (`^5.1.6`),
`mocha/glob@8.1.0`, `filelist`, `readdir-glob`, and `recursive-readdir`
(`^3.0.5`, a seven-major jump). All six sit in dev-only tooling paths
(`create-wdio` scaffolding, `jake`, `archiver`).

Measured on this configuration, not assumed:

| check | result |
|---|---|
| `bun audit` | No vulnerabilities found |
| `bun run verify:js` | exit 0 — 60 test files, 379 tests |
| `bun run --cwd apps/desktop e2e` | 4 specs / 7 tests green |
| `bun run --cwd apps/desktop test --coverage` | exit 0 — was exit 1 at HEAD with the `brace_expansion_1.default` TypeError, measured in both directions |

**Correction to this entry's own earlier analysis.** It previously offered "a
scoped override exception that reopens the advisory in a dev-only path" as an
option. **That option does not exist in bun 1.3.14.** Scoped overrides are
silently ignored — tested three ways: npm-style nested
(`"minimatch": { "brace-expansion": ... }`), yarn-style path-keyed
(`"resolutions": { "minimatch/brace-expansion": ... }`), and path-keyed with the
flat override removed so the rule had to act alone. All three no-op with no
warning and exit 0. A scoping rule that silently does nothing is its own hazard:
it reads, in a diff, exactly like a rule that works.

**The residual risk — why this entry is MITIGATED and not closed.** This fix is
an instance of the very pattern this entry exists to name. KI-8 says: *an
advisory whose only patched version is a new major, forced tree-wide by an
override, keeps breaking consumers pinned to the old API, one at a time, each
break looking unrelated.* Overriding `minimatch` to v10 across consumers that
request `^3`, `^5` and `^9` is that shape exactly, one package up the tree. It
is a better bet — v10 is far closer to API-compatible with v9/v5 than
brace-expansion v5 was with v2 — but a bet is what it is, and the next consumer
exercised is where we find out.

**The override cannot be narrowed.** The obvious mitigation — let consumers that
can already take v10 do so naturally, and override only the rest — does not
apply: all six forced consumers declare ranges that *exclude* v10
(`glob@10.5.0` `^9.0.4`, `mocha` `^5.1.6`, `mocha/glob@8.1.0` `^5.0.1`,
`filelist` `^5.0.1`, `readdir-glob` `^5.1.0`, `recursive-readdir` `^3.0.5`), so
normal resolution can never reach v10 for any of them. Overriding the
intermediaries instead (`glob` to v11, `mocha` to v11, …) would be more bets,
not fewer. The alternative is reopening the advisory.

**So the bet shrinks by evidence, not by scope.** Of the six:

| forced consumer | reached via | exercised? |
|---|---|---|
| `mocha` `^5.1.6` | `@wdio/mocha-framework` | **yes** — the e2e suite runs through it |
| `glob@10.5.0` `^9.0.4` | `test-exclude` → `@vitest/coverage-v8` | **yes** — coverage runs |
| `mocha/glob@8.1.0` `^5.0.1` | `mocha` | partially, with the above |
| `recursive-readdir` `^3.0.5` | `create-wdio` (scaffolding CLI) | **no** — never invoked here |
| `filelist` `^5.0.1` | `jake` | **no** |
| `readdir-glob` `^5.1.0` | `archiver` | **no** |

The three unexercised rows are where a fourth occurrence would come from. None
sits in a path this repository invokes, which is why this is MITIGATED rather
than merely ACCEPTED — but "we do not currently call it" is a description of
today's usage, not a property of the fix.

**Verified against the resolved tree, not `bun audit`'s exit code** (the
standing rule since the first override — the exit code is the claim the rule
exists to distrust): the store contains exactly one `brace-expansion@5.0.8` and
exactly one `minimatch@10.2.5`, and a sweep of every `brace-expansion/
package.json` under `node_modules` finds no copy below 5.0.8.

**The pattern, restated now that it has a fix:** an advisory whose only patched
version is a new major, forced tree-wide by an override, will keep breaking
consumers pinned to the old API — one at a time, as each is next exercised. Each
break looks like an unrelated tool bug. It is not. Where the breakage is
mediated by a single intermediary package that has itself already adopted the
new major, override *that* package instead of the leaf, and every consumer moves
together.

### KI-9 — the Linux `.AppImage` does not build; `.deb` and `.rpm` ship instead

| | |
|---|---|
| **Severity** | MEDIUM |
| **Criterion** | 23 (installers on all three platforms) |
| **Blocks** | **a README line** |
| **Family** | build gap, found by running the release workflow |
| **Disposition** | **ACCEPTED** for the first release, enforced by the format list |

Found by the release dry run — the workflow's first real execution, which also
found that this project had no Tauri CLI at all (KI-10).

Tauri's AppImage step shells out to `linuxdeploy`, which is itself an AppImage
and mounts via FUSE. On a GitHub runner it fails:

```
Bundling Onboard_0.1.0_amd64.AppImage
failed to bundle project `failed to run linuxdeploy`
```

Installing `libfuse2` **and** setting `APPIMAGE_EXTRACT_AND_RUN=1` did not clear
it — measured, both applied, same failure. `.deb` and `.rpm` bundle cleanly in
the same run, so this is specific to the AppImage path.

Section 13 #23 names `.AppImage` explicitly, so this is a criterion-23 gap. The
first release ships `.deb` and `.rpm`, and the workflow now names bundle formats
per OS rather than accepting Tauri's default of "everything this platform can
make" — so the narrowing is a list someone has to edit, not something that
happens quietly. **Shipping a format that has never been produced is exactly
what the macOS hold exists to prevent; the same rule applies here.**

### KI-10 — the project had no way to build an installer at all

| | |
|---|---|
| **Severity** | HIGH at the time; now resolved |
| **Criterion** | 23 |
| **Blocks** | nothing now |
| **Family** | unproven claim, found by running the thing |
| **Disposition** | **FIXED** |

`@tauri-apps/cli` was never a dependency — only `@tauri-apps/api`, the JS API.
There was no `tauri` executable in the workspace and no bundle script.
`bunx tauri build` answered *"could not determine executable to run for package
tauri"*.

So criterion 23 was not merely unlaunched: **no installer had ever been built.**
Every Rust gate to date compiled the binary with cargo and stopped; Tauri's
bundling half had never run. Both halves of "installers build and launch" were
unproven and only the second was written down.

Recorded because of what it says about the other unproven claims: this one
survived a full week of gate work, a criteria map, and a documented ship
decision. It was found the moment something ran the workflow instead of reading
it.

### KI-5 — `Settings` falls back to defaults on any read or parse error

| | |
|---|---|
| **Severity** | LOW |
| **Criterion** | 13 (static-mode indicator) |
| **Blocks** | nothing |
| **Family** | fail-safe, not fail-open |
| **Disposition** | **ACCEPTED** — the fallback direction is correct |

`settings.rs` uses `.ok()` twice when reading and deserializing
`settings.json`, falling back to `Settings::default()`. That default has
`isEnabled: false`, so a corrupt settings file turns AI **off** rather than on.
The absorbing shape is real; the direction is the safe one, and
`docs/DECISIONS.md` already records the reasoning. Listed so the sweep's output
is complete rather than curated.

---

### KI-6 — a malformed manifest is reported as a project with no dependencies

| | |
|---|---|
| **Severity** | MEDIUM |
| **Criterion** | none directly; affects what the map asserts about the user's project |
| **Blocks** | **a release** — owner override, see below |
| **Family** | fail-open (KI-1's class) |
| **Disposition** | **FIXED** + **TEST** |

**The security-boundary rule was overridden for this one**, and the reasoning is
worth keeping: it is the *third instance of one mechanism* — INV-3 dropped a
refusal, KI-1 collapsed an overflow, this collapses a parse failure — and each
time the result is a well-formed output that reads as success. The user-visible
consequence is Onboard stating that a project has no external dependencies when
a manifest is malformed. That is the product being confidently wrong about its
central claim, which outranks a security finding nobody triggers.

Found by `scripts/lossy-conversion-scan.py`, the sweep for KI-1's *class* rather
than its instance. Three modules define an identical `parseJsonSafely` that
returns `null` on a parse error, and two of them then write `?? {}`:

```ts
const parsed = parseJsonSafely(content) ?? {};   // manifests.ts:68, :211
```

`null` means *this file did not parse*; `{}` means *it parsed and was empty*.
Coalescing them is exactly KI-1's conflation. A malformed `package.json`
therefore yields a manifest that is reported as **present and valid, with zero
dependencies** — so the map tells the user their project has no external
dependencies, confidently, with no diagnostic anywhere. The same shape drops
workspace detection (`workspaces.ts`) and entry points (`entry-points.ts`), so a
monorepo with one broken manifest is analysed as a flat repository.

**The asymmetry is the giveaway.** A malformed `tsconfig.json` DOES surface —
`analyze-assemble.ts` emits `tsconfig/jsconfig could not be read or parsed`.
Someone already decided this class of failure is worth telling the user about,
and three sibling modules do not.

**Fixed.** The three copies are gone: `packages/engine/src/util/json.ts` is the
single definition, and it returns a discriminated outcome so failure cannot be
spelled the same way as empty. A valid JSON document that is not an object —
`null`, `[]`, `"text"`, `7` — is a failure too, because returning `{}` for it
would rebuild the exact conflation. A malformed manifest now emits
`MANIFEST_UNREADABLE` and is **excluded** from `stack.manifests` rather than
listed as a valid one with nothing in it.

The consolidation was the point, not tidiness. `resolve/tsconfig-paths.ts` has
the same failure and always reported it as `TSCONFIG_UNREADABLE`; **three copies
of the helper are why that decision reached one module out of four.** This is
the duplication pattern from `engine-rpc-client.ts`'s hand-rolled newline
reader — the same behaviour written more than once diverges, and the divergence
is where the defect lives.

Failures are collected as PATHS and converted to diagnostics once, because
`package.json` is read by all three modules and three copies of one warning
would be worse than none. Six tests cover it, including the two that stop the
fix from overshooting: a valid-but-empty `{}` manifest produces **no**
diagnostic, and a well-formed manifest still yields its dependencies. No fixture
has a malformed manifest, so no fingerprint moved — 516 engine tests unchanged.

---

### KI-7 — 210 of 285 absorbing sites were counted, not read

| | |
|---|---|
| **Severity** | MEDIUM |
| **Criterion** | 26 (this audit's own coverage) |
| **Blocks** | **a README line** |
| **Family** | limit of method, not a defect in the product |
| **Disposition** | **ACCEPTED** — stated as a bound on what criterion 26 can claim |

The sweep's reach is bounded in a way that **excludes the defect that started
it**, and that deserves an entry rather than a footnote.

All ten shapes the scanner matches are **line-local**. INV-3's mechanism was
not: `engine.snippets` refused correctly on its own line, and the *caller*
discarded the refusal by returning a shorter array. No line-local pattern can
see a guard whose refusal is dropped one frame up. So the scan that exists
because of INV-3 could not have found INV-3.

The four largest categories — `returns null` (70), `substitutes a default` (57),
`nullish default on a call` (44), `ignores a Result` (39) — total **210 sites
that were pattern-matched and counted, never read.** The categories read in full
were the small ones, which is how KI-1's class surfaced: `.ok()` had five hits.

Not closable by more scanning of the same kind. Closing it means either reading
the 210, or a different method that follows a refusal to its consumer. Recorded
so that "the guard sweep was done" is never read as "the guards were reviewed".

---

## Coverage of this sweep — what "classified" means

285 absorbing sites. **Classified means pattern-matched by shape and counted.**
It does not mean read. Naming the shapes so a reader can see the sweep's reach:

| Shape | Count | What it matches |
|---|---|---|
| `returns null` | 70 | a bare `return null;` |
| `substitutes a default` | 57 | Rust `.unwrap_or*(` |
| `nullish default on a call` | 44 | `) ?? null` / `?? []` / `?? 0` |
| `ignores a Result` | 39 | Rust `let _ = ` |
| `returns an empty collection` | 36 | `return [];` / `return {};` |
| `catch with no rethrow` | 23 | a `catch` with no `throw`/`Err` within 6 lines |
| `discards the error with .ok()` | 5 | Rust `.ok()` |
| `handles only the Ok arm` | 5 | `if let Ok(` |
| `inline catch handler` | 3 | `.catch(` |
| `silently drops items` | 3 | `.filter_map(` |

**What that would have missed.** Every shape is line-local. A guard that
refuses correctly on one line and whose CALLER discards the refusal is invisible
to all ten — which is INV-3's original mechanism, found by reading rather than
by any scan. So is a guard whose absorbing step is spread across a function, and
so is anything in a dependency (see the method section). Treat the ten shapes as
a net with a known mesh size.

**Evidence about the triage's reach, in both directions.** The detailed triage
went to INV-3's shape — a value failing validation being dropped while the
operation reports success — on privacy, AI, secrets, RPC, walk and cache paths.
KI-1 was **not** that shape: it was a conversion collapsing failure into
absence, matched by `discards the error with .ok()` (5 hits) rather than by any
drop pattern, and it surfaced anyway because that category was small enough to
read in full. That is weak evidence the triage reached past its own target — and
it also shows why: the categories that got read completely were the small ones.
The four largest categories, 210 of the 285 sites, were counted and not read.

Re-run with `bun run guards:scan --list` for the full site list, and
`bun run lossy:scan` for KI-1's class specifically.

---

## Other known issues

Not products of the guard-disposition sweep above — found during other work,
recorded here because this is where the project's open, unresolved findings
live.

### KI-11 — a scrollbar-reservation feedback loop in the dependency graph tab (RESOLVED)

| | |
|---|---|
| **Severity** | Originally recorded LOW (no visible symptom found); reclassified HIGH once reproduced on a real repo — a visible flicker in the app's headline feature, roughly twice a second |
| **Criterion** | `e2e/graph-layout.spec.ts`'s own containment assertions |
| **Blocks** | nothing now — fixed |
| **Family** | a real CSS containment gap (auto-scrolling ancestor + a self-resizing canvas child with no clipping boundary between them) — NOT the dependency-graph measurement feedback loop `docs/DECISIONS.md`'s original entry was written for |
| **Disposition** | **RESOLVED** — `overflow-hidden` added to `DependencyGraph.tsx`'s root section (docs/DECISIONS.md, "KI-11 is a scrollbar-reservation feedback loop"). Confirmed by re-running the same 100-sample poll that found it (zero transitions) and independently by `e2e/graph-layout.spec.ts`, which now passes cleanly for the first time. |

Found running `e2e/graph-layout.spec.ts`'s 8-remount containment check against
the real fix, on real WebView2, after the fix itself was confirmed correct.
Roughly 1 run in 3 (mount index varies — 1, 6, then 4 across separate runs)
shows `<main>`'s `scrollHeight` exceeding its `clientHeight` by exactly
**16px** (744 vs 728), sometimes with a **15px** width overflow alongside it
(1265 vs 1250) and sometimes without.

**What stays true every time it fires**, which is why this is not the
feedback loop from `docs/DECISIONS.md` recurring: the Cytoscape mount div's
own height sits comfortably under its budget when it happens (640.8px used
against 743.2px available — a ~100px margin, not a near-miss), the Overview
tab stays visible (`isOverviewTabVisible: true` every single time), and the
magnitude never approaches the loop's multi-thousand-pixel signature.

**Ruled out, not merely suspected:**
- **A settle-timing artifact in the test.** Replaced a fixed pause with
  settle-detection (poll until `<main>`'s scroll box reports the same value
  on two reads 150ms apart) before measuring. The exact same failure
  reproduced under it.
- **`fcose`'s `randomize: true`.** The leading hypothesis going in: a
  randomized initial layout occasionally settles into a slightly larger
  bounding box, tipping a scrollbar into existence, which then consumes
  ~15px and produces overflow on the other axis. Tested directly —
  temporarily set `randomize: false` in `useCytoscape.ts`, rebuilt, ran the
  spec three times. Run 2 failed with the identical signature (mount index
  4, `744` vs `728`). Disabling randomization did not remove the variance,
  which rules it out as the mechanism. (Change was diagnostic only and was
  reverted; `useCytoscape.ts` matches `HEAD`.)

**Not established:** what actually causes it. 16px is suspiciously close to
a typical scrollbar width, which is consistent with *some* boundary
condition flipping a scrollbar on for one mount in several, but no
confirmed mechanism produces that boundary condition — the leading
candidate was tested and eliminated, and no second hypothesis has been
verified.

**Why the spec is left to fail intermittently rather than tuned green:**
`CONTAINMENT_TOLERANCE_PX` exists to absorb border/scrollbar sub-pixel
rounding (a few px), not a specific unexplained 16px. Widening it to 20px
would make this pass without explaining it — the tolerance would be
calibrated to today's failure rather than to a real invariant, which is
exactly the shape of gate this project has spent effort removing elsewhere
(see the guard-disposition sweep above, and `docs/DECISIONS.md`'s "a
tolerance set to make today's run pass is a gate tuned to its own output").
An intermittent red that names a real, unexplained condition is worth more
than a green bought that way.

If this ends up gating a release, that is a decision to make explicitly
when it happens, not one to make by adjusting a constant now.

**Update, same investigation that found the `GraphListFallback` sr-only
table defect (docs/DECISIONS.md):** explicitly checked whether the two were
the same bug at different scales — they are not. Direct polling of `<main>`
every 500ms for 20+ seconds (rather than one settle-check pair) shows it is
not intermittent across mounts at all: it continuously alternates between
exactly the same two states (`1250×744`-ish / `1265×743`-ish) for as long
as it is watched. This reproduces byte-for-byte identically with and
without the `sr-only` table fix applied, and with and without a hub file in
the graph, so it is conclusively independent of both. The "roughly 1 in 3
mounts" characterization above was this same continuous oscillation being
sampled by a single 150ms-apart double-read rather than watched — not a
different, rarer phenomenon.

**Resolved, same day: a real user report against real CacttusEdu (500
files) showed this at larger amplitude than any local reproduction had —
visible on screen, not just in measurements, roughly once a second.** That
reframed severity from "curiosity" to "primary defect." Measured precisely
(100 samples, 150ms apart): `main.offsetWidth`/`offsetHeight` never changed
while `clientWidth`/`clientHeight` alternated between two values exactly
~15px apart, in lockstep with the graph's own container — the literal
signature of a scrollbar being reserved and released, not a real resize.
Root cause: `AppShell`'s `<main overflow-auto>` had no clipping boundary
between it and the dependency graph's self-resizing Cytoscape canvas, so
the canvas's own resize could nudge `main` past its box, growing a
scrollbar that consumed ~15px, which shrank the canvas back under budget,
which removed the scrollbar, which regrew the canvas — forever. Fixed with
`overflow-hidden` on `DependencyGraph.tsx`'s root section: the panel is a
canvas that manages its own pan/zoom and never legitimately needs a native
scrollbar, so making it its own containment boundary means whatever
Cytoscape does inside it can no longer be seen by `main` at all, on any
future resize, for any reason — not scrollbar-gutter-style damping of one
instance's symptom. Verified with the same 100-sample poll that found it
(zero transitions across 16.6s) and independently by
`e2e/graph-layout.spec.ts`, which could not previously even complete its
own settle-detection because of this exact oscillation and now passes
cleanly. Full mechanism and the argument for `overflow-hidden` over
`scrollbar-gutter: stable`: `docs/DECISIONS.md`.

### KI-12 — UI tests time out under a CONCURRENT NATIVE BUILD; do not re-scope timeouts to fix it

| | |
|---|---|
| **Severity** | LOW — environmental. Does not reproduce with the machine otherwise idle, and has never been observed in CI. |
| **Criterion** | none directly; it makes `bun run test` (criterion 10's coverage gate and the whole `verify:js` chain) intermittently red while a native build runs alongside it |
| **Blocks** | nothing |
| **Family** | the CPU-contention timeout family already analysed in `src/test/timeouts.ts` — NOT a race, NOT an assertion failure |
| **Disposition** | **OPEN, deliberately unfixed.** Recorded so the next person finds the existing analysis instead of repeating it, and so the obvious "fix" is refused on the record. |

**What happens.** `bun run test` intermittently fails with
`Error: Test timed out in 5000ms` — never an assertion. Observed 2026-09-08
across two files in a single run (`ModuleMap > renders all 5 fixture module
cards` and `OverviewPanel > renders the repo identity and detected type from
the fixture`, 4 failing tests in that run). It is the FIRST test in a file that
fails, which is where module-load cost lands: both files parse
`sample-analysis.json` through zod at module scope.

**Measured, both directions.**

| condition | runs | failures |
|---|---|---|
| concurrent native build (`build:sidecar`, then `cargo` release compiling `src-tauri`) | 8 | 2 |
| machine verified idle | 5 | 0 |

The idle runs were gated on two conditions, not on assuming the build had
finished: the build wrapper's exit marker, and a Windows process-table poll
reporting zero `rustc|cargo|tauri|link|onboard` processes, both timestamped
before the first run began. All five passed with 419/419.

**Why it is not fixed by giving those files headroom.** `src/test/timeouts.ts`
already contains this analysis in full, including the specific observation that
"a real parallel `rustc` build ... is heavier than 12 busy-spin processes, and
pushed two files past even the 15s headroom." Both reproductions here happened
during exactly that. The same file states the rule for who gets
`SLOW_MOUNT_TIMEOUT_MS`, and why:

> Selecting by symptom finds the tests that already lost the race, not the ones
> about to.

Headroom is granted on a PRINCIPLE — a file that mounts CodeMirror, Cytoscape
or axe-core is expensive whether or not one sampling caught it being expensive
— and `ModuleMap.test.tsx` and `OverviewPanel.test.tsx` mount none of the
three. `ModuleMap.test.tsx` measures ~335 ms in isolation. Adding them to the
list because they lost one race under a load nothing in CI produces is the
precise mistake that file was written to prevent, and it would spend the
liveness backstop for every test those files contain to buy nothing.

**So the disposition is: do not run the suite against a concurrent release
build, and do not re-scope timeouts by symptom.** If this is ever seen with the
machine idle, or in CI, that is a different and more serious finding — the
numbers above are the baseline to compare against. The analysis to read first
is `src/test/timeouts.ts`, not this entry.
