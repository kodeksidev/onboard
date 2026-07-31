# macOS manual smoke checklist

**Status: UNSIGNED. This checklist has not been run on a real Mac.** Tauri has
no WebDriver support on macOS (A19), so `apps/desktop/e2e/**` cannot exercise
this platform at all — `bun run e2e` is Windows/Linux only. This document is
the honest substitute Section 9 Phase 11 asks for: a manual checklist someone
with real macOS hardware runs and signs, not an automated substitute. No
Claude/agent session has a Mac available, so every box below is unchecked and
must stay that way until a human actually performs the run.

Do not mark this document "signed off" without actually performing every
step on real macOS hardware (Apple Silicon and Intel, if both are available)
against a real build of `onboard.app` — not the Windows/Linux binaries, not
a simulator, not a description of what "should" happen.

## Prerequisites

- [ ] macOS 12+ (A21's floor), both Apple Silicon (`aarch64-apple-darwin`)
      and Intel (`x86_64-apple-darwin`) if both machines are available.
- [ ] A real built `.app` (or the raw `cargo build --bin onboard` output) for
      this machine's architecture, with the matching
      `onboard-engine-<target-triple>` sidecar binary and the four
      `resources/grammars/*.wasm` files present next to it.
- [ ] Since v1 ships unsigned/ad-hoc builds (A3), the first launch will
      trigger Gatekeeper. Follow `docs/INSTALL.md`'s documented bypass
      (`xattr -dr com.apple.quarantine`, or right-click → Open) — this is
      expected, not a bug, and should not be "fixed" by disabling Gatekeeper
      system-wide.

## Checklist

### Launch & static-mode guarantee

- [ ] App launches without a crash or an unhandled native dialog.
- [ ] Mode indicator reads exactly `Static mode · no network · nothing
      leaves this machine` on first launch (A6, byte-exact — check the
      middle dot `·` U+00B7, not a hyphen).
- [ ] With a network monitor (e.g. Little Snitch, or `nettop`) running, no
      outbound connection is attempted at launch, at folder-pick, or during
      a full analysis. This is the core guarantee (Section 1) — treat any
      unexplained connection attempt as a CRITICAL finding, not a note.

### Folder pick → analysis → overview

- [ ] "Choose folder" opens the real native macOS folder picker (not a
      styled substitute).
- [ ] Picking a real, modestly sized JS/TS or Python repo (a few hundred
      files) completes analysis and shows the Overview panel within the
      criterion 12 budget (fresh 1,000-file repo, overview visible in under
      10 seconds from folder selection).
- [ ] Stack detection, entry points, and top files render plausibly for the
      chosen repo (not blank, not obviously wrong).

### Dependency graph

- [ ] Switching to "Dependency graph" renders the canvas without a blank or
      frozen frame.
- [ ] Clicking a node highlights its dependencies/dependents and the
      aria-live region's text visibly changes (verify with VoiceOver on at
      least one pass — Cmd+F5 to toggle).
- [ ] Directory collapse/expand works by clicking a compound node.
- [ ] Keyboard-only pass: Tab into the canvas, arrow keys move focus by
      importance rank, `[`/`]` step to dependents/dependencies, Enter opens
      the focused file, Escape exits, `/` focuses search — all without ever
      touching the trackpad/mouse.

### Roadmap, module map, search, file viewer

- [ ] "Start here" roadmap shows a numbered step list; clicking a step
      centers the corresponding node in the graph.
- [ ] Module map cards show real `keyFilePaths` as working jump links.
- [ ] "Where is X?" search for a real term (e.g. a function name you know
      exists in the chosen repo) returns a hit; clicking it opens the file
      viewer scrolled to that hit's line.
- [ ] File viewer (CodeMirror) opens a 1,000+ line file responsively — no
      multi-second freeze, scrolling stays smooth.

### Settings / AI (static-mode-only checks; Phase 12's live AI calls are out
of scope for this Phase 11 checklist)

- [ ] Settings dialog opens; AI toggle is off by default and "Test key"
      etc. are inert/absent until Phase 12 ships.
- [ ] Toggling light/dark in system appearance settings updates the app's
      theme live (A17: follows OS preference).

### Errors

- [ ] Choosing a folder, then deleting it from Finder before re-analyzing
      (Retry), shows the exact `E_PATH_NOT_FOUND` copy: "That folder no
      longer exists".
- [ ] Opening a file larger than 2 MB in the viewer shows "File too large to
      display", not a crash or a frozen viewer.

### Packaging (once Phase 14 lands — re-run this section then)

- [ ] The `.dmg` mounts, the app drags into Applications, and launches from
      there (not just from the mounted volume).
- [ ] `docs/INSTALL.md`'s Gatekeeper bypass steps are accurate for the exact
      dialog text this macOS version shows.

## Sign-off

| Field | Value |
|---|---|
| Signed off by | _(unsigned — no Mac available in this session)_ |
| Date | _(unsigned)_ |
| macOS version(s) tested | _(unsigned)_ |
| Architecture(s) tested | _(unsigned)_ |
| Onboard version/commit tested | _(unsigned)_ |
| Result | _(unsigned)_ |
