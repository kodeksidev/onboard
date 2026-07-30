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
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TAURI_CONF = REPO_ROOT / "apps" / "desktop" / "src-tauri" / "tauri.conf.json"

# A body this short is a stub, not release notes. The number is a floor chosen
# to catch an empty or placeholder file, not to judge prose.
MIN_BODY_CHARS = 400


def shipped_version() -> str:
    """The version the bundler stamps onto the artefacts."""
    config = json.loads(TAURI_CONF.read_text(encoding="utf-8"))
    version = config.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"tauri.conf.json has no usable version: {version!r}")
    return version


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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
