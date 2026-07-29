"""`ci:check-verify-coverage` — every stage of `verify` must run somewhere in CI.

`verify` now has two halves. The JS half runs on three operating systems in the
`verify` matrix; the Rust half needs a staged sidecar and a Rust toolchain, so it
runs in the `rust gates` job instead. That split is correct — making the verify
matrix install Rust and build a sidecar would triple the cost of the jobs that
exist to prove acceptance criterion 1 — but it introduces a drift no comment can
prevent: **CI now invokes something other than `verify`**, so a stage added to
`verify` is not automatically a stage CI runs.

This closes that by derivation rather than by discipline. It expands `verify`
transitively into leaf scripts, expands everything CI invokes the same way, and
fails if any leaf of `verify` is not covered. Add a stage and forget CI, and this
names the stage.

Written after pushing Rust that `cargo fmt --check` would have caught, because
the Rust gates were three separate commands nobody had bundled. Three commands
held in someone's head is not a process.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_DIR = REPO_ROOT / ".github" / "workflows"
PACKAGE_JSON = REPO_ROOT / "package.json"

BUN_RUN = re.compile(r"\bbun\s+run\b")
TOKEN = re.compile(r"[\w:@./-]+")
RUN_KEY = re.compile(r"^\s*-?\s*run:\s*(.*)$")

ROOT_CHAIN = "verify"


def referenced(command: str, names: set[str]) -> set[str]:
    """Package scripts a `bun run` command reaches, by any token (args included)."""
    if not BUN_RUN.search(command):
        return set()
    return {token for token in TOKEN.findall(command) if token in names}


def expand(name: str, scripts: dict[str, str], seen: set[str] | None = None) -> set[str]:
    """`name` plus every script it reaches transitively."""
    seen = seen if seen is not None else set()
    if name in seen:
        return seen
    seen.add(name)
    for callee in referenced(scripts.get(name, ""), set(scripts)):
        expand(callee, scripts, seen)
    return seen


def ci_commands() -> list[str]:
    """Every shell command any workflow runs, block scalars included."""
    commands: list[str] = []
    for path in sorted(WORKFLOW_DIR.glob("*.yml")) + sorted(WORKFLOW_DIR.glob("*.yaml")):
        block_indent: int | None = None
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.lstrip()
            if block_indent is not None:
                if not line.strip():
                    continue
                if len(line) - len(stripped) >= block_indent:
                    if not stripped.startswith("#"):
                        commands.append(line.strip())
                    continue
                block_indent = None
            if stripped.startswith("#"):
                continue
            match = RUN_KEY.match(line)
            if not match:
                continue
            rest = match.group(1).strip()
            if rest in ("|", ">", "|-", ">-", "|+", ">+"):
                block_indent = len(line) - len(stripped) + 1
            elif rest:
                commands.append(rest)
    return commands


def main() -> int:
    scripts = json.loads(PACKAGE_JSON.read_text(encoding="utf-8")).get("scripts", {})
    if ROOT_CHAIN not in scripts:
        print(f"REFUSING: package.json has no `{ROOT_CHAIN}` script", file=sys.stderr)
        return 1

    # What must be COVERED is the leaves — the scripts that actually do work.
    # `verify` and `verify:js` are chain nodes; CI deliberately invokes the two
    # halves rather than the root, so requiring the root itself would fail by
    # design and teach everyone to ignore this check.
    reachable = expand(ROOT_CHAIN, scripts)
    required = {name for name in reachable if not referenced(scripts.get(name, ""), set(scripts))}
    commands = ci_commands()
    if not commands:
        print("REFUSING: no commands parsed from the workflows — the scan is broken", file=sys.stderr)
        return 1

    covered: set[str] = set()
    for command in commands:
        for name in referenced(command, set(scripts)):
            covered |= expand(name, scripts)

    print(
        f"ci:check-verify-coverage — `{ROOT_CHAIN}` reaches {len(reachable)} script(s), "
        f"{len(required)} of them leaves; CI covers {len(covered)}"
    )

    # A scan that found nothing to require, or nothing covered, is broken rather
    # than passing: `verify` is a chain and CI exists to run it.
    if len(required) < 2:
        print(f"REFUSING: `{ROOT_CHAIN}` has {len(required)} leaf script(s)", file=sys.stderr)
        return 1
    if not covered:
        print("REFUSING: no CI command invokes any package script", file=sys.stderr)
        return 1

    missing = sorted(required - covered)
    if missing:
        print(
            "\nFAILED — stages of `verify` that no CI job runs:\n  " + "\n  ".join(missing) +
            "\n\nCI does not invoke `verify` directly (the Rust half needs a toolchain the "
            "verify matrix does not install), so a new stage is not covered automatically. "
            "Add it to a job.",
            file=sys.stderr,
        )
        return 1

    print("every stage of `verify` is run by some CI job")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
