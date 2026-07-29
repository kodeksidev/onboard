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

### KI-8 — the `brace-expansion` override breaks a second tool, and this is a pattern

| | |
|---|---|
| **Severity** | LOW (blocks a gate, not the product) |
| **Criterion** | 10 (coverage thresholds) |
| **Blocks** | **a README line** |
| **Family** | dependency override with unscopeable blast radius |
| **Disposition** | **ACCEPTED** — criterion 10 stays documented; the mechanism is recorded here so a third occurrence is recognisable |

`"overrides": { "brace-expansion": ">=5.0.8" }` closes GHSA-mh99-v99m-4gvg by
forcing one patched copy across the whole tree. v5 changed the package's export
shape, so **every consumer written against the v1/v2 CJS default import breaks**.

This has now happened twice:

1. **ESLint 9** — `@eslint/config-array` → `minimatch@3` →
   `TypeError: expand is not a function`. Resolved by upgrading to ESLint 10,
   whose `config-array` requires `minimatch@^10`. Recorded as an AMENDMENT in
   `docs/DECISIONS.md`.
2. **`@vitest/coverage-v8@3.2.7`** — `TypeError: (0 ,
   brace_expansion_1.default) is not a function` at
   `V8CoverageProvider.getUntestedFiles`. Note that `test-exclude@7.0.2` already
   requires `minimatch@^10.2.2`, so the transitive chain is fine; the break is
   in coverage-v8's own bundled require. **UI coverage cannot run at all**,
   which is why criterion 10 is unwired for that package.

Clearing the second needs `@vitest/coverage-v8@4.x`, which needs **vitest 4.x**
— a major test-framework upgrade wanting `vite ^6/7/8` — or a scoped override
exception that reopens the advisory in a dev-only path. Neither is cheap, and
coverage was **measured before wiring** rather than assumed: engine 97.98%
lines with every 90%-required file above 90%, contract 99.36%. The numbers are
strong where they can be produced.

**The pattern, stated so a third instance is not read as unrelated:** an
advisory whose only patched version is a new major, forced tree-wide by an
override, will keep breaking consumers pinned to the old API — one at a time, as
each is next exercised. Each break looks like an unrelated tool bug. It is not.

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
