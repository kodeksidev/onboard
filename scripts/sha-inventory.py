"""Inventory every git SHA referenced from docs/ and from commit message bodies.

`git filter-repo` rewrites every hash, so any SHA written down in prose or in a
commit message stops resolving the moment the rewrite runs. That is silent
breakage: a stale SHA does not error, it simply refers to nothing. The audit
trail this project has spent weeks building is exactly what would be lost.

Run before the rewrite to produce the list, and after to rewrite it.

Matches BOTH short (7-char) and full (40-char) forms, because `docs/DECISIONS.md`
cites short ones. Verifies each against the repository so a hex-looking string
that is not a commit (a content hash, a build id, an example) is not mistaken
for one.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# 7-40 hex chars, not part of a longer alphanumeric run. `\b` alone would match
# inside a base64 blob or a build hash, so the surrounding characters matter.
SHA_PATTERN = re.compile(r"(?<![0-9a-zA-Z])([0-9a-f]{7,40})(?![0-9a-zA-Z])")

SCANNED_DOC_SUFFIXES = (".md",)


def git(*args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(REPO_ROOT), *args],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()


def is_commit(candidate: str) -> bool:
    """True only if `candidate` resolves to a commit object in this repo."""
    kind = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "cat-file", "-t", candidate],
        capture_output=True,
        text=True,
        check=False,
    )
    return kind.returncode == 0 and kind.stdout.strip() == "commit"


def scan_docs() -> list[dict[str, object]]:
    found: list[dict[str, object]] = []
    docs = REPO_ROOT / "docs"
    for path in sorted(docs.rglob("*")):
        if path.suffix not in SCANNED_DOC_SUFFIXES or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for lineno, line in enumerate(text.splitlines(), start=1):
            for match in SHA_PATTERN.finditer(line):
                sha = match.group(1)
                if not is_commit(sha):
                    continue
                found.append(
                    {
                        "file": str(path.relative_to(REPO_ROOT)).replace("\\", "/"),
                        "line": lineno,
                        "sha": sha,
                        "full": git("rev-parse", sha),
                    }
                )
    return found


def scan_commit_messages() -> list[dict[str, object]]:
    found: list[dict[str, object]] = []
    revs = git("rev-list", "--all").splitlines()
    for rev in revs:
        body = git("log", "-1", "--format=%B", rev)
        for match in SHA_PATTERN.finditer(body):
            sha = match.group(1)
            if sha.startswith(rev[: len(sha)]):
                continue  # a commit citing itself is not a cross-reference
            if not is_commit(sha):
                continue
            found.append(
                {
                    "in_commit": rev,
                    "sha": sha,
                    "full": git("rev-parse", sha),
                }
            )
    return found


def scan_tags() -> list[dict[str, object]]:
    tags: list[dict[str, object]] = []
    for line in git("tag", "-l", "--format=%(refname:short) %(objectname) %(*objectname)").splitlines():
        parts = line.split()
        if not parts:
            continue
        name = parts[0]
        obj = parts[1] if len(parts) > 1 else ""
        peeled = parts[2] if len(parts) > 2 else ""
        target = peeled or obj
        tags.append(
            {
                "tag": name,
                "tag_object": obj,
                "commit": target,
                "subject": git("log", "-1", "--format=%s", target) if target else "",
            }
        )
    return tags


def main() -> int:
    inventory = {
        "docs": scan_docs(),
        "commit_messages": scan_commit_messages(),
        "tags": scan_tags(),
        "total_commits": int(git("rev-list", "--all", "--count") or 0),
    }
    print(json.dumps(inventory, indent=2))

    # A scan that found nothing is far more likely to be broken than correct:
    # this repository is known to cite SHAs in DECISIONS.md.
    if not inventory["docs"]:
        print("REFUSING: no SHA references found in docs/ — the scan is probably broken", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
