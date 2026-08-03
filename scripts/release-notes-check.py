"""`release:check-notes` — the release body is a file in this repository.

Without this, `publish` calls `generate_release_notes: true` and the notes a
user reads are a commit list, while `docs/RELEASE_NOTES_v<version>.md` sits in
the repository saying something else. Two sources of truth, one of which never
reaches anybody — the same shape as the `.rpm` the bundle matrix asked for and
the upload glob never sent.

So the file IS the body, and this asserts it exists for the version about to be
released.

Deliberately runs on EVERY release-workflow run, not only on tag pushes. A
check whose first execution is the release itself is a check nobody has run;
the same reasoning already applied to `release-assets-check.py`. On a dry run
this fails while it is cheap to fix.

Usage:
    python scripts/release-notes-check.py            # derive version, check file
    python scripts/release-notes-check.py --tag v1.2.3   # also assert tag == version
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from release_notes_table import TableError, download_filenames, shipped_version

REPO_ROOT = Path(__file__).resolve().parent.parent
FORMATS = REPO_ROOT / "release-formats.json"

# A body this short is a stub, not release notes. The number is a floor chosen
# to catch an empty or placeholder file, not to judge prose.
MIN_BODY_CHARS = 400


def expected_extensions() -> set[str]:
    """Extensions a release publishes, from the one table that decides that.

    Read here rather than imported from `release-assets-check.py` because that
    script is hyphenated and invoked, not importable. The duplication is one
    dictionary comprehension over the same file; what must not diverge is the
    SOURCE, and both read `release-formats.json`.
    """
    platforms = json.loads(FORMATS.read_text(encoding="utf-8"))["platforms"]
    return {ext.lower() for entry in platforms if entry["publish"] for ext in entry["extensions"]}


def check_downloads_table() -> list[str]:
    """SET EQUALITY, both directions, between the table and the published formats.

    `release-formats.json` drives the bundle matrix, the upload glob and
    `release-assets-check.py`. It does NOT drive the markdown table a reader of
    the release page actually clicks, so that table was a fourth decider kept in
    step by memory — and memory lost when the `.msi` was dropped and the table
    still listed four downloads for three assets.

    SCOPE: this compares EXTENSIONS, because that is all `release-formats.json`
    knows; concrete filenames come from the bundler's own naming and exist only
    once artefacts are built. A row with the right extension and a wrong
    filename passes here and is caught by `release-assets-check.py`, which
    compares real names against real assets. Neither check is the whole claim.
    """
    try:
        names = download_filenames()
    except TableError as error:
        return [str(error)]

    expected = expected_extensions()
    listed = {Path(name).suffix.lower() for name in names}

    problems: list[str] = []
    for extension in sorted(listed - expected):
        offenders = [n for n in names if Path(n).suffix.lower() == extension]
        problems.append(
            f"the Downloads table offers {extension} ({', '.join(offenders)}) and no "
            "platform publishes it — a reader would click a download that is not there"
        )
    for extension in sorted(expected - listed):
        problems.append(
            f"{extension} is published but has no row in the Downloads table — "
            "a shipped artefact nobody reading the release page knows exists"
        )
    if not problems:
        print(f"  downloads table: {len(names)} row(s), extensions equal the published set")
        for name in names:
            print(f"    {name}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", default="", help="the tag being published, e.g. v0.1.0")
    parser.add_argument("--emit-path", action="store_true", help="print the path only")
    args = parser.parse_args()

    version = shipped_version()
    notes = REPO_ROOT / "docs" / f"RELEASE_NOTES_v{version}.md"

    if args.emit_path:
        print(notes.relative_to(REPO_ROOT).as_posix())
        return 0

    print(f"release:check-notes — version {version} (from tauri.conf.json)")

    if not notes.exists():
        print(
            f"\nFAILED — {notes.relative_to(REPO_ROOT).as_posix()} does not exist.\n"
            "`publish` uses this file as the release body. Without it the release "
            "would carry an auto-generated commit list, which is not what a release "
            "should say. Write the notes, or correct the version in tauri.conf.json.",
            file=sys.stderr,
        )
        return 1

    body = notes.read_text(encoding="utf-8").strip()
    if len(body) < MIN_BODY_CHARS:
        print(
            f"\nFAILED — {notes.name} is {len(body)} characters, below the "
            f"{MIN_BODY_CHARS}-character floor. That is a placeholder, not notes.",
            file=sys.stderr,
        )
        return 1

    # The tag and the stamped version must agree. A tag that disagrees with the
    # binaries' own version produces a release whose assets say one thing and
    # whose page says another.
    if args.tag:
        expected = f"v{version}"
        if args.tag != expected:
            print(
                f"\nFAILED — tag {args.tag} does not match the version the bundler "
                f"stamps ({expected}). The assets and the release page would disagree.",
                file=sys.stderr,
            )
            return 1
        print(f"  tag {args.tag} matches the stamped version")

    print(f"  body: {notes.relative_to(REPO_ROOT).as_posix()} ({len(body)} characters)")

    problems = check_downloads_table()
    if problems:
        print(
            "\nFAILED — the Downloads table and release-formats.json disagree:\n  "
            + "\n  ".join(problems)
            + "\n\nrelease-formats.json drives the build matrix, the upload glob and the "
            "asset check. It does not drive this table, so the table is the one place "
            "that can quietly describe a release nobody is building.",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
