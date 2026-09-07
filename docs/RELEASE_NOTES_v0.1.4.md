# Onboard v0.1.4

**A bug fix release covering two real defects. If you use the Dependency
graph tab, or your project doesn't have a root `package.json`, please
upgrade.**

## What broke, and who it affected

### The Dependency graph tab was unusable again, on a real repository

v0.1.2 fixed one measurement race in the graph tab's container. On a real,
large repository it could still render broken: grey, mis-scaled compound
blocks, content clustered in one corner of the canvas, and both a horizontal
and a vertical scrollbar around the whole window — the app's own tab strip
could be pushed out of view again, the same visible symptom v0.1.2 was
supposed to have closed.

The mechanism was different from v0.1.2's, and it was hiding in an
accessibility feature: a screen-reader table that mirrors the graph's data
(`GraphListFallback`, added for keyboard/screen-reader parity) is meant to
be invisible — one pixel, off-screen. On a real 500-file repository it
measured **28,554 pixels wide and, once the first half of this was fixed,
12,142 pixels tall** — a table with no cap on either its cell content or its
row count doesn't stay one pixel just because its CSS says to. Both axes are
now bounded: dependency lists longer than 8 entries are truncated with a
count of how many were omitted, and the table itself never renders more than
the 100 most important files, sorted by importance rank, with the same kind
of "N more not shown" note pointing at the **Where is X?** search for the
rest. A screen reader was never going to usefully read 500 rows in the first
place — this is a correctness fix for that reader, not only a layout patch
for everyone else.

**A related, narrower symptom is still open.** Some installs report a
horizontal scrollbar on the graph tab that this fix does not appear to
close — it has not reproduced on the machine this was diagnosed on, across
debug and release builds, multiple window sizes, and both cold and warm
analysis caches. If you still see it after upgrading, that is useful
information on its own; please report it rather than assume it was meant to
be fixed by this release.

### A monorepo without a root manifest read as "Unknown project type," with the wrong entry points

If your repository holds two or more independent packages side by side
(a backend, a dashboard, a frontend) with no root `package.json` declaring
them as a workspace, the Overview tab reported: unknown project type, zero
dependencies, and — in one real case — two Python build scripts under
`docs/` picked as the entry points for what was actually a TypeScript
monorepo. The file walk and parser were never the problem; manifest and
workspace detection simply never looked past the repo root.

This also under-reported for some repositories that DO declare a root
workspace: dependencies belonging to a package one level down were never
read, because manifest detection didn't consult the list of workspace
packages other parts of the engine already knew about. Fixed for both
shapes now.

## What changed

- **`GraphListFallback`'s accessibility table is capped on both axes.**
  `table-layout: fixed` plus an 8-entry cap on dependency/dependent lists
  bounds the table's width regardless of path length; a 100-row cap, sorted
  by importance rank, bounds its height regardless of repo size. Both caps
  say how much was omitted rather than silently dropping it.
- **Manifest and workspace detection now look past the repo root.**
  A repository with named sibling packages and no root manifest is now
  recognized as a monorepo — matched deliberately narrowly, after this
  project's own history with detection rules that fire on shapes nobody
  intended: a root `package.json` (even one that isn't a workspace root)
  always opts out of the new inference entirely, a candidate package must
  be a real, comparably-sized sibling (an incidental helper package
  sitting next to a substantial real one does not count), and the
  qualifying packages together must cover a majority of the repository's
  own files. `detectedType`, `sourceRoots`, `entryPoints`, and reported
  dependencies all correct themselves once a monorepo is recognized.
- **An inferred workspace name never participates in import resolution.**
  A name this project guesses from directory shape is not the same
  guarantee as a maintainer's own `workspaces` declaration — if a guessed
  name happened to collide with a real npm package, trusting it could
  silently misresolve a genuine external import as an internal one. That
  is enforced at the type level: the function that builds import
  resolution's context will not compile against the full package list,
  only against one that has already been filtered to explicitly-declared
  packages.
- Manifest reading now also correctly covers explicitly-declared workspace
  packages that were previously missed at the repo root alone — caught
  while fixing the above, in this project's own snapshot test suite: a
  vendored monorepo fixture had a real, undeclared-until-now dependency
  that had gone unreported since the fixture was written.

## Upgrading

Install over v0.1.3; no settings change. **Repositories affected by either
fix above will re-analyze cold once** — the same one-time cost as an engine
version change — because their manifests, dependencies, or detected type
now compute differently than before. Everything else reuses the existing
cache as usual.

## Platform status

Unchanged from v0.1.3. Windows and Linux are installed and verified on
clean machines in CI. **macOS is built but never run**, and remains
excluded from the release until `docs/MACOS_SMOKE.md` is signed off on real
hardware.

## Downloads

| file | platform |
|---|---|
| `Onboard_0.1.4_x64-setup.exe` | Windows |
| `Onboard_0.1.4_amd64.deb` | Debian / Ubuntu |
| `Onboard-0.1.4-1.x86_64.rpm` | Fedora / RHEL |

Onboard is unsigned in v1, so Windows SmartScreen and macOS Gatekeeper will
object on first launch. `docs/INSTALL.md` quotes what each dialog says and
how to proceed.

## With AI off, it still makes no network connections at all

Unchanged, and still enforced by the egress checks in CI.
