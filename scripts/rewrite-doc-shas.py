"""Rewrite SHA references in docs/ to their post-filter-repo hashes, and
publish the commit map.

`filter-repo` changes every hash it touches, so a SHA written down in prose
stops resolving. That is silent: a stale SHA does not error, it just refers to
nothing. The audit trail is the thing this project has spent weeks building, so
losing its cross-references to the operation that protects it would be a poor
trade.

Matches both short and full forms, because `docs/DECISIONS.md` cites 7-char
SHAs. Refuses to run if the commit map is missing or if a reference maps to
nothing.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
COMMIT_MAP = REPO_ROOT / ".git" / "filter-repo" / "commit-map"
PUBLISHED_MAP = REPO_ROOT / "docs" / "COMMIT_MAP.md"

SHA_PATTERN = re.compile(r"(?<![0-9a-zA-Z])([0-9a-f]{7,40})(?![0-9a-zA-Z])")
ZERO = "0" * 40


def load_map() -> dict[str, str]:
    if not COMMIT_MAP.is_file():
        raise SystemExit(f"commit map missing at {COMMIT_MAP}")
    mapping: dict[str, str] = {}
    for line in COMMIT_MAP.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) != 2 or len(parts[0]) != 40:
            continue
        old, new = parts
        if new == ZERO:
            continue  # commit dropped entirely
        mapping[old] = new
    if not mapping:
        raise SystemExit("commit map parsed to zero entries")
    return mapping


def resolve_in_backup(short: str) -> str | None:
    """Expand a short SHA using the pre-rewrite backup, since the working repo
    no longer contains the old objects."""
    backup = REPO_ROOT.parent / "onboard-prerewrite-backup.git"
    result = subprocess.run(
        ["git", "-C", str(backup), "rev-parse", short],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def main() -> int:
    mapping = load_map()
    changed_files = 0
    changed_refs = 0

    for path in sorted((REPO_ROOT / "docs").rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        original = text

        def replace(match: re.Match[str]) -> str:
            nonlocal changed_refs
            token = match.group(1)
            full = resolve_in_backup(token)
            if full is None or full not in mapping:
                return token  # not a rewritten commit; leave alone
            new_full = mapping[full]
            changed_refs += 1
            return new_full[: len(token)]

        text = SHA_PATTERN.sub(replace, text)
        if text != original:
            path.write_text(text, encoding="utf-8", newline="")
            changed_files += 1
            print(f"  rewrote {path.relative_to(REPO_ROOT)}")

    lines = [
        "# Commit map — pre-rewrite to post-rewrite",
        "",
        "`git filter-repo` rewrote every commit hash in this repository on",
        "2026-07-28, to remove credential-SHAPED (never real) literals from the",
        "planted-secret corpus that GitHub push protection was matching. See",
        "`privacy::fake_secrets` for why fake strings still had to go, and",
        "`docs/DECISIONS.md` for the decision itself.",
        "",
        "Every hash written down before that date — in an issue, a note, a",
        "review comment — refers to an object this repository no longer",
        "contains. This table is how to translate one. It is the reason the",
        "rewrite did not silently break the audit trail it was protecting.",
        "",
        "`docs:check` asserts that every SHA cited in `docs/` still resolves,",
        "so a future rewrite cannot quietly invalidate them again.",
        "",
        "| pre-rewrite | post-rewrite |",
        "| --- | --- |",
    ]
    for old, new in sorted(mapping.items()):
        lines.append(f"| `{old}` | `{new}` |")
    PUBLISHED_MAP.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="")

    print(f"rewrote {changed_refs} reference(s) across {changed_files} file(s)")
    print(f"published {PUBLISHED_MAP.relative_to(REPO_ROOT)} with {len(mapping)} entries")
    if changed_refs == 0:
        print("REFUSING: no references rewritten — the scan is probably broken", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
