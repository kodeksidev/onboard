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

## What CI now covers, so this checklist can be honest about the remainder

Release **run 30489773363** (2026-07-29) was the first execution of the two
install jobs, and half (a) of criterion 23 passed on both platforms:

| job | evidence |
|---|---|
| `installed .msi …` (90706006536) | `sidecar resolved: \\?\C:\Program Files\Onboard\onboard-engine.exe` · `installed engine: symbols=2, edges=1` |
| `installed .deb …` (90706006541) | `sidecar resolved: /usr/bin/onboard-engine` · `installed engine: symbols=2, edges=1` |

The `.msi`'s own file table, read with `msiexec /a` before installing, is
`onboard.exe`, `onboard-engine.exe` and `resources/grammars/*.wasm` — two
executables, the sidecar beside the shell with no `binaries/` subdirectory,
and no test binaries.

**That Windows row is now historical.** The `.msi` was dropped on 2026-08-03 and
the job was repointed at `setup.exe` (AMENDMENT, `docs/DECISIONS.md`). The
evidence above still stands for what it claimed at the time, and is kept rather
than deleted because the resolution bug it caught was diagnosed against that
layout. The current job installs `setup.exe` silently, enumerates
`%LOCALAPPDATA%\Onboard` after the fact — NSIS has no read-without-installing
equivalent to `msiexec /a` — and additionally asserts the install is per-user
and that Add/Remove Programs lists it.

**So the boxes below that CI already covers are: install, launch, and that the
engine resolves and parses.** What remains genuinely manual is everything from
the folder pick onward — the picker, the rendered graph, node → file, search,
and the byte-exact mode indicator on a real display. Those are the boxes that
still need a human, and the 2026-07-29 Windows run is what proves that matters:
it found a defect no automated gate could see.

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

- [ ] **CLEAR ANY PRIOR INSTALL FIRST (Windows).** Uninstall, then check
      `%LOCALAPPDATA%\Onboard` is gone and delete it if not. NSIS's uninstaller
      removes only files it wrote, so anything a previous build or a manual copy
      left behind survives and shows up in the next run's enumeration. This is
      not hypothetical: on 2026-08-03 that directory held `onboard_engine_stub.exe`
      and `check_egress_chokepoint.exe` — both on the banned list — from an
      install predating the build under test. **A leftover reads exactly like a
      shipping defect**, and chasing one costs more than the thirty seconds this
      box takes.

- [ ] **Windows** — install `Onboard_0.1.0_x64-setup.exe` by double-clicking it.
      There is no `.msi` as of 2026-08-03 (AMENDMENT, `docs/DECISIONS.md`).
      SmartScreen appears; the wording and the click path must match
      `docs/INSTALL.md` exactly. Note any divergence as a documentation defect.

- [ ] **Windows — the installer's own pages.** Nothing automated can see an
      assembled installer dialog, so this is the only place these are checked.
      The welcome page must show **the Onboard mark on a white sidebar** — not
      NSIS's blue arrow with a computer in a box, which is what shipped through
      v0.1.0. Then: a licence page carrying the MIT text; the Onboard mark in the
      header strip of the pages after it; and the installer's own title-bar icon
      is ours.

- [ ] **Windows — no UAC prompt.** The installer must NOT ask for administrator
      rights, and must land in `%LOCALAPPDATA%\Onboard`, not `Program Files`.
      This is the capability the whole format decision turned on; a prompt here
      means `installMode` regressed and users without local admin cannot install.

- [ ] **Windows — Add/Remove Programs.** Settings → Apps → Installed apps must
      list **Onboard**, publisher **Eris Uruqi** (not `onboard`), with the
      Onboard icon and version 0.1.0.

- [ ] **Windows — SmartScreen's SECOND screen.** After clicking **More info**,
      record the exact strings. They are marked `observed: false` in
      `observed-dialogs.json` and criterion 24 needs both halves. Paste what you
      see into that file, set `observed` to true, name yourself and the date, and
      `bun run docs:check-dialogs` will then fail until `docs/INSTALL.md` quotes
      them verbatim.

      > **DOWNLOAD IT THE WAY A USER WOULD — IN A BROWSER.** SmartScreen keys
      > off **Mark-of-the-Web**, the `Zone.Identifier` alternate data stream a
      > browser attaches to a downloaded file. `gh release download`, `curl`,
      > `Invoke-WebRequest` and a file copied from a share do **not** attach it,
      > so the installer runs with **no SmartScreen prompt at all** and the
      > check silently passes by never happening.
      >
      > This is not hypothetical: the 2026-07-31 run below fetched the build
      > with `gh release download` and saw no prompt. **A run that skips MOTW
      > cannot settle criterion 24** — it produces an absence of evidence that
      > reads exactly like a pass. Record such a run as "SmartScreen NOT
      > observed", never as "no SmartScreen issues".
      >
      > Verify MOTW is present before trusting a negative result:
      > `Get-Item .\<file> -Stream Zone.Identifier` — an error means no MOTW and
      > the SmartScreen half of this run is void.
