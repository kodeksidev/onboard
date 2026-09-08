"""`release:plan` — emit the bundle matrix and upload globs from ONE table.

`release-formats.json` is the single source of what ships. This turns it into
the two shapes the workflow needs, so neither is written by hand:

  * `matrix`      — the `bundle` job's `strategy.matrix.include`, with each
                    platform's `--bundles` argument and upload glob attached;
  * `expected`    — the extensions a published release must contain, used by
                    `release-assets-check.py`.

Run with `--github` inside a workflow to write them to `$GITHUB_OUTPUT`.

It also refuses to plan a release while `main`'s own CI is failing. That is not
a matrix concern, but it is the last automated thing that runs before a tag is
cut, which makes it the only place the check can live without depending on
somebody remembering. See `check_main_ci` for why.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FORMATS = REPO_ROOT / "release-formats.json"
BUNDLE_DIR = "apps/desktop/src-tauri/target/release/bundle"


def load() -> list[dict[str, object]]:
    data = json.loads(FORMATS.read_text(encoding="utf-8"))
    platforms = data.get("platforms", [])
    if not isinstance(platforms, list) or not platforms:
        raise SystemExit("REFUSING: release-formats.json declares no platforms")
    return platforms


def upload_glob(extensions: list[str]) -> str:
    """One `**/*.<ext>` line per extension, which is what upload-artifact wants."""
    return "\n".join(f"{BUNDLE_DIR}/**/*{ext}" for ext in extensions)


def build_matrix(platforms: list[dict[str, object]]) -> list[dict[str, object]]:
    matrix: list[dict[str, object]] = []
    for entry in platforms:
        extensions = list(entry["extensions"])  # type: ignore[arg-type]
        matrix.append(
            {
                "os": entry["os"],
                "publish": entry["publish"],
                "bundles": ",".join(entry["bundles"]),  # type: ignore[arg-type]
                "uploadGlob": upload_glob(extensions),
            }
        )
    return matrix


def expected_extensions(platforms: list[dict[str, object]]) -> list[str]:
    """Extensions a PUBLISHED release must contain, one per artefact."""
    found: list[str] = []
    for entry in platforms:
        if entry["publish"]:
            found.extend(entry["extensions"])  # type: ignore[arg-type]
    return sorted(found)


def check_main_ci() -> int:
    """Refuse to plan a release while `main`'s last CI run is failing.

    WHY THIS EXISTS (docs/DECISIONS.md, 2026-09-08). `bun audit` had been red on
    `main` for at least two runs and nobody noticed; it was found only because a
    release run was being read job by job for an unrelated reason. The gate
    worked perfectly — detected, failed, named the packages — and reached no
    reader, because nothing carries a failing `main` to a person and a
    long-standing red stops carrying information.

    The lesson written down at the time was "read `main`'s last CI run before
    tagging", which is a habit, and habits are precisely what failed. So it is
    a check instead. Cutting a tag from a red repository should be a deliberate
    override (`--allow-red-ci`), not an oversight.

    UNDETERMINABLE IS NOT PASSING, BUT IT IS NOT FAILING EITHER. If `gh` is
    absent or unauthenticated this prints a loud NOT VERIFIED banner and lets
    the plan continue: turning an unavailable credential into a release blocker
    would make the check something people route around, which is how gates die.
    It never returns quietly.
    """
    if "--allow-red-ci" in sys.argv:
        print("  main CI: OVERRIDDEN (--allow-red-ci) — cutting a release from a repo whose CI is not green")
        return 0

    result = subprocess.run(
        ["gh", "run", "list", "--branch", "main", "--workflow", "CI", "--limit", "1",
         "--json", "conclusion,status,displayTitle,url"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0 or not result.stdout.strip():
        print("  main CI: NOT VERIFIED — `gh` unavailable or unauthenticated here.")
        print("           Check https://github.com/kodeksidev/onboard/actions?query=branch%3Amain by hand.")
        return 0

    try:
        runs = json.loads(result.stdout)
    except json.JSONDecodeError:
        print("  main CI: NOT VERIFIED — could not parse `gh run list` output")
        return 0
    if not runs:
        print("  main CI: NOT VERIFIED — no CI run found for main")
        return 0

    run = runs[0]
    status = run.get("status") or ""
    conclusion = run.get("conclusion") or ""
    if conclusion == "success":
        print(f"  main CI: green ({run.get('displayTitle', '')[:60]})")
        return 0
    if conclusion == "" or status in {"in_progress", "queued", "requested", "waiting"}:
        # STILL RUNNING IS NOT FAILING. Refusing here would block on timing
        # rather than on a defect, which is the fastest way to make
        # `--allow-red-ci` a reflex — and an override people reach for by habit
        # is worth less than no check at all.
        print(f"  main CI: NOT VERIFIED — the last run is still {status or 'pending'}: {run.get('url', '')}")
        return 0

    lines = [
        "",
        f"REFUSING: main's last CI run is {conclusion!r}, not green.",
        f"  {run.get('url', '')}",
        "",
        "A tag cut from a red repository ships whatever that red is about. Fix it, or",
        "pass --allow-red-ci to say the failure is understood and deliberately accepted.",
    ]
    print("\n".join(lines), file=sys.stderr)
    return 1


def main() -> int:
    platforms = load()
    matrix = build_matrix(platforms)
    expected = expected_extensions(platforms)

    if not expected:
        print("REFUSING: no platform is marked publish — a release would be empty", file=sys.stderr)
        return 1

    print(f"release:plan — {len(matrix)} platform(s), {len(expected)} published artefact(s)")
    for entry in matrix:
        marker = "publish" if entry["publish"] else "HELD   "
        print(f"  [{marker}] {entry['os']}: --bundles {entry['bundles']}")
    print(f"  expected on a release: {', '.join(expected)}")

    if check_main_ci() != 0:
        return 1

    if "--github" in sys.argv:
        output = os.environ.get("GITHUB_OUTPUT")
        if not output:
            print("REFUSING: --github given but GITHUB_OUTPUT is unset", file=sys.stderr)
            return 1
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"matrix={json.dumps(matrix)}\n")
            handle.write(f"expected={json.dumps(expected)}\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
