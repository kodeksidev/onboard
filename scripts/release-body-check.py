"""`release:check-body` — the published body IS the notes file, read back from the API.

`publish` sends `body_path`. This asserts what actually LANDED, by fetching the
created release and comparing it to the file. Sending the right input and
publishing the right output are different claims, and only the second is the
one a reader experiences.

WHY THIS EXISTS AS AN ASSERTION RATHER THAN A GLANCE
----------------------------------------------------
It is the only check in this workflow that cannot run on the pull-request path,
because `Create the release` is skipped there. That makes it the one most likely
to be "verified" by opening the page and nodding — the exact failure mode this
project keeps finding. So it runs in the job, on the tag, and fails the run.

WHAT IT COMPARES, AND WHY EQUALITY RATHER THAN HEURISTICS
--------------------------------------------------------
Exact equality of the normalized text, and nothing else.

`generate_release_notes: true` APPENDS its commit list to the body rather than
replacing it, so an accidental re-enable makes body != file and equality
catches it. Searching for markers like "What's Changed" would be redundant
against that, and would introduce a false-failure the day a notes file
legitimately contains the phrase. A check that can report a wrong finding is
worse than one that reports nothing — so this asserts the one thing that is
both necessary and sufficient.

Normalization is confined to what a transport legitimately changes: CRLF to LF,
and trailing whitespace at end of file. Nothing else is normalized away,
because everything else is content.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def normalize(text: str) -> str:
    """Undo only what a transport may legitimately alter."""
    return text.replace("\r\n", "\n").replace("\r", "\n").rstrip() + "\n"


def self_test() -> str | None:
    """The comparison must separate identical from different text.

    Without this the script could compare two normalized empty strings and
    report success on a release whose body never arrived.
    """
    if normalize("a\r\nb\r\n") != normalize("a\nb\n"):
        return "line-ending normalization is not idempotent"
    if normalize("a\nb\n\n\n") != normalize("a\nb"):
        return "trailing whitespace normalization is not idempotent"
    if normalize("hello") == normalize("hello world"):
        return "the comparison accepts different text — it would pass on any body"
    if normalize("# Onboard v0.1.0") == normalize("## What's Changed\n* a commit"):
        return "the comparison does not distinguish notes from a commit list"
    return None


def fetch_body(release_id: str, repository: str) -> str:
    result = subprocess.run(
        ["gh", "api", f"repos/{repository}/releases/{release_id}", "--jq", ".body"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"could not read release {release_id}: {result.stderr.strip()[:300]}")
    return result.stdout


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--repository", required=True, help="owner/name")
    parser.add_argument("--notes", required=True, help="repo-relative path to the notes file")
    args = parser.parse_args()

    failure = self_test()
    if failure:
        print(f"REFUSING: self-test failed — {failure}", file=sys.stderr)
        return 1

    notes_path = REPO_ROOT / args.notes
    if not notes_path.exists():
        print(f"FAILED — {args.notes} does not exist", file=sys.stderr)
        return 1

    expected = normalize(notes_path.read_text(encoding="utf-8"))
    published = normalize(fetch_body(args.release_id, args.repository))

    print(f"release:check-body — release {args.release_id}")
    print(f"  file:      {args.notes} ({len(expected)} chars normalized)")
    print(f"  published: {len(published)} chars normalized")

    if published == expected:
        print("\nthe published body IS the notes file, byte for byte after normalization")
        return 0

    # Report WHERE they diverge; "they differ" sends someone to diff by hand.
    print("\nFAILED — the published body is not the notes file.", file=sys.stderr)
    if published.startswith(expected):
        extra = published[len(expected) :]
        print(
            f"The file is a PREFIX of the body — {len(extra)} extra characters were "
            "appended. That is what `generate_release_notes: true` does; check it is "
            f"still false.\n  first 200 appended: {extra[:200]!r}",
            file=sys.stderr,
        )
    elif not published.strip():
        print("The published body is EMPTY — body_path did not reach the API.", file=sys.stderr)
    else:
        for index, (a, b) in enumerate(zip(expected, published)):
            if a != b:
                print(
                    f"First divergence at character {index}:\n"
                    f"  file:      {expected[max(0, index - 40) : index + 40]!r}\n"
                    f"  published: {published[max(0, index - 40) : index + 40]!r}",
                    file=sys.stderr,
                )
                break
        else:
            print(
                f"One is a truncation of the other: file {len(expected)}, "
                f"published {len(published)}",
                file=sys.stderr,
            )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
