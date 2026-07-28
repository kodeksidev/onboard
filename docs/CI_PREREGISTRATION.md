# Pre-registration — first CI run

Written and committed **before** the first CI run's results were examined. The
point of committing it is that git timestamps it: a prediction written after
the result is worth nothing, and this project has already been through one
round of establishing that (see `docs/DECISIONS.md`'s L1592 entry, where a
Phase 11 author predicted the warm fast path would land at ~1.8-2.2s and could
not verify it — the prediction was worth something precisely because it
pre-dated the measurement).

Six acceptance criteria have never executed anywhere except one Windows
machine: 1, 8, 12, 22, 23, 28. Every "PROVEN" mark in the criteria map is
therefore PROVEN-ON-WINDOWS.

## The prediction

**The first PRODUCT finding will be criterion 3 — `verify:determinism` — on
macOS or Linux, caused by `readdir` order differing from Windows.**

Reasoning: Section 8.8's determinism table exists *because* directory-read
order differs across macOS, Windows and ext4 — that is its first row. The gate
that proves determinism has only ever run on the single platform where that
entire defect class is invisible. If the sorting defence has a gap, this is
where it shows.

## What each outcome means

**Determinism holds on all three platforms.** Section 8.8's sorting defence
works as designed. Criterion 3 goes from PROVEN-on-Windows to PROVEN across
platforms, and the fixture fingerprints are genuinely platform-independent.
This is the good outcome and it retires the largest single doubt in the
criteria map.

**Fingerprints diverge by platform.** The product's core guarantee — "the same
repository analysed twice produces byte-identical output" — fails on the exact
case Section 8.8 exists to defend. That is not a CI defect and not a tuning
problem; it means a sort is missing or a traversal order leaks into the result.
It gets its own turn, and criterion 3 goes UNPROVEN rather than PARTIAL.

**Something else fails first.** Then the prediction was wrong, and what it
implies depends on the category:

- If it is INFRASTRUCTURE (apt packages, Tauri system deps, `unshare`
  permissions on the runner, toolchain install, cache paths), it says nothing
  about the product and does not falsify the determinism prediction — the
  determinism job simply did not get far enough to answer. The prediction
  stands unresolved until it runs.
- If it is a different PRODUCT failure, the prediction was wrong in a way that
  matters: it means my model of where this codebase is platform-fragile was
  wrong, and the criteria map's confidence should drop generally, not just on
  the criterion that failed.

## What would make me wrong in an uninteresting way

If the determinism job never runs because an earlier step in its job fails,
that is not evidence either way. I will say so rather than counting it.

## Expectation about volume

The first run of a workflow that has never executed will be mostly
INFRASTRUCTURE. That is expected and is not a product signal. The risk is that
its volume obscures the one or two PRODUCT failures underneath, so every
failure gets classified before any of them gets discussed.
