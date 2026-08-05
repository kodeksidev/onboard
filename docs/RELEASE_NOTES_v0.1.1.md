# Onboard v0.1.1

**A bug fix release. If you run Onboard on Windows, or on any Node project
with Express routes, v0.1.0 was broken for you — please upgrade.**

## What broke, and who it affected

### Analysis crashed outright on most Node repositories

Any Express-style route that carries middleware — `router.get('/users',
validate(schema), handler)` — caused the entire analysis to fail with

> Analysis stopped unexpectedly
> *Details: UNIQUE constraint failed: symbol.id*

Not one file degraded: **the whole run produced nothing**, and retrying failed
identically every time. There was no partial result and nothing usable in the
cache.

This is not an edge case. A route with middleware is the ordinary shape of a
real Express route — authentication, validation, rate limiting — so most Node
repositories with a routing layer hit it. Routes without middleware
(`router.get('/x', handler)`, exactly two arguments) were the only ones that
worked, which is why it survived our own testing: the fixture that was supposed
to prove this code correct contained only two-argument routes.

The underlying cause was a fix in the previous release. It required a route to
have a handler argument, but expressed that in a way that made the parser
report the same route once per argument, so a route with three arguments was
recorded twice and a route with five was recorded four times. Those duplicates
collided in the cache and stopped the run.

**Python users were affected differently and more quietly.** Ordinary
decorators — `@click.option`, `@mock.patch`, `@unittest.skipIf` — were being
recorded as HTTP routes. Across a large sample of real Python code, 230 things
were labelled "route" and 5 of them actually were. That mostly did not crash;
it silently distorted file classification, importance ranking and the suggested
reading order for every Python project. Two `@app.get` / `@app.post`
decorators on the same function could also crash the run outright.

### A console window opened beside the app on Windows

Every launch put a second window on screen — a black console titled with the
path to `onboard-engine.exe` — and it stayed there for as long as Onboard was
running. Cosmetic, but it made the app look broken from the first second.

Linux and macOS were never affected; this could not happen there.

### The error message pointed at a log that said nothing

When analysis did fail, the message said *"The analysis engine exited before
finishing. The log is at … Retrying usually works — the cache keeps completed
files."* For this failure all three of those statements were untrue: the engine
had not exited, retrying could never succeed, and the cache kept nothing. The
log the message named contained no record of the error at all.

## What changed

- Routes are now recorded exactly once per route, whatever the argument count.
- Python route detection no longer claims ordinary decorators are routes, and
  two routes stacked on one function no longer collide.
- No console window on Windows.
- A failure the engine *reports* is now distinguished from the engine *dying*,
  with its own message that promises neither a useful retry nor a preserved
  cache — because for this class of failure neither is true.
- Errors are written to the log, so the log the message names can answer for
  the failure it describes.

## Upgrading

Install over v0.1.0; no migration and no settings change.

**Your first analysis of each repository after updating will be a cold run** —
slower than usual, with no cache reuse. The analysis cache is keyed to the
engine version, so updating discards it and rebuilds from scratch. This is
expected and happens once per repository; the run after it is fast again.

## Platform status

Unchanged from v0.1.0. Windows and Linux are installed and verified on clean
machines in CI. **macOS is built but never run**, and remains excluded from the
release until `docs/MACOS_SMOKE.md` is signed off on real hardware.

## Downloads

| file | platform |
|---|---|
| `Onboard_0.1.1_x64-setup.exe` | Windows |
| `Onboard_0.1.1_amd64.deb` | Debian / Ubuntu |
| `Onboard-0.1.1-1.x86_64.rpm` | Fedora / RHEL |

Onboard is unsigned in v1, so Windows SmartScreen and macOS Gatekeeper will
object on first launch. `docs/INSTALL.md` quotes what each dialog says and how
to proceed.

## With AI off, it still makes no network connections at all

Unchanged, and still enforced by the egress checks in CI.
