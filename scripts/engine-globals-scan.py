"""`engine:scan-globals` — enumerate module-scoped mutable state in the engine.

The concurrency defect was a `let` at module scope memoizing a call that touched
process-global state. Finding the next one by reading is not a method; this
derives the candidates.

Reported, per file:
  * top-level `let` / `var` declarations — mutable bindings shared by every
    caller in the process;
  * top-level `const` bound to a MUTABLE CONTAINER (`new Map`, `new Set`,
    array or object literal) — `const` freezes the binding, not the contents,
    so a module-level `const cache = new Map()` is shared mutable state.

Only bindings actually MUTATED after declaration are reported. A lookup table
nobody writes to is configuration, and burying three real findings under
seventeen of those is how a scan gets ignored.

This is a CANDIDATE list, not a verdict. Each entry still needs a judgement
about whether the state is legitimately process-wide (a runtime initialization
genuinely is) or accidentally shared. What it removes is the possibility of
missing one — which is why `self_test` runs first.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENGINE_SRC = REPO_ROOT / "packages" / "engine" / "src"

# Top level means column zero: anything indented is inside a function or class.
TOP_LEVEL_LET = re.compile(r"^(let|var)\s+([A-Za-z_$][\w$]*)")
TOP_LEVEL_CONST = re.compile(r"^const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(.*)$")
MUTABLE_CONTAINER = re.compile(r"^(new\s+(Map|Set|WeakMap|WeakSet|Array)\b|\[|\{)")


def is_written(name: str, text: str, declaration_line: int) -> bool:
    """Does anything MUTATE this binding after it is declared?"""
    word = r"(?<![\w$])" + re.escape(name) + r"(?![\w$])"
    mutations = [
        re.compile(r"^\s*" + word + r"\s*(?:\??\.\w+)?\s*=[^=]"),  # reassignment
        re.compile(word + r"\s*(?:\?\.)?\.(set|add|push|delete|clear|pop|splice|sort)\("),
        re.compile(word + r"\s*(?:\?\.)?\[[^\]]*\]\s*="),  # index write
        re.compile(word + r"\s*\?\?="),  # memoizing assignment
    ]
    for lineno, line in enumerate(text.splitlines(), start=1):
        if lineno == declaration_line:
            continue
        if any(pattern.search(line) for pattern in mutations):
            return True
    return False


def self_test() -> str | None:
    """Prove the matcher fires on each mutation shape it claims to cover.

    Written because it did not. A generated patch put a literal backspace where
    a word boundary was intended, so three of the four patterns could never
    match anything — and this scan reported ONE global instead of THREE while
    exiting 0. A scan that silently under-reports is the exact defect this
    project keeps removing, and it is undetectable without a case whose answer
    is known in advance.
    """
    positives = {
        "memoizing assignment": ("p", "let p = null;\n  p ??= build();\n"),
        "reassignment": ("p", "let p = null;\n  p = build();\n"),
        "container write": ("c", "const c = new Map();\n  c.set('k', 1);\n"),
        "index write": ("c", "const c = [];\n  c[0] = 1;\n"),
        "push": ("c", "const c = [];\n  c.push(1);\n"),
    }
    for label, (name, text) in positives.items():
        if not is_written(name, text, 1):
            return f"matcher missed a {label}"

    if is_written("p", "let p = null;\n  return p;\n", 1):
        return "matcher reported a read-only binding as mutated"
    if is_written("p", "let p = null;\n  prefixed = 1;\n", 1):
        return "matcher matched a substring of another identifier"
    return None


def scan(path: Path) -> list[tuple[int, str, str]]:
    text = path.read_text(encoding="utf-8")
    findings: list[tuple[int, str, str]] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.rstrip()
        binding = TOP_LEVEL_LET.match(stripped)
        name, kind = None, ""
        if binding:
            name, kind = binding.group(2), f"module-level `{binding.group(1)}`"
        else:
            constant = TOP_LEVEL_CONST.match(stripped)
            if constant and MUTABLE_CONTAINER.match(constant.group(2).strip()):
                name, kind = constant.group(1), "module-level mutable container"
        if name is None or not is_written(name, text, lineno):
            continue
        findings.append((lineno, name, kind))
    return findings


# Every mutated module-level global in the engine, with the reason it is
# allowed to be one. A global NOT listed here fails the check: process-wide
# mutable state is how the `Parser.init()` concurrency defect happened, so a new
# one must be an explicit decision rather than a diff nobody read.
#
# An entry that matches nothing ALSO fails — a stale justification for state
# that has moved is indistinguishable from a live one.
EXPECTED: dict[str, str] = {
    "packages/engine/src/analyze.ts:analysisInFlight": (
        "the re-entrancy guard itself; being process-wide is its entire function"
    ),
    "packages/engine/src/guard/no-network.ts:installPromise": (
        "installed once at module evaluation via top-level await, so ES module "
        "ordering serializes it; write-only (it poisons functions) and no "
        "AnalysisResult depends on its timing"
    ),
    "packages/engine/src/parse/grammar-loader.ts:globalInitPromise": (
        "Parser.init() initializes a process-global WASM runtime, so this memo "
        "MUST be process-global — it was per-loader, and that was the defect"
    ),
}


def main() -> int:
    failure = self_test()
    if failure:
        print(f"REFUSING: self-test failed — {failure}", file=sys.stderr)
        return 1

    if not ENGINE_SRC.is_dir():
        print(f"REFUSING: {ENGINE_SRC} does not exist — the scan is broken", file=sys.stderr)
        return 1

    files = sorted(ENGINE_SRC.rglob("*.ts"))
    if not files:
        print("REFUSING: no engine sources found — the scan is broken", file=sys.stderr)
        return 1

    found: dict[str, str] = {}
    for path in files:
        rel = str(path.relative_to(REPO_ROOT)).replace("\\", "/")
        for lineno, name, kind in scan(path):
            found[f"{rel}:{name}"] = f"{rel}:{lineno} ({kind})"

    print(f"engine:scan-globals — {len(files)} file(s) scanned, {len(found)} mutated global(s)")
    for key in sorted(found):
        print(f"  {found[key]}  {key.rsplit(':', 1)[1]}")

    # Zero is not clean here: the re-entrancy guard is one, by construction.
    if not found:
        print("\nREFUSING: no mutated globals found — the scan is broken", file=sys.stderr)
        return 1

    unexpected = sorted(set(found) - set(EXPECTED))
    inert = sorted(set(EXPECTED) - set(found))

    if unexpected:
        print(
            "\nFAILED — module-level mutable state with no recorded justification:\n  "
            + "\n  ".join(unexpected)
            + "\n\nProcess-wide mutable state is how the Parser.init() concurrency defect "
            "happened. Add it to EXPECTED with the reason it must be global, or scope it "
            "to a call.",
            file=sys.stderr,
        )
        return 1

    if inert:
        print(
            "\nFAILED — justifications for globals that no longer exist:\n  "
            + "\n  ".join(inert)
            + "\n\nA stale justification is indistinguishable from a live one. Delete it.",
            file=sys.stderr,
        )
        return 1

    print("\nevery mutated global is one this repository has decided to have")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
