#!/usr/bin/env python3
"""Assert every tree-sitter query that detects routes carries the same guards.

Why this exists
---------------
Twice now, "UNIQUE constraint failed: symbol.id" reached a user because a
guard was applied to some route queries and not others, or applied in a way
that was correct for the defect it repaired and wrong for the one it created:

  * Phase 11 added `#any-of?` and a first-argument anchor to the three TS/JS
    queries and not to `python.scm`, which kept emitting phantom routes for
    `@click.option`, `@mock.patch` and `@unittest.skipIf`.
  * The same fix required a handler argument with an UNANCHORED
    `(_) @route.handler`. An unanchored child pattern binds once per matching
    sibling, and tree-sitter emits one match per binding, so a route emitted
    `argc - 1` identical symbols. It shipped in v0.1.0.

Both are the same shape: a decision that reached some call sites and not
others. This check derives its worklist from the query files themselves, so a
fourth language's query is covered the day it is added rather than the day
somebody remembers to add it to a list.

The invariant it enforces
-------------------------
1. A route-detecting query restricts the method/verb it matches (`#any-of?`).
2. Every capture inside the route pattern's argument list is ANCHORED (`.`),
   because an unanchored capture there multiplies matches.

Run: python scripts/query-guard-parity-check.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

QUERIES_DIR = Path(__file__).resolve().parent.parent / "packages" / "engine" / "src" / "parse" / "queries"

# A query file participates in this check iff it captures anything under the
# `@route.` namespace. Derived, never hand-listed.
ROUTE_CAPTURE = re.compile(r"@route\.[a-z_]+")

# Captures that live inside the route pattern's argument list. These are the
# ones an unanchored binding would multiply. `@route.method` and
# `@route.call`/`@route.decorator` sit outside the argument list and are
# structurally single-valued, so they are not subject to the anchor rule.
ARGUMENT_LIST_CAPTURES = ("@route.path", "@route.handler")

ANY_OF_METHOD = re.compile(r"#any-of\?\s+@route\.method\b")


def route_query_files() -> list[Path]:
    return sorted(p for p in QUERIES_DIR.glob("*.scm") if ROUTE_CAPTURE.search(p.read_text(encoding="utf8")))


def strip_comments(text: str) -> str:
    """Drop `;`-comments so prose describing a guard cannot satisfy the check."""
    return "\n".join(line.split(";", 1)[0] for line in text.splitlines())


def is_predicate_reference(code: str, index: int) -> bool:
    """True iff the capture at `index` is an argument to a `(#pred? ...)` form.

    A capture appears in two distinct roles: ATTACHED to a node pattern
    (`. (string) @route.path`), where the anchor rule applies, and REFERENCED
    by a predicate (`(#match? @route.path "...")`), where it does not. Walking
    back to the nearest unclosed `(` tells the two apart.
    """
    depth = 0
    for position in range(index - 1, -1, -1):
        char = code[position]
        if char == ")":
            depth += 1
        elif char == "(":
            if depth == 0:
                return code[position + 1 : position + 2] == "#"
            depth -= 1
    return False


def is_anchored(code: str, capture: str) -> bool:
    """True iff every ATTACHED occurrence of `capture` is preceded by a `.` anchor.

    tree-sitter allows the anchor and the node on separate lines, so this
    looks back across whitespace/newlines rather than within one line.
    """
    for match in re.finditer(re.escape(capture) + r"\b", code):
        if is_predicate_reference(code, match.start()):
            continue
        # Walk back over the node pattern the capture is attached to, e.g.
        # `. (string) @route.path` or `. (_) @route.handler`.
        before = code[: match.start()]
        if re.search(r"\.\s*\([^()]*\)\s*$", before) is None:
            return False
    return True


def main() -> int:
    files = route_query_files()
    if not files:
        print("query-guard-parity: no route-carrying query files found — check the glob", file=sys.stderr)
        return 1

    failures: list[str] = []
    for path in files:
        code = strip_comments(path.read_text(encoding="utf8"))
        rel = path.relative_to(QUERIES_DIR.parent.parent.parent.parent.parent)

        if ANY_OF_METHOD.search(code) is None:
            failures.append(
                f"{rel}: route pattern does not restrict @route.method with `#any-of?`. "
                f"Without it every `obj.attr(\"string\")` call or decorator becomes a route."
            )

        for capture in ARGUMENT_LIST_CAPTURES:
            if not is_anchored(code, capture):
                failures.append(
                    f"{rel}: `{capture}` appears in the argument list without a `.` anchor. "
                    f"An unanchored capture there binds once per matching sibling, and tree-sitter "
                    f"emits one match per binding - one route call would produce several identical "
                    f"symbols, which collide on symbol.id."
                )

    print(f"query-guard-parity: checked {len(files)} route-carrying query file(s): "
          f"{', '.join(p.name for p in files)}")
    if failures:
        print("\nFAIL:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("query-guard-parity: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
