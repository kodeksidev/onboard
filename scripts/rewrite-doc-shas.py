"""Repair SHA references in `docs/` after a `git filter-repo` rewrite, and
republish the commit map.

`filter-repo` changes every hash it touches, so a SHA written down in prose
stops resolving. That is silent: a stale SHA does not error, it just refers to
nothing. `docs:check` turns that silence into a failing gate; this script is
the repair it points at.

WHY THIS WAS REWRITTEN (2026-09-08). The first version resolved each short SHA
by asking a sibling `onboard-prerewrite-backup.git` to expand it, then looked
the full hash up in the commit map. That works for exactly one rewrite. This
repository has now had two, and after the second one every reference this
script needed to repair was a hash from the era BETWEEN them — which the
pre-first-rewrite backup has never contained. `resolve_in_backup` returned
`None`, `replace()` returned the token untouched, and the script reported
success while repairing none of the eight references that were actually
broken. `docs:check` stayed red and the repair tool said it was fine.

Two changes make that failure impossible rather than unlikely:

1. Short SHAs are expanded against the COMMIT MAP'S OWN KEYS by prefix. The
   map is the record of the rewrite being repaired, so it always covers the
   era the stale references come from — no external repository, no assumption
   about how many rewrites have happened.
2. The script now decides what to repair by importing `docs-check.py`'s own
   classifier, so "what the gate checks" and "what the repair fixes" cannot
   drift apart; and it EXITS NON-ZERO if any gate-checked reference is still
   unresolvable afterwards. Reporting success while fixing nothing is the
   specific behaviour that let this rot.
"""

from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
COMMIT_MAP = REPO_ROOT / ".git" / "filter-repo" / "commit-map"
PUBLISHED_MAP = REPO_ROOT / "docs" / "COMMIT_MAP.md"
ZERO = "0" * 40


