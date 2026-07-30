"""Assert no credential-shaped literal survives in ANY blob or ANY commit
message, across ALL refs — not merely at HEAD.

Uses the SAME pattern list the guard uses (via `build-replace-map.py`'s
derivation), because a hand-written grep here would be a second implementation
free to drift from the guard — the defect this project has hit repeatedly.

Two passes, because `--replace-text` rewrites blobs only:

  1. every blob reachable from every ref
  2. every commit message (subject + body + author/committer names)

Both assert a non-trivial object count first, so an empty walk cannot pass.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIN_BLOBS = 200
MIN_COMMITS = 50


def git_bytes(*args: str) -> bytes:
    return subprocess.run(
        ["git", "-C", str(REPO_ROOT), *args], capture_output=True, check=False
    ).stdout


def git_text(*args: str) -> str:
    return git_bytes(*args).decode("utf-8", errors="replace")


def load_patterns() -> dict[str, re.Pattern[str]]:
    """Read the derived mapping rather than restating the patterns here."""
    mapping = REPO_ROOT / "replace-map.txt"
    if not mapping.is_file():
        raise SystemExit(
            "replace-map.txt is missing — run build-replace-map.py first so the "
            "patterns come from one derivation, not two"
        )
    out: dict[str, re.Pattern[str]] = {}
    for line in mapping.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        pattern, marker = line.split("==>")
        out[marker] = re.compile(pattern[len("regex:") :])
    if len(out) < 8:
        raise SystemExit(f"only {len(out)} patterns loaded; expected 8 families")
    return out


def scan_blobs(patterns: dict[str, re.Pattern[str]]) -> tuple[int, list[str]]:
    listing = git_text("rev-list", "--all", "--objects")
    blobs: list[tuple[str, str]] = []
    for line in listing.splitlines():
        parts = line.split(maxsplit=1)
        if len(parts) != 2:
            continue
        sha, path = parts
        kind = git_text("cat-file", "-t", sha).strip()
        if kind == "blob":
            blobs.append((sha, path))

    offenders: list[str] = []
    for sha, path in blobs:
        content = git_bytes("cat-file", "blob", sha).decode("utf-8", errors="replace")
        for marker, rx in patterns.items():
            hit = rx.search(content)
            if hit:
                offenders.append(f"blob {sha[:12]} ({path}): {marker} -> {hit.group(0)[:48]!r}")
    return len(blobs), offenders


def scan_messages(patterns: dict[str, re.Pattern[str]]) -> tuple[int, list[str]]:
    revs = git_text("rev-list", "--all").split()
    offenders: list[str] = []
    for rev in revs:
        body = git_text("log", "-1", "--format=%B%n%an%n%ae%n%cn%n%ce", rev)
        for marker, rx in patterns.items():
            hit = rx.search(body)
            if hit:
                offenders.append(f"message {rev[:12]}: {marker} -> {hit.group(0)[:48]!r}")
    return len(revs), offenders


def main() -> int:
    patterns = load_patterns()
    blob_count, blob_offenders = scan_blobs(patterns)
    msg_count, msg_offenders = scan_messages(patterns)

    print(f"scanned {blob_count} blobs across all refs")
    print(f"scanned {msg_count} commit messages across all refs")

    failures: list[str] = []
    if blob_count < MIN_BLOBS:
        failures.append(f"only {blob_count} blobs scanned (< {MIN_BLOBS}) — the walk is probably broken")
    if msg_count < MIN_COMMITS:
        failures.append(f"only {msg_count} commits scanned (< {MIN_COMMITS}) — the walk is probably broken")
    failures.extend(blob_offenders)
    failures.extend(msg_offenders)

    if failures:
        print("\nFAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        return 1

    print("\nclean: no credential-shaped literal in any blob or message, in any ref")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
