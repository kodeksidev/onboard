"""`docs:check` — every SHA cited in docs/ must resolve to a real commit.

A stale SHA does not error, it simply refers to nothing. `git filter-repo`
rewrote every hash in this repository once already; this is what stops the next
rewrite — or a rebase, or a squash — from silently invalidating the audit trail
those references exist to preserve.

Matches short AND full forms, because `docs/DECISIONS.md` cites 7-char SHAs.

Tolerates commits created AFTER a rewrite: `docs/COMMIT_MAP.md`'s own commit and
the SHA-rewrite commit necessarily postdate the map they are recorded in, so a
reference resolving in the repository is the test — not membership in the map.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SHA_PATTERN = re.compile(r"(?<![0-9a-zA-Z])([0-9a-f]{7,40})(?![0-9a-zA-Z])")

# `COMMIT_MAP.md` lists pre-rewrite hashes by design — they are supposed to be
# unresolvable; that is the whole point of publishing the translation.
EXEMPT_FILES = {"docs/COMMIT_MAP.md"}

# Hex tokens that are NOT commit SHAs, each with the reason it is exempt.
#
# An allowlist rather than a looser pattern, deliberately. Relaxing the match
# to exclude these would also stop catching real stale commit references that
# happen to be written the same way — and the failure mode of this check is
# supposed to be a false ALARM a human dismisses, never a false pass. Adding an
# entry here is a decision someone has to write down.
EXEMPT_TOKENS = {
    # `scripts/build-sidecar.ts` injects a 12-char sha256 prefix of the engine
    # bundle as ONBOARD_BUILD_HASH; DECISIONS.md's Phase 11 entry quotes two
    # observed values while retracting a claim about them. Build artefact
    # identity, unrelated to git.
    "a042c6ca35b6": "engine ONBOARD_BUILD_HASH, not a commit",
    "4b1c400fd59f": "engine ONBOARD_BUILD_HASH, not a commit",
}


def is_commit(candidate: str) -> bool:
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "cat-file", "-t", candidate],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0 and result.stdout.strip() == "commit"


def looks_like_a_sha_reference(line: str, token: str) -> bool:
    """Only treat a hex run as a SHA reference when it is written as code or
    prefixed by a word that means "commit" — otherwise a content hash, a build
    id or a hex blob in an example would be swept in and fail forever."""
    idx = line.find(token)
    before = line[max(0, idx - 24) : idx].lower()
    after = line[idx + len(token) : idx + len(token) + 2]
    in_backticks = before.endswith("`") and after.startswith("`")
    named = any(word in before for word in ("commit", "head", "sha", "at ", "in "))
    return in_backticks or named


def main() -> int:
    unresolved: list[str] = []
    checked = 0

    for path in sorted((REPO_ROOT / "docs").rglob("*.md")):
        rel = str(path.relative_to(REPO_ROOT)).replace("\\", "/")
        if rel in EXEMPT_FILES:
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for match in SHA_PATTERN.finditer(line):
                token = match.group(1)
                if token in EXEMPT_TOKENS:
                    continue
                if not looks_like_a_sha_reference(line, token):
                    continue
                checked += 1
                if not is_commit(token):
                    unresolved.append(f"{rel}:{lineno}: {token} does not resolve to a commit")

    print(f"docs:check — examined {checked} SHA-shaped reference(s) in docs/")

    # A check that examined nothing is broken, not passing: this repository is
    # known to cite commits in DECISIONS.md and SECURITY_AUDIT.md.
    if checked == 0:
        print("REFUSING: no SHA references examined — the scan is broken", file=sys.stderr)
        return 1

    if unresolved:
        print("\nFAILED — stale SHA references:", file=sys.stderr)
        for item in unresolved:
            print(f"  {item}", file=sys.stderr)
        print(
            "\nIf history was rewritten, run scripts/rewrite-doc-shas.py and commit the result.",
            file=sys.stderr,
        )
        return 1

    print("all cited SHAs resolve")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
