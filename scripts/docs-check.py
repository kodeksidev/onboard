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

# Exemption by CONTEXT, not by value.
#
# The first version of this check allowlisted two literal hashes —
# `a042c6ca35b6` and `4b1c400fd59f` — as "engine ONBOARD_BUILD_HASH, not a
# commit". That was wrong in a way worth recording: a build hash is
# CONTENT-ADDRESSED, so it changes whenever the engine source changes. This
# project demonstrated exactly that when a measurement seam was added and
# removed (`5228916446d5` -> `f252441bb078` -> `5228916446d5`). A by-value
# allowlist therefore goes stale on the next engine change, someone appends a
# new entry, and the old ones sit there matching nothing — the same defect as
# an allowed path that no longer exists, which the corpus guard already checks
# for and this file did not.
#
# The collision is structural, not incidental: a 12-hex build hash sits inside
# the 7-40 hex range a short SHA occupies, so no pattern can separate them by
# shape. Only context can.
#
# `DISQUALIFYING_CONTEXT` marks prose that is discussing a build hash.
# `CITING_CONTEXT` marks prose that is citing a commit. A token is only checked
# when the second is present and the first is not.
# Exactly the phrases that appear in the prose being excused — no more. Six
# were written first and three matched nothing; the inert-exemption check below
# caught them immediately. Speculative entries are not harmless here: they are
# indistinguishable from an exemption whose target has moved.
DISQUALIFYING_CONTEXT = (
    "hash-scan",
    "the hash from",
    "hash both times",
)

CITING_CONTEXT = (
    "commit",
    "head",
    "deleted in",
    "reverted in",
    "superseded",
    "landed in",
    "fixed in",
    "at `main`",
)

# How far back to look for the words above. Citations wrap across lines in
# these documents, so the window spans newlines rather than stopping at one.
CONTEXT_WINDOW = 220


def is_shallow() -> bool:
    """A shallow clone cannot answer this check's question.

    `actions/checkout` fetches depth 1 by default, so `git cat-file` resolves
    almost nothing and EVERY citation looks stale. Reporting those as "stale SHA
    references" would be a wrong finding, not a missing one — the check would
    send someone to rewrite documentation that is perfectly correct. Refusing
    names the real cause instead.
    """
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "rev-parse", "--is-shallow-repository"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() == "true"


def is_commit(candidate: str) -> bool:
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "cat-file", "-t", candidate],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0 and result.stdout.strip() == "commit"


def classify(text: str, position: int) -> tuple[bool, str]:
    """Decide whether the token at `position` is citing a commit.

    Returns (should_check, matched_context). The window spans newlines because
    citations in these documents wrap — `DECISIONS.md`'s "deleted in\\n
    `fa1fe5c`" puts the verb on the previous line.
    """
    window = text[max(0, position - CONTEXT_WINDOW) : position].lower()
    for phrase in DISQUALIFYING_CONTEXT:
        if phrase in window:
            return False, phrase
    for phrase in CITING_CONTEXT:
        if phrase in window:
            return True, phrase
    return False, ""


