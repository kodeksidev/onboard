"""`release:check-assets` — the staged set must EQUAL the expected set.

This used to validate arrivals: reject a held format, reject an unrecognised
one, pass otherwise. That could not catch the defect it should have. The upload
glob omitted `*.rpm`, so the `.rpm` was built and never uploaded, and a dry run
went green staging three assets while the docs promised four.

**Absence is the one thing a check on arrivals cannot see.** So the question is
no longer "is everything here allowed" but "is the set here the set expected" —
and both sides come from `release-formats.json`, the single table the workflow's
matrix and upload globs are also generated from.

Three failures, all by name:
  * MISSING  — expected on a release, did not arrive (the `.rpm` case);
  * HELD     — a platform whose artefact has never been executed (macOS);
  * UNKNOWN  — an extension no platform declares.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from release_notes_table import TableError, download_filenames

REPO_ROOT = Path(__file__).resolve().parent.parent
FORMATS = REPO_ROOT / "release-formats.json"


def platforms() -> list[dict[str, object]]:
    return json.loads(FORMATS.read_text(encoding="utf-8"))["platforms"]


def expected_extensions() -> set[str]:
    return {
        ext.lower()
        for entry in platforms()
        if entry["publish"]
        for ext in entry["extensions"]  # type: ignore[attr-defined]
    }


def held_extensions() -> set[str]:
    return {
        ext.lower()
        for entry in platforms()
        if not entry["publish"]
        for ext in entry["extensions"]  # type: ignore[attr-defined]
    }


def check_notes_table(assets: list[Path]) -> list[str]:
    """SET EQUALITY on FILENAMES between the Downloads table and the real assets.

    `release-notes-check.py` already compares that table's EXTENSIONS to
    `release-formats.json`, which is all that can be known before anything is
    built. This is the other half and it is not redundant: an extension-level
    check passes a row reading `Onboard_0.1.0_x64_en-US.exe` when the artefact
    is really `Onboard_0.1.0_x64-setup.exe`. Same extension, right count, and a
    download link to a file that does not exist.

    Here the actual staged filenames are in hand, so the comparison is exact.
    This is the last point before a release page exists where the two can be
    made to agree.
    """
    try:
        listed = download_filenames()
    except TableError as error:
        return [str(error)]

    staged = {path.name for path in assets}
    problems: list[str] = []
    for name in sorted(set(listed) - staged):
        problems.append(f"the Downloads table offers {name}, which is NOT among the staged assets")
    for name in sorted(staged - set(listed)):
        problems.append(f"{name} is staged for publication and has NO row in the Downloads table")
    return problems


def self_test() -> str | None:
    """The table must describe a real release before anything is checked against it."""
    expected, held = expected_extensions(), held_extensions()
    if not expected:
        return "no published extensions derived — a release would be empty"
    if not held:
        return "no held extensions derived — the macOS hold would be unenforceable"
    if expected & held:
        return f"an extension is both published and held: {sorted(expected & held)}"
    return None


def main() -> int:
    failure = self_test()
    if failure:
        print(f"REFUSING: {failure}", file=sys.stderr)
        return 1

    if len(sys.argv) < 2:
        print("REFUSING: no asset directory given", file=sys.stderr)
        return 1

    root = Path(sys.argv[1])
    if not root.is_dir():
        print(f"REFUSING: {root} is not a directory", file=sys.stderr)
        return 1

    expected, held = expected_extensions(), held_extensions()
    assets = sorted(p for p in root.rglob("*") if p.is_file())
    received = {p.suffix.lower() for p in assets}

    print(f"release:check-assets — {len(assets)} staged asset(s)")
    for path in assets:
        suffix = path.suffix.lower()
        kind = "expected" if suffix in expected else "HELD" if suffix in held else "UNKNOWN"
        print(f"  [{kind:8s}] {path.relative_to(root)}")

    missing = sorted(expected - received)
    staged_held = sorted(received & held)
    unknown = sorted(received - expected - held)

    if missing:
        print(
            "\nFAILED — expected on this release and NOT staged:\n  "
            + "\n  ".join(missing)
            + "\n\nThe format is declared in release-formats.json but no artefact with "
            "that extension arrived. It was either not built or not uploaded — and an "
            "asset that never arrives is invisible to any check on arrivals.",
            file=sys.stderr,
        )
        return 1

    if staged_held:
        print(
            "\nFAILED — held-platform artefacts staged for publication:\n  "
            + "\n  ".join(staged_held)
            + "\n\nThat platform's build has never been executed on its target. "
            "Publishing it ships an assumption.",
            file=sys.stderr,
        )
        return 1

    if unknown:
        print(
            "\nFAILED — assets no platform declares:\n  "
            + "\n  ".join(unknown)
            + "\n\nAdd the extension to release-formats.json, or stop uploading it. A "
            "format ships because someone decided to, not because a glob caught it.",
            file=sys.stderr,
        )
        return 1

    print(f"\nstaged set equals expected set: {', '.join(sorted(expected))}")

    # Only after the extension-level verdict. A missing or unknown FORMAT is a
    # build problem; a table that disagrees is a documentation problem, and
    # reporting the second while the first is outstanding buries the cause.
    mismatched = check_notes_table(assets)
    if mismatched:
        print(
            "\nFAILED — the release notes' Downloads table does not match what is "
            "being published:\n  "
            + "\n  ".join(mismatched)
            + "\n\nThe table IS the release body (`publish` sends it as `body_path`), so "
            "this is what a reader sees and clicks. An extension check cannot catch a "
            "wrong filename; only the real assets can.",
            file=sys.stderr,
        )
        return 1

    print(f"notes' Downloads table names exactly those {len(assets)} asset(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
