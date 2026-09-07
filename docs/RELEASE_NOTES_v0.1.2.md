# Onboard v0.1.2

**A bug fix release. If you use the Dependency graph tab on Windows, v0.1.1
was broken for you — please upgrade.**

## What broke, and who it affected

### The Dependency graph — Onboard's headline feature — rendered unusable

On a real Windows install, against a real repository, the graph tab could
show no canvas at all, or a canvas painted in grey blocks at the wrong scale.
The toolbar's search box was clipped off the left edge, and the tab strip
itself was scrolled so far that the **Overview**, **Dependency graph**, and
**Start here** tabs were pushed out of view — the app's own navigation became
unreachable without scrolling to find it. Both horizontal and vertical
scrollbars appeared around the whole window.

This was not a rare window size or a large-repository edge case. It was a
timing race: the container Cytoscape (the graph library) measures itself
against had no lower-level constraint stopping it from growing to fit
whatever Cytoscape had just drawn into it — a measurement feeding a
measurement, landing on a different wrong size on different remounts.
Reopening the tab, resizing the window, or maximizing it did not fix it,
because the size Cytoscape kept re-reading was no longer connected to the
window at all by the time it went wrong.

No automated test caught this. All 385 UI tests and 4 accessibility suites
run against `jsdom`, which has no real layout engine — a container that
measures itself incorrectly is invisible to that entire class of test by
construction, the same reason v0.1.1's console-window defect went uncaught.

## What changed

- The dependency graph's container now resolves its size from its ancestors
  only, never from what is drawn inside it — the specific CSS gap that let
  the measurement race happen is closed (`min-h-0`/`min-w-0` on the flex
  chain feeding the graph's mount point).
- **Verified on real WebView2, not just in a browser.** A new automated
  check (`e2e/graph-layout.spec.ts`) opens the graph tab, tears it down, and
  reopens it repeatedly against the real Windows engine, asserting the
  container never exceeds its available space, the app shell never needs to
  scroll, and the tab strip stays visible — every time. Proven to actually
  catch the defect, not merely to pass: run against the un-fixed code first,
  it failed consistently; against the fix, it passes.
- Onboard now records which analysis engine is actually running (version,
  schema, grammar fingerprint) to its log file and shows it in Settings.
  This was already available internally and was previously read and
  discarded — added because this release's own investigation lost time to
  not being able to see it. See `docs/DECISIONS.md` for the full story.

## Upgrading

Install over v0.1.1; no migration and no settings change.

**Your first analysis of each repository after updating will be a cold
run** — slower than usual, with no cache reuse. The analysis cache is keyed
to the engine version, so updating discards it and rebuilds from scratch.
This is expected and happens once per repository; the run after it is fast
again.

## Platform status

Unchanged from v0.1.1. Windows and Linux are installed and verified on clean
machines in CI. **macOS is built but never run**, and remains excluded from
the release until `docs/MACOS_SMOKE.md` is signed off on real hardware.

## Downloads

| file | platform |
|---|---|
| `Onboard_0.1.2_x64-setup.exe` | Windows |
| `Onboard_0.1.2_amd64.deb` | Debian / Ubuntu |
| `Onboard-0.1.2-1.x86_64.rpm` | Fedora / RHEL |

Onboard is unsigned in v1, so Windows SmartScreen and macOS Gatekeeper will
object on first launch. `docs/INSTALL.md` quotes what each dialog says and
how to proceed.

## With AI off, it still makes no network connections at all

Unchanged, and still enforced by the egress checks in CI.