def main() -> int:
    if is_shallow():
        print(
            "REFUSING: shallow clone — `git cat-file` cannot resolve historical "
            "commits, so every citation would be reported stale. Check out with "
            "`fetch-depth: 0`.",
            file=sys.stderr,
        )
        return 1

    unresolved: list[str] = []
    checked = 0
    disqualified_used: set[str] = set()
    citing_used: set[str] = set()

    for path in sorted((REPO_ROOT / "docs").rglob("*.md")):
        rel = str(path.relative_to(REPO_ROOT)).replace("\\", "/")
        if rel in EXEMPT_FILES:
            continue
        text = path.read_text(encoding="utf-8")
        for match in SHA_PATTERN.finditer(text):
            token = match.group(1)
            should_check, phrase = classify(text, match.start())
            if not should_check:
                if phrase:
                    disqualified_used.add(phrase)
                continue
            citing_used.add(phrase)
            lineno = text.count("\n", 0, match.start()) + 1
            checked += 1
            if not is_commit(token):
                unresolved.append(f"{rel}:{lineno}: {token} does not resolve to a commit")

    print(f"docs:check — examined {checked} SHA-shaped reference(s) in docs/")

    # A check that examined nothing is broken, not passing: this repository is
    # known to cite commits in DECISIONS.md and SECURITY_AUDIT.md.
    if checked == 0:
        print("REFUSING: no SHA references examined — the scan is broken", file=sys.stderr)
        return 1

    # Non-vacuity for the exemption itself: a DISQUALIFYING phrase that never
    # matches anything is dead weight pretending to be a safeguard. This is the
    # check the corpus guard has for allowed paths and this file originally
    # lacked — an inert exemption hides the fact that its real target moved.
    inert = [p for p in DISQUALIFYING_CONTEXT if p not in disqualified_used]
    if inert:
        print(
            "\nFAILED — exemption phrases that matched nothing:\n  "
            + "\n  ".join(inert)
            + "\n\nAn exemption that excuses nothing is stale. Delete it, or correct it to "
            "match the prose it was written for.",
            file=sys.stderr,
        )
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

    problems = check_error_codes_documented() + check_constants_documented()
    if problems:
        print("\nFAILED — undocumented public surface:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    return 0


def names_present(text: str, names: list[str]) -> set[str]:
    """Which of `names` appear as WHOLE identifiers in `text`.

    Whole-identifier, not substring. A substring test is vacuous here in both
    directions: `ROLE_BOOST_HIGH` would be satisfied by
    `ROLE_BOOST_HIGH_CLASSIFICATIONS` without ever being documented itself, and
    a typo'd `W_PAGERANK_TYPO` would satisfy `W_PAGERANK`. Both were live holes
    in the first version of this check, found by trying to make it fail.
    """
    found: set[str] = set()
    for name in names:
        if re.search(rf"(?<![A-Za-z0-9_]){re.escape(name)}(?![A-Za-z0-9_])", text):
            found.add(name)
    return found


def docs_text() -> str:
    """Every markdown file under docs/ and the top-level README, concatenated."""
    parts = [p.read_text(encoding="utf-8") for p in sorted((REPO_ROOT / "docs").rglob("*.md"))]
    readme = REPO_ROOT / "README.md"
    if readme.exists():
        parts.append(readme.read_text(encoding="utf-8"))
    return "\n".join(parts)


def check_error_codes_documented() -> list[str]:
    """Every `E_*` the shell can surface must be named in the documentation.

    Derived from `error.rs`'s own `as_str` arms, never hand-listed — a
    hand-maintained copy is a second source of truth that goes stale the first
    time someone adds a code, which is exactly what happened when
    `E_ENGINE_NOT_STARTED` was introduced.
    """
    source = REPO_ROOT / "apps" / "desktop" / "src-tauri" / "src" / "error.rs"
    if not source.exists():
        return [f"{source} is missing — the error-code scan cannot run"]
    codes = sorted(set(re.findall(r'"(E_[A-Z0-9_]+)"', source.read_text(encoding="utf-8"))))
    if not codes:
        return ["no E_* codes found in error.rs — the scan is broken, not passing"]
    present = names_present(docs_text(), codes)
    missing = [code for code in codes if code not in present]
    print(f"docs:check — {len(codes)} error code(s) derived from error.rs")
    return [f"error code {code} is documented nowhere in docs/" for code in missing]


def check_constants_documented() -> list[str]:
    """Every exported constant in the engine's `constants.ts` must be named.

    A number that shapes user-visible output and lives only in code is a number
    nobody can review.
    """
    source = REPO_ROOT / "packages" / "engine" / "src" / "constants.ts"
    if not source.exists():
        return [f"{source} is missing — the constants scan cannot run"]
    names = sorted(
        set(re.findall(r"^export const ([A-Z][A-Z0-9_]*)", source.read_text(encoding="utf-8"), re.M))
    )
    if not names:
        return ["no exported constants found — the scan is broken, not passing"]
    present = names_present(docs_text(), names)
    missing = [name for name in names if name not in present]
    print(f"docs:check — {len(names)} engine constant(s) derived from constants.ts")
    return [f"constant {name} is named nowhere in docs/" for name in missing]


if __name__ == "__main__":
    raise SystemExit(main())
