"""`lossy:scan` — conversions whose FAILURE is collapsed into ABSENCE.

KI-1 was not a line, it was a pattern. `verify_citations` did:

    let line = line_group.and_then(|group| group.as_str().parse::<u64>().ok());
    if let Some(line) = line { /* the range check */ }

`.ok()` turned "there was a line number and it did not parse" into "there was no
line number". Those two facts mean opposite things to the check downstream, and
collapsing them skipped it entirely. A citation with an overflowing line was
accepted as a citation with no line.

The shape generalises: a conversion that can FAIL, mapped into a type that also
encodes ABSENT, consumed by a branch that treats absent as benign. Every such
site is a candidate for the same bug.

Reported:
  * Rust — `.parse()` / `try_into()` / `try_from()` / `from_str()` followed by
    `.ok()`, `.unwrap_or(..)`, `.unwrap_or_else(..)` or `.unwrap_or_default()`
  * TS — `Number(..)`, `parseInt`, `parseFloat`, `JSON.parse` whose result feeds
    a `??`/`||` default, or sits in a `try` whose `catch` returns a default

NOT reported: a conversion whose failure is propagated (`?`, `map_err`, a
`throw`), and a default applied to a value that was never a conversion. The
scan's purpose is the conflation, not defaults in general.

Like every scan here it over-reports by design, and `self_test` proves it fires
on the exact KI-1 line before it is trusted on anything else.
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

CONVERSION_RS = r"(?:\.parse(?:::<[^>]+>)?\s*\(\)|try_into\s*\(\)|try_from\s*\([^)]*\)|from_str\s*\([^)]*\))"
ABSORB_RS = r"(?:\.ok\(\)|\.unwrap_or(?:_else|_default)?\s*\()"
RUST_LOSSY = re.compile(CONVERSION_RS + r"\s*" + ABSORB_RS)

CONVERSION_TS = r"(?:Number\s*\(|parseInt\s*\(|parseFloat\s*\(|JSON\.parse\s*\()"
TS_LOSSY_DEFAULT = re.compile(CONVERSION_TS + r"[^;]*\)\s*(?:\?\?|\|\|)\s*")
TS_CONVERSION = re.compile(CONVERSION_TS)


def catch_returns_default(lines: list[str], index: int, window: int = 8) -> bool:
    """Is this conversion inside a `try` whose `catch` substitutes a value?"""
    for line in lines[index : index + window]:
        if re.search(r"\}\s*catch", line):
            for follow in lines[index : index + window + 4]:
                if re.search(r"\breturn\s+(null|\[\]|\{\}|0|''|\"\")\s*;", follow):
                    return True
            return False
    return False


def scan_file(path: Path) -> list[tuple[int, str, str]]:
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    findings: list[tuple[int, str, str]] = []

    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(("//", "*", "/*", "#")):
            continue

        if path.suffix == ".rs":
            if RUST_LOSSY.search(line):
                findings.append((index + 1, "conversion failure -> absent", stripped[:100]))
            continue

        if TS_LOSSY_DEFAULT.search(line):
            findings.append((index + 1, "conversion failure -> default", stripped[:100]))
        elif TS_CONVERSION.search(line) and catch_returns_default(lines, index):
            findings.append((index + 1, "conversion failure -> caught default", stripped[:100]))
    return findings


def self_test() -> str | None:
    """Fire on KI-1's exact line, and stay quiet on a propagating conversion."""
    ki1 = 'let line = line_group.and_then(|g| g.as_str().parse::<u64>().ok());'
    if not RUST_LOSSY.search(ki1):
        return "matcher missed KI-1's own line"

    for benign in (
        "let line: u64 = text.parse()?;",
        "let n = value.parse::<u64>().map_err(|e| AppError::bad(e))?;",
    ):
        if RUST_LOSSY.search(benign):
            return f"matcher flagged a propagating conversion: {benign}"

    if not TS_LOSSY_DEFAULT.search("const n = Number(raw) ?? 0;"):
        return "matcher missed a TS conversion with a default"
    if TS_LOSSY_DEFAULT.search("const n = Number(raw);"):
        return "matcher flagged a bare TS conversion"
    return None


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
    failure = self_test()
    if failure:
        print(f"REFUSING: self-test failed — {failure}", file=sys.stderr)
        return 1

    files = sources()
    if not files:
        print("REFUSING: no sources found — the scan is broken", file=sys.stderr)
        return 1

    total = 0
    for path in files:
        rel = str(path.relative_to(REPO_ROOT)).replace("\\", "/")
        for lineno, label, snippet in scan_file(path):
            print(f"{rel}:{lineno}: [{label}] {snippet}")
            total += 1

    print(f"\nlossy:scan — {len(files)} source file(s), {total} conflating site(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
