"""`guards:scan` — what does each guard DO when it fires?

The Phase 13 audit enumerated invariants and asked whether each HOLDS. That
method cannot, structurally, surface what a guard does when it fires, and INV-3
is what it missed: `engine.snippets` dropped a path that failed repo containment,
returned a shorter array, and told nobody.

This derives the sites where a failure is absorbed rather than propagated:
a caught error with no rethrow, a fallible operation whose error is discarded, a
default substituted for a real answer. It classifies; it does not judge. The
judgement is `docs/KNOWN_ISSUES.md`.

TWO LIMITS, stated here so the output is not read as broader than it is.

1. IT SEES ONLY OUR CODE. Both `Parser.init()` defects degraded inside a
   DEPENDENCY — `web-tree-sitter`'s global runtime — and surfaced as an
   empty-but-valid result. No scan over `packages/` and `apps/` would have found
   either. Section 4 names `web-tree-sitter` and `bun:sqlite` as the
   dependencies whose failure modes reach our results; their degradation is
   covered only by assertions on OUTPUT (`empty-is-not-success.test.ts`), never
   by a scan of this kind.

2. A CATALOGUE IS NOT A DISPOSITION. `grammar-loader.ts`'s own header documented
   the first `Parser.init()` fail-open, in the same file, and that did not
   prevent the second one in the same function. Writing a finding down is not
   closing it. Every fail-open this produces needs a fix or a test that fails
   when the guard degrades — a KNOWN_ISSUES line alone is a record of a defect,
   not a defence against it.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

ROOTS = (
    Path("packages/engine/src"),
    Path("packages/contract/src"),
    Path("apps/desktop/src"),
    Path("apps/desktop/src-tauri/src"),
)

SKIP_PARTS = ("__snapshots__", "node_modules", "target", "fixtures", "e2e")

# Each pattern names a shape in which a failure is absorbed instead of raised.
TS_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("catch with no rethrow", re.compile(r"\}\s*catch\s*(\([^)]*\))?\s*\{\s*$")),
    ("inline catch handler", re.compile(r"\.catch\s*\(")),
    ("nullish default on a call", re.compile(r"\)\s*\?\?\s*(null|\[\]|\{\}|''|\"\"|0\b)")),
    ("returns null", re.compile(r"\breturn\s+null\s*;")),
    ("returns an empty collection", re.compile(r"\breturn\s+(\[\]|\{\})\s*;")),
)

RUST_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("discards the error with .ok()", re.compile(r"\.ok\(\)")),
    ("substitutes a default", re.compile(r"\.unwrap_or(_else|_default)?\s*\(")),
    ("ignores a Result", re.compile(r"^\s*let\s+_\s*=")),
    ("handles only the Ok arm", re.compile(r"^\s*if\s+let\s+Ok\s*\(")),
    ("silently drops items", re.compile(r"\.filter_map\s*\(")),
)

# A site is EXCUSED when the same line, or the line above, says why. This is
# context, not a value allowlist: the marker travels with the code.
EXCUSE = re.compile(r"(?i)\b(deliberate|intentional|by design|documented|safe here|not a guard)\b")


def rethrows_nearby(lines: list[str], index: int, window: int = 6) -> bool:
    """Does this catch block rethrow, or convert to a domain error, right after?"""
    for line in lines[index : index + window]:
        if re.search(r"\bthrow\b|domainError\(|AppError::|return\s+Err\(", line):
            return True
    return False


def scan_file(path: Path) -> list[tuple[int, str, str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    patterns = RUST_PATTERNS if path.suffix == ".rs" else TS_PATTERNS
    findings: list[tuple[int, str, str]] = []

    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(("//", "*", "/*", "#")):
            continue
        context = " ".join(lines[max(0, index - 1) : index + 1])
        for label, pattern in patterns:
            if not pattern.search(line):
                continue
            if EXCUSE.search(context):
                continue
            if label == "catch with no rethrow" and rethrows_nearby(lines, index):
                continue
            findings.append((index + 1, label, stripped[:96]))
    return findings


def sources() -> list[Path]:
    found: list[Path] = []
    for root in ROOTS:
        base = REPO_ROOT / root
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix not in (".ts", ".tsx", ".rs"):
                continue
            if any(part in SKIP_PARTS for part in path.parts):
                continue
            if path.name.endswith((".test.ts", ".test.tsx", ".spec.ts")):
                continue
            found.append(path)
    return found


def main() -> int:
    files = sources()
    if not files:
        print("REFUSING: no sources found — the scan is broken", file=sys.stderr)
        return 1

    by_label: dict[str, int] = {}
    total = 0
    verbose = "--list" in sys.argv

    for path in files:
        rel = str(path.relative_to(REPO_ROOT)).replace("\\", "/")
        for lineno, label, snippet in scan_file(path):
            by_label[label] = by_label.get(label, 0) + 1
            total += 1
            if verbose:
                print(f"{rel}:{lineno}: [{label}] {snippet}")

    print(f"\nguards:scan — {len(files)} source file(s), {total} absorbing site(s)")
    for label in sorted(by_label, key=lambda k: -by_label[k]):
        print(f"  {by_label[label]:4d}  {label}")

    # A scan that finds nothing is broken: this codebase is known to absorb
    # failures deliberately in several places (`readFileText` returns null on an
    # unreadable file, by design).
    if total == 0:
        print("\nREFUSING: no absorbing sites found — the scan is broken", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
