"""`sidecar:check-received` — the sidecars survived the artifact round trip.

The release workflow builds all four triples once on Linux and hands them to the
Windows and macOS bundle jobs as an artifact. Two things can go wrong in that
hand-off, and neither is visible at build time:

  * `actions/upload-artifact` does not preserve the executable bit, so a binary
    that ran on the builder arrives unrunnable on the consumer;
  * Tauri resolves `externalBin` by EXACT `-<target-triple>` suffix, so a name
    mangled in transit produces "sidecar not found" at bundle time, or worse a
    bundle missing its engine.

`build:sidecar` verifies format, architecture and size where the files are
PRODUCED. This verifies identity and permissions where they are CONSUMED. They
are different claims and the second has never been tested.

Expected filenames are DERIVED from `build-sidecar.ts`'s own target table, so
adding a fifth triple cannot leave this check asserting four.
"""

from __future__ import annotations

import os
import re
import stat
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BUILD_SCRIPT = REPO_ROOT / "packages" / "engine" / "scripts" / "build-sidecar.ts"
DIST = REPO_ROOT / "packages" / "engine" / "dist"

OUTFILE = re.compile(r"outfileName:\s*'([^']+)'")

# A compiled Bun sidecar is 60-100 MB; this only catches a truncated transfer.
MIN_BYTES = 10 * 1024 * 1024


def expected_names() -> list[str]:
    text = BUILD_SCRIPT.read_text(encoding="utf-8")
    return sorted(set(OUTFILE.findall(text)))


def main() -> int:
    names = expected_names()
    if len(names) < 2:
        print(
            f"REFUSING: derived {len(names)} target name(s) from build-sidecar.ts — "
            "the derivation is broken",
            file=sys.stderr,
        )
        return 1

    print(f"sidecar:check-received — {len(names)} target(s) derived from build-sidecar.ts")

    missing: list[str] = []
    problems: list[str] = []

    for name in names:
        path = DIST / name
        if not path.is_file():
            missing.append(name)
            continue

        size = path.stat().st_size
        detail = f"{size / 1024 / 1024:.1f} MB"

        if size < MIN_BYTES:
            problems.append(f"{name}: {size} bytes, below the {MIN_BYTES}-byte floor")

        # Windows has no executable bit; asserting one there would fail for a
        # reason that has nothing to do with the artifact.
        if os.name != "nt":
            mode = path.stat().st_mode
            executable = bool(mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH))
            detail += ", executable" if executable else ", NOT EXECUTABLE"
            if not executable:
                problems.append(
                    f"{name}: not executable — upload-artifact does not preserve the "
                    "executable bit; chmod +x after download"
                )

        print(f"  {name}  ({detail})")

    if missing:
        print(
            "\nFAILED — sidecars that did not arrive under their exact name:\n  "
            + "\n  ".join(missing)
            + "\n\nTauri resolves externalBin by exact `-<target-triple>` suffix. A name "
            "mangled in transit produces a bundle with no engine.",
            file=sys.stderr,
        )
        return 1

    if problems:
        print("\nFAILED — sidecars that arrived unusable:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1

    print("every sidecar arrived under its exact name, intact and runnable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
