"""`release:plan` — emit the bundle matrix and upload globs from ONE table.

`release-formats.json` is the single source of what ships. This turns it into
the two shapes the workflow needs, so neither is written by hand:

  * `matrix`      — the `bundle` job's `strategy.matrix.include`, with each
                    platform's `--bundles` argument and upload glob attached;
  * `expected`    — the extensions a published release must contain, used by
                    `release-assets-check.py`.

Run with `--github` inside a workflow to write them to `$GITHUB_OUTPUT`.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FORMATS = REPO_ROOT / "release-formats.json"
BUNDLE_DIR = "apps/desktop/src-tauri/target/release/bundle"


def load() -> list[dict[str, object]]:
    data = json.loads(FORMATS.read_text(encoding="utf-8"))
    platforms = data.get("platforms", [])
    if not isinstance(platforms, list) or not platforms:
        raise SystemExit("REFUSING: release-formats.json declares no platforms")
    return platforms


def upload_glob(extensions: list[str]) -> str:
    """One `**/*.<ext>` line per extension, which is what upload-artifact wants."""
    return "\n".join(f"{BUNDLE_DIR}/**/*{ext}" for ext in extensions)


def build_matrix(platforms: list[dict[str, object]]) -> list[dict[str, object]]:
    matrix: list[dict[str, object]] = []
    for entry in platforms:
        extensions = list(entry["extensions"])  # type: ignore[arg-type]
        matrix.append(
            {
                "os": entry["os"],
                "publish": entry["publish"],
                "bundles": ",".join(entry["bundles"]),  # type: ignore[arg-type]
                "uploadGlob": upload_glob(extensions),
            }
        )
    return matrix


def expected_extensions(platforms: list[dict[str, object]]) -> list[str]:
    """Extensions a PUBLISHED release must contain, one per artefact."""
    found: list[str] = []
    for entry in platforms:
        if entry["publish"]:
            found.extend(entry["extensions"])  # type: ignore[arg-type]
    return sorted(found)


def main() -> int:
    platforms = load()
    matrix = build_matrix(platforms)
    expected = expected_extensions(platforms)

    if not expected:
        print("REFUSING: no platform is marked publish — a release would be empty", file=sys.stderr)
        return 1

    print(f"release:plan — {len(matrix)} platform(s), {len(expected)} published artefact(s)")
    for entry in matrix:
        marker = "publish" if entry["publish"] else "HELD   "
        print(f"  [{marker}] {entry['os']}: --bundles {entry['bundles']}")
    print(f"  expected on a release: {', '.join(expected)}")

    if "--github" in sys.argv:
        output = os.environ.get("GITHUB_OUTPUT")
        if not output:
            print("REFUSING: --github given but GITHUB_OUTPUT is unset", file=sys.stderr)
            return 1
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"matrix={json.dumps(matrix)}\n")
            handle.write(f"expected={json.dumps(expected)}\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
