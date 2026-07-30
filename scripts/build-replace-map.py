"""Derive filter-repo's replace-text mapping from the guard's own pattern list.

Two implementations of "what is a credential-shaped literal" would drift — the
defect this project has hit four times. So the mapping is DERIVED from
`tests/fake_secrets_guard.rs`'s `credential_patterns()` rather than hand-written.

## The dialect risk, handled explicitly

The guard's patterns are Rust `regex` crate syntax; `filter-repo --replace-text`
uses Python `re`. Deriving from one and executing in the other is still a second
implementation, just an automatically-produced one. A rule that silently matches
nothing would leave that family in history — the push would fail again, or worse,
succeed while the literal survives.

So every derived rule is verified against that family's known literals BEFORE
filter-repo runs. A rule matching none of them is a hard error.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GUARD = REPO_ROOT / "apps/desktop/src-tauri/tests/fake_secrets_guard.rs"

EXPECTED_FAMILIES = {
    "aws",
    "github",
    "slack",
    "stripe",
    "google",
    "anthropic",
    "openai",
    "jwt",
}

# One known literal per family, assembled from fragments so THIS file contains
# no contiguous credential-shaped literal either — the same rule the guard
# enforces on everything else.
KNOWN_LITERALS: dict[str, list[str]] = {
    "aws": ["AKIA" + "IOSFODNN7EXAMPLE", "AKIA" + "ABCDEFGHIJKLMNOP"],
    "github": ["ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789AB", "ghs_" + "abcdefghijklmnopqrstuvwxyz0123456789"],
    "slack": ["xoxb-" + "111111111111-222222222222-abcdefghij", "xoxp-" + "1234567890-abcdefghij"],
    "stripe": ["sk" + "_live_" + "abcdefghijklmnop1234567890", "rk" + "_live_" + "abcdefghijklmnop123456"],
    "google": ["AIza" + "SyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456"],
    "anthropic": ["sk-" + "ant-" + "abcdefghijklmnopqrstuvwxyz1234"],
    "openai": ["sk-" + "abcdefghijklmnopqrstuvwxyz123456"],
    "jwt": ["eyJ" + "hbGciOiJIUzI1NiJ9" + "." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0" + "." + "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYE"],
}

# Visibly a rewrite, matches no scanner pattern, and keeps a Rust string
# literal closed because it contains no quote, backslash or newline.
def marker(family: str) -> str:
    return f"REDACTED-{family.upper()}-BY-HISTORY-REWRITE"


def extract_patterns() -> dict[str, str]:
    """Pull ("name", r"pattern") pairs out of the guard's credential_patterns()."""
    text = GUARD.read_text(encoding="utf-8")
    block = re.search(
        r"let raw: &\[\(&str, &str\)\] = &\[(.*?)\];", text, re.DOTALL
    )
    if block is None:
        raise SystemExit("could not locate credential_patterns() in the guard")
    pairs = re.findall(r'\("([a-z]+)",\s*r"((?:[^"\\]|\\.)*)"\)', block.group(1))
    return {name: pattern for name, pattern in pairs}


def to_python_regex(rust_pattern: str) -> str:
    """The two dialects agree on everything used here.

    The guard uses only character classes, bounded repetition, non-capturing
    groups and escaped literals — all identical in Python `re`. This function
    exists to make the translation an explicit, reviewable step rather than an
    unstated assumption, and to fail loudly if a future pattern uses Rust-only
    syntax.
    """
    for unsupported in ("(?P<", r"\p{", "(?i)"):
        if unsupported in rust_pattern:
            raise SystemExit(
                f"pattern uses syntax this translation does not verify: {unsupported!r}"
            )
    return rust_pattern


def main() -> int:
    patterns = extract_patterns()
    if set(patterns) != EXPECTED_FAMILIES:
        raise SystemExit(
            f"derived families {sorted(patterns)} != expected {sorted(EXPECTED_FAMILIES)}"
        )
    if len(patterns) < 8:
        raise SystemExit(f"derived mapping is short: {len(patterns)} rules")

    lines: list[str] = []
    for family, rust_pattern in sorted(patterns.items()):
        python_pattern = to_python_regex(rust_pattern)
        compiled = re.compile(python_pattern)

        known = KNOWN_LITERALS.get(family, [])
        if not known:
            raise SystemExit(f"no known literal to verify family {family}")
        for literal in known:
            if not compiled.search(literal):
                raise SystemExit(
                    f"TRANSLATION FAILURE: derived rule for {family} matches none of its "
                    f"known literals. Rule {python_pattern!r} vs {literal!r}. Running "
                    f"filter-repo with this mapping would leave {family} in history."
                )
        # And it must not fire on ordinary prose.
        if compiled.search("an ordinary sentence about keys tokens and secrets"):
            raise SystemExit(f"rule for {family} matches ordinary prose")

        lines.append(f"regex:{python_pattern}==>{marker(family)}")
        print(f"  verified {family}: {len(known)} literal(s) matched", file=sys.stderr)

    out = REPO_ROOT / "replace-map.txt"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {out} with {len(lines)} rules", file=sys.stderr)
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
