# Manual smoke checklist — all three platforms

**This is the verification route for the UI half of criterion 23.** It is a
documented gap, not a faked gate, and it exists because the alternative was
worse on every count.

## Why this is manual, and why that is the honest answer

Criterion 23 has two halves, and they are verified differently:

| half | route | status |
|---|---|---|
| installer builds; shell launches and resolves its engine | **CI** — `installed` (Linux) and `installed-windows` jobs in `release.yml` | automated |
| **installed app renders a graph from a picked folder** | **this checklist** | manual, all three platforms |

The UI half cannot be automated against an *installed release build*:

- `window.__onboardE2E` — the bridge `apps/desktop/e2e/**` drives — is gated on
  `import.meta.env.MODE === 'e2e'` (`apps/desktop/src/main.tsx`). A release
  bundle is built in `production` mode and therefore does not have it.
- The native OS folder picker is unreachable from WebDriver on every platform
  (a limitation shared by every Electron/Tauri E2E setup).
- Shipping the bridge in production would expose the repo store to any script
  running in the webview — an unacceptable trade on a product whose thesis is
  that nothing leaves the machine.
- Adding an `onboard <path>` CLI argument purely so a gate could go green was
  rejected and deferred to `docs/V2_BACKLOG.md`, with the reasoning recorded.

`docs/MACOS_SMOKE.md` established this pattern for macOS, where Tauri has no
WebDriver support at all (A19). This document generalises it: the same UI half
is unautomatable on Windows and Linux too, for the reasons above, and pretending
otherwise on two platforms while admitting it on the third was inconsistent.

## This route is not theoretical

**2026-07-29, Windows, run by the product owner against the v0.1.0 draft
release `.msi` in a clean Windows Sandbox.** It found a real, shipped defect
that every automated gate missed: the app installed and launched, then failed
on the first user action with

```
Analysis stopped unexpectedly
Failed to start the analysis engine process: The system cannot find the
path specified. (os error 3)
```

The shell was looking for its sidecar in a `binaries/` subdirectory that a
packaged app does not have. Every developer machine resolved through a dev
fallback, and the Linux CI job drove the engine directly and never started the
shell — so nothing else could have caught it. It also confirmed criterion 13
positively: the mode indicator rendered byte-exact on a clean machine.

Runs are recorded at the bottom of this file. An unrecorded run did not happen.

---

## Prerequisites (all platforms)

- [ ] A **real installer artifact** from the release workflow — not a
      `cargo build` output, not a dev server. The point is to exercise what a
      user receives.
- [ ] A **clean machine**: a VM, a fresh Windows Sandbox, or a container with a
      desktop session. Specifically: no repository checkout, no `bun`, no
      `cargo`, no `node_modules`. The v0.1.0 defect was invisible on any
      machine with a checkout, because the dev fallback resolved there.
- [ ] A repository to analyse that is **not** this one — a few hundred files of
      TypeScript or Python is ideal.
- [ ] v1 ships unsigned (A3). The OS will object. Follow `docs/INSTALL.md`'s
      documented steps; that is expected behaviour, not a bug, and must not be
      "fixed" by disabling the protection system-wide.

## Install (per platform)

- [ ] **Windows** — install the `.msi` by double-clicking it. SmartScreen
      appears; the wording and the click path must match `docs/INSTALL.md`
      exactly. Note any divergence as a documentation defect.
- [ ] **Linux** — install the `.deb` with `sudo apt-get install ./<file>.deb`
      (or the `.rpm` with `dnf`). Launch from the desktop menu entry, not from
      a terminal in a checkout — a terminal in the wrong directory can mask
      exactly the class of path bug this checklist exists to find.
- [ ] **macOS** — see `docs/MACOS_SMOKE.md` for the Gatekeeper/quarantine
      specifics; the checklist below still applies in full.

## Launch and the static-mode guarantee

- [ ] App launches with no crash and no unhandled native dialog.
- [ ] Mode indicator reads exactly, byte for byte:

      🔒 Static mode · no network · nothing leaves this machine

      Check the middle dot `·` (U+00B7) is not a hyphen, and the lock is the
      emoji. This is criterion 13 and A6 freezes the string verbatim.
- [ ] With a network monitor running (Little Snitch / `nettop` / Fiddler /
      `ss -tp`), **no outbound connection** is attempted at launch, at folder
      pick, or during a full analysis. Treat any unexplained attempt as a
      CRITICAL finding, not a note. This is the core guarantee (Section 1).

## Folder pick → analysis → rendered graph

This is the sequence CI cannot perform. It is the reason this file exists.

- [ ] "Choose folder" opens the **real native OS folder picker**.
- [ ] Picking a repository starts an analysis with visible progress, and the
      picker is disabled while it runs (no second analysis can be started).
- [ ] Analysis completes and the **Overview** tab renders with a non-zero file
      count. A zero count means the engine returned an empty-but-valid result —
      usually grammars that did not ship. Treat it as a failure, not an empty
      repo.
- [ ] The **Dependency graph** tab renders an actual graph: nodes visible,
      edges visible, laid out. A blank canvas is a failure even if no error
      appeared.
- [ ] Clicking a node opens that file in the **File viewer** with real contents.
- [ ] **Where is X?** finds a symbol you know exists, and clicking a hit opens
      the file at the matched line.

## Error copy

- [ ] Pick a folder, then delete it, then retry — the error is Onboard's own
      copy, and **no raw OS string** appears in the body. OS detail belongs
      behind the "Details" disclosure (Section 12).
- [ ] If the engine is missing or unstartable, the copy reads **"Onboard could
      not start its analysis engine"** — not "Analysis stopped unexpectedly".
      The latter was the v0.1.0 defect: a crash message for a process that
      never started.

---

## Recorded runs

An unrecorded run did not happen. Add a row; do not edit an existing one.

| date | platform | build | performed by | outcome |
|---|---|---|---|---|
| 2026-07-29 | Windows 11 (clean Sandbox) | v0.1.0 draft `.msi` | product owner | **FAILED** — engine never started (`os error 3`); mode indicator byte-exact ✓ |
| | Windows | | | |
| | Linux | | | |
| | macOS | | | |
