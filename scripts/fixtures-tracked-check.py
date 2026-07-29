"""`fixtures:check-tracked` — every fixture file on disk must be committed.

The fixture repositories under `packages/engine/fixtures/` are TEST INPUT: the
engine's snapshots assert byte-exact output for each one. That only means
something if a clean checkout gets the same input this machine has.

It did not. `kitchen-sink/other.log` and `kitchen-sink/src/sub/nested/other.log`
existed here and were never committed, because the fixture's OWN `.gitignore`
says `*.log` — and those two files are precisely what the fixture exists to
prove the walker ignores. So on any clean checkout the walker had nothing to
ignore, `filesIgnored` fell from 2 to 0, and both the negation test and all five
snapshots failed. Locally they passed. That is the same shape as the stale
`node_modules` in `docs/SECURITY_AUDIT.md` §6: a green result produced against
inputs no one else has.

The root `.gitignore` already carries `!/packages/engine/fixtures/**` as a
safety net, and its comment says "never let any rule ABOVE shadow the vendored
fixtures". Above was the blind spot: git gives a deeper `.gitignore` precedence
over a shallower one, so a fixture's own rules win — and those must not be
touched, because they are the thing under test. `git add -f` is the only way in,
which makes forgetting it a permanent hazard. Hence this check.

Comparison is by exact path via `git ls-files -z`: this repository contains
`src/dir with space/file.ts`, and splitting git's output on whitespace reports
it as untracked. Section 10's space-in-path requirement applies to checks too.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = REPO_ROOT / "packages" / "engine" / "fixtures"


def tracked_files() -> set[str]:
    """Paths git has under the fixtures tree, NUL-separated to survive spaces."""
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "ls-files", "-z", "--", "packages/engine/fixtures"],
        capture_output=True,
        text=True,
        check=True,
    )
    return {entry for entry in result.stdout.split("\0") if entry}


def files_on_disk() -> set[str]:
    return {
        path.relative_to(REPO_ROOT).as_posix()
        for path in FIXTURES.rglob("*")
        if path.is_file()
    }


def main() -> int:
    if not FIXTURES.is_dir():
        print(f"REFUSING: {FIXTURES} does not exist — the scan is broken", file=sys.stderr)
        return 1

    on_disk = files_on_disk()
    tracked = tracked_files()

    print(f"fixtures:check-tracked — {len(on_disk)} file(s) on disk, {len(tracked)} tracked")

    # A scan that found nothing is broken, not clean: five fixture repositories
    # live here and the snapshot suite reads all of them.
    if not on_disk:
        print("REFUSING: no fixture files found — the scan is broken", file=sys.stderr)
        return 1

    untracked = sorted(on_disk - tracked)
    if untracked:
        print("\nFAILED — fixture files that no clean checkout would get:", file=sys.stderr)
        for path in untracked:
            print(f"  {path}", file=sys.stderr)
        print(
            "\nA fixture's own .gitignore takes precedence over the root safety net, so "
            "these need `git add -f`. Do NOT edit the fixture's .gitignore — it is the "
            "behaviour under test.",
            file=sys.stderr,
        )
        return 1

    # Deleted-but-tracked is the mirror failure: the snapshot would then be
    # asserting over a file the working tree no longer has.
    absent = sorted(tracked - on_disk)
    if absent:
        print("\nFAILED — tracked fixture files missing from the working tree:", file=sys.stderr)
        for path in absent:
            print(f"  {path}", file=sys.stderr)
        return 1

    print("every fixture file on disk is committed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