def load_docs_check():
    """Import `docs-check.py` by path — its filename is not a valid module name.

    Sharing the classifier is the point: the repair must cover exactly the
    references the gate examines, including its context-based exemptions for
    build hashes and its exempt-file list.
    """
    spec = importlib.util.spec_from_file_location("docs_check", REPO_ROOT / "scripts" / "docs-check.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not load scripts/docs-check.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_map() -> dict[str, str]:
    if not COMMIT_MAP.is_file():
        raise SystemExit(
            f"commit map missing at {COMMIT_MAP} — it is written by `git filter-repo` and is "
            "not committed, so this script only runs in the working copy that performed the rewrite"
        )
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


def resolve_prefix(token: str, mapping: dict[str, str]) -> str | None:
    """The new hash for a pre-rewrite short SHA, or None if it is not a unique
    prefix of exactly one rewritten commit."""
    matches = [new for old, new in mapping.items() if old.startswith(token.lower())]
    if len(matches) != 1:
        return None
    return matches[0]


def repair_docs(docs_check, mapping: dict[str, str]) -> tuple[int, int, list[str]]:
    changed_files = 0
    changed_refs = 0
    unresolved: list[str] = []

    for path in sorted((REPO_ROOT / "docs").rglob("*.md")):
        rel = str(path.relative_to(REPO_ROOT)).replace("\\", "/")
        if rel in docs_check.EXEMPT_FILES:
            continue
        text = path.read_text(encoding="utf-8")
        original = text

        def replace(match: re.Match[str]) -> str:
            nonlocal changed_refs
            token = match.group(1)
            should_check, _phrase = docs_check.classify(text, match.start())
            if not should_check or docs_check.is_commit(token):
                return token
            new_full = resolve_prefix(token, mapping)
            if new_full is None:
                lineno = text.count("\n", 0, match.start()) + 1
                unresolved.append(f"{rel}:{lineno}: {token}")
                return token
            changed_refs += 1
            return new_full[: len(token)]

        text = docs_check.SHA_PATTERN.sub(replace, text)
        if text != original:
            path.write_text(text, encoding="utf-8", newline="")
            changed_files += 1
            print(f"  rewrote {rel}")

    return changed_files, changed_refs, unresolved


def compose_published_map(mapping: dict[str, str]) -> list[tuple[str, str]]:
    """Existing published rows, carried forward through this rewrite.

    The published table's job is "translate a hash written down before the
    rewrites". After a second rewrite its right-hand column is itself dead, so
    each row is composed through the new map rather than the table being
    regenerated from scratch — which would lose the original pre-first-rewrite
    hashes entirely, since no map in this repository still contains them.
    """
    if not PUBLISHED_MAP.is_file():
        return []
    rows = re.findall(r"^\| `([0-9a-f]{40})` \| `([0-9a-f]{40})` \|$", PUBLISHED_MAP.read_text(encoding="utf-8"), re.M)
    composed: list[tuple[str, str]] = []
    dropped: list[str] = []
    for original, previous in rows:
        carried = mapping.get(previous)
        if carried is None:
            dropped.append(previous)
        else:
            composed.append((original, carried))
    if dropped:
        raise SystemExit(
            f"REFUSING: {len(dropped)} published row(s) do not compose through the new commit map "
            f"(e.g. {dropped[0][:12]}). The map and the published table describe different rewrites; "
            "resolve by hand rather than publishing a table that is half-translated."
        )
    return composed


def render_published_map(composed: list[tuple[str, str]], mapping: dict[str, str]) -> str:
    carried_middle = {previous for previous in mapping if any(previous == p for p, _ in [])}
    already_published = {new for _, new in composed}
    between = sorted((old, new) for old, new in mapping.items() if new not in already_published)

    lines = [
        "# Commit map — every rewritten hash, to the one this repository has now",
        "",
        "`git filter-repo` has rewritten this repository's history TWICE.",
        "",
        "1. **2026-07-28** — to remove credential-SHAPED (never real) literals from",
        "   the planted-secret corpus that GitHub push protection was matching. See",
        "   `privacy::fake_secrets` for why fake strings still had to go, and",
        "   `docs/DECISIONS.md` for the decision itself.",
        "2. **After 2026-09-07** — a second rewrite, which re-hashed all 62 commits",
        "   from the Phase 0 scaffold forward. It invalidated every hash cited in",
        "   `docs/`, including the ones the first rewrite had already repaired.",
        "",
        "A hash written down before either operation refers to an object this",
        "repository no longer contains. These tables are how to translate one.",
        "",
        "`docs:check` asserts that every SHA cited in `docs/` still resolves, so a",
        "future rewrite cannot quietly invalidate them again; `scripts/rewrite-doc-shas.py`",
        "is the repair, and now fails loudly rather than silently no-opping when it",
        "cannot resolve a reference.",
        "",
        "## Original history (pre-2026-07-28) to current",
        "",
        "| original | current |",
        "| --- | --- |",
    ]
    for original, current in sorted(composed):
        lines.append(f"| `{original}` | `{current}` |")
    lines += [
        "",
        "## Between the two rewrites, to current",
        "",
        "The era the stale `docs/` citations came from: hashes that were correct",
        "when they were written down, after the first rewrite and before the second.",
        "",
        "| as written | current |",
        "| --- | --- |",
    ]
    for old, new in between:
        lines.append(f"| `{old}` | `{new}` |")
    return "\n".join(lines) + "\n"


def main() -> int:
    docs_check = load_docs_check()
    mapping = load_map()

    changed_files, changed_refs, unresolved = repair_docs(docs_check, mapping)
    composed = compose_published_map(mapping)
    PUBLISHED_MAP.write_text(render_published_map(composed, mapping), encoding="utf-8", newline="")

    print(f"rewrote {changed_refs} reference(s) across {changed_files} file(s)")
    print(f"published {PUBLISHED_MAP.relative_to(REPO_ROOT)}: {len(composed)} original row(s) carried forward")

    if unresolved:
        print(
            "\nFAILED — gate-checked references this map cannot resolve:\n  " + "\n  ".join(unresolved),
            file=sys.stderr,
        )
        print(
            "\nThese are cited commits that are in neither the current history nor the rewrite "
            "being repaired. Correct them by meaning (what the prose says the commit DID) rather "
            "than deleting the citation.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
