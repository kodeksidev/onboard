"""`ci:check-installs` — every `bun install` in a workflow must be frozen.

A plain `bun install` is allowed to resolve a dependency differently from
`bun.lock` and then rewrite the lockfile in place. A job that does that proves
only that *some* tree passes; it says nothing about the tree a clean checkout
gets. That is not a hypothetical in this repository — a stale local
`node_modules` is exactly why every green run before 2026-07-28 is unverified
(see `docs/SECURITY_AUDIT.md`).

Adding `--frozen-lockfile` to the five sites that existed when this was written
fixes those five. It does not stop the sixth. So the scope is DERIVED: every
workflow file, every line, every invocation — not a list of line numbers that
goes stale the moment a job is added or reordered.

The scan asserts it matched something, and `self_test` asserts the matcher
actually fires on an unfrozen install, so a regex that silently stops matching
fails the gate instead of passing it.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_DIR = REPO_ROOT / ".github" / "workflows"

# `bun install` as an invocation. Word-bounded on both sides so `bun installer`
# or a package named `bun-install` is not mistaken for the command.
INVOCATION = re.compile(r"\bbun\s+install\b")
REQUIRED_FLAG = "--frozen-lockfile"


def is_comment(line: str) -> bool:
    """YAML comment lines mention the command without running it.

    Context, not value: the rationale comment in `ci.yml` writes the words
    `bun install` while discussing why the flag is mandatory. Excusing it by
    matching its text would go stale the moment the prose is reworded.
    """
    return line.lstrip().startswith("#")


def violations_in(text: str) -> list[tuple[int, str]]:
    """Return (line number, line) for each unfrozen `bun install` invocation."""
    found: list[tuple[int, str]] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        if is_comment(line) or not INVOCATION.search(line):
            continue
        if REQUIRED_FLAG not in line:
            found.append((lineno, line.strip()))
    return found


def count_invocations(text: str) -> int:
    return sum(
        1
        for line in text.splitlines()
        if not is_comment(line) and INVOCATION.search(line)
    )


def self_test() -> str | None:
    """Prove the matcher fires on what it exists to catch.

    A guard that only ever reports "clean" is indistinguishable from a guard
    whose pattern stopped matching. Returns an error string, or None if the
    matcher behaves.
    """
    unfrozen = "      - name: Install\n        run: bun install\n"
    if not violations_in(unfrozen):
        return "matcher did not flag a plain `bun install`"

    frozen = "        run: bun install --frozen-lockfile\n"
    if violations_in(frozen):
        return "matcher flagged an install that carries the flag"

    commented = "      # a comment mentioning bun install\n"
    if violations_in(commented):
        return "matcher flagged a YAML comment"

    return None


def main() -> int:
    failure = self_test()
    if failure:
        print(f"REFUSING: self-test failed — {failure}", file=sys.stderr)
        return 1

    workflows = sorted(WORKFLOW_DIR.glob("*.yml")) + sorted(WORKFLOW_DIR.glob("*.yaml"))
    if not workflows:
        print(f"REFUSING: no workflow files found under {WORKFLOW_DIR}", file=sys.stderr)
        return 1

    total = 0
    unfrozen: list[str] = []
    for path in workflows:
        rel = str(path.relative_to(REPO_ROOT)).replace("\\", "/")
        text = path.read_text(encoding="utf-8")
        total += count_invocations(text)
        for lineno, line in violations_in(text):
            unfrozen.append(f"{rel}:{lineno}: {line}")

    print(
        f"ci:check-installs — examined {total} `bun install` invocation(s) "
        f"across {len(workflows)} workflow file(s)"
    )

    # A scan that examined nothing is broken, not passing: CI cannot run any
    # JavaScript gate without installing dependencies first.
    if total == 0:
        print(
            "REFUSING: no `bun install` invocations found — the scan is broken",
            file=sys.stderr,
        )
        return 1

    if unfrozen:
        print("\nFAILED — `bun install` without --frozen-lockfile:", file=sys.stderr)
        for item in unfrozen:
            print(f"  {item}", file=sys.stderr)
        print(
            "\nAn unfrozen install may rewrite bun.lock mid-job, so the run "
            "proves nothing about a clean checkout. Add --frozen-lockfile.",
            file=sys.stderr,
        )
        return 1

    print("every workflow install is frozen")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