- [ ] **Linux** — install the `.deb` with `sudo apt-get install ./<file>.deb`
      (or the `.rpm` with `dnf`). Launch from the desktop menu entry, not from
      a terminal in a checkout — a terminal in the wrong directory can mask
      exactly the class of path bug this checklist exists to find.
- [ ] **macOS** — see `docs/MACOS_SMOKE.md` for the Gatekeeper/quarantine
      specifics; the checklist below still applies in full.

## Launch and the static-mode guarantee

- [ ] App launches with no crash and no unhandled native dialog.
- [ ] **Icon check — read the EXECUTABLE, not the shortcut.** On a machine with
      a prior install, the Start-menu shortcut, the taskbar and Explorer may
      keep showing the **old** icon after an upgrade. That is the Windows
      **icon cache** (`%LOCALAPPDATA%\IconCache.db` / `…\Microsoft\Windows\
      Explorer\iconcache_*.db`), not the shipped binary. Observed on the
      2026-07-31 run and **is not a defect** — do not re-report it.

      Confirm against the binary itself: open the install directory and look at
      `onboard.exe`, or run `ie4uinit.exe -show` (or sign out and back in) to
      rebuild the cache. Only a wrong icon **on the executable** is a real
      finding.
- [ ] Mode indicator reads exactly, byte for byte:

      Static mode · no network · nothing leaves this machine

      Check the middle dot `·` (U+00B7) is not a hyphen, and that there is
      **no leading emoji** — the string now starts at `Static`. A padlock is
      drawn beside it as an SVG glyph; that glyph is `aria-hidden` and is NOT
      part of the string, so a screen reader must announce the text alone.

      This is criterion 13. A6 froze this string WITH a `🔒` prefix; the emoji
      was removed on 2026-07-31 by product-owner decision (AMENDMENT in
      `docs/DECISIONS.md`), so the frozen text and the shipped text differ by
      that prefix and the AMENDMENT is what reconciles them.
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

> **SUPERSEDED — the mode-indicator observation in the 2026-07-31 row.**
>
> That run observed the indicator reading
> `🔒 Static mode · no network · nothing leaves this machine` and it was
> byte-exact **against the build it was run on**. Later the same day the emoji
> was removed from both indicator strings by product-owner decision, so the
> string that observation confirms **is no longer the string that ships**.
>
> The observation is left in place rather than edited, because it is a true
> record of a real run and this table's rule is that rows are added, not
> rewritten. But it is **not current evidence for criterion 13 or 14** and must
> not be counted as such. The rest of that row — installer branding, analysis,
> graph, node → file, search — is unaffected and stands.
>
> Criteria 13 and 14 need a fresh observation against a build carrying the
> emoji-free strings. Until that row exists, they rest on the automated
> byte-exact tests only.

| date | platform | build | performed by | outcome |
|---|---|---|---|---|
| 2026-07-29 | Windows 11 (clean Sandbox) | v0.1.0 draft `.msi` | product owner | **FAILED** — engine never started (`os error 3`); mode indicator byte-exact ✓ |
| 2026-07-29 | Windows + Linux (CI, automated half only) | run 30489773363 | CI | **half (a) PASSED** — see below; half (b) not covered |
| 2026-07-31 | Windows 11 (desktop with a PRIOR install) | v0.1.0 draft, tag → `68c8f97` | product owner | **half (b) PASSED** — installer showed the Onboard mark (not stock NSIS); folder picked, analysis completed with no `E_ENGINE_NOT_STARTED`; dependency graph rendered; node click opened the file; search returned results and jumped to the hit line; mode indicator byte-exact ✓. **Two caveats below — SmartScreen NOT observed, so this run does not settle criterion 24.** ⚠️ **The indicator observation is SUPERSEDED**, see the note under the table |
| 2026-08-03 | Windows 11 (prior install cleared first) | v0.1.0 draft, tag → `3178bea`, **browser download with MOTW** | product owner | **PASSED, and it closes criterion 24.** SmartScreen observed on BOTH screens, strings recorded verbatim in `observed-dialogs.json`. Welcome page showed the Onboard mark, not stock NSIS art; installer title-bar icon correct. Folder picked, analysis completed, roadmap and graph rendered, node click opened the file, search jumped to the hit line. Mode indicator byte-exact with no emoji, padlock as an SVG glyph — **criterion 13 only**. Criterion 14's AI-mode string was NOT captured: it needs a key configured, and this run had none, so 14 stays CI-backed with no human observation |
| | Linux | | | |
| | macOS | | | |

**Correction to the 2026-07-31 row, made when the surface was finally
enumerated.** That row reads "installer showed the Onboard mark (not stock
NSIS)". On that build only `installerIcon` was ours; `sidebarImage` and
`headerImage` were unset, so the welcome page carried NSIS's stock `win.bmp` —
the blue arrow with a computer in a box. What was observed was almost certainly
the installer's TITLE-BAR icon, which `installerIcon` does control. The row is
left standing with this note rather than rewritten, because the mistake is the
useful part: "the installer showed our mark" is true of one surface and false of
another, and a single sentence covering both is how the branding gap survived
two rounds of being declared closed. The 2026-08-03 row above is the first
observation where the welcome page itself was ours.
