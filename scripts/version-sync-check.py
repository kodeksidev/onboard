"""`version:check-sync` — the files that carry the release version must agree.

Five files carry this project's version and nothing kept them in step, so they
drifted twice without anything going red:

  * `packages/engine` missed **v0.1.3** — it stayed 0.1.2 while the other four
    moved to 0.1.3 — then caught up at v0.1.4 by coincidence rather than by
    process.
  * `package.json` and `packages/engine` both missed **v0.1.5**, and still read
    0.1.4 at the tag.

Neither drift broke anything, which is precisely why neither was noticed. The
root manifest is `private: true` and nothing reads its version; the engine's is
not published. They are inert values that LOOK authoritative to whoever opens
them next, and the gap widens by one release every time.

WHY A CHECK RATHER THAN A SINGLE SOURCE THE OTHERS DERIVE FROM. Deriving was
the first instinct and it is the more expensive of the two here. The five files
span three toolchains with no shared substrate: Cargo cannot read JSON, and
`version.workspace = true` inherits only from a Cargo workspace root; bun has no
cross-workspace version inheritance, so three `package.json` files cannot follow
a fourth. Deriving therefore means a generator that WRITES four files — and a
generator nobody re-runs leaves exactly the stale value this file exists to
catch, so it would need a drift check of its own on top. The check is the
smaller half of the derive solution, and it is the half that actually fails.

THE AUTHORITY IS `tauri.conf.json`, and it is not a new one invented here. It is
the version the bundler stamps onto the artefacts a user downloads, and
`release_notes_table.shipped_version()` already reads it to name the
release-notes file and to check the tag against it. The release chain obeys it
already; this only says the other four must, too.

DELIBERATELY OUT OF SCOPE, so the next person does not "fix" them into the list:

  * `packages/contract/package.json` — 0.1.0 at every tag from v0.1.1 to v0.1.5.
    It has never moved with a release. That is an independently versioned
    contract, not drift.
  * `apps/desktop/src-tauri/dev-tools/Cargo.toml` — 0.1.0, `publish = false`,
    and never shipped to a user by construction.
  * `apps/desktop/src-tauri/tests/fixtures/*/Cargo.toml` — fixture crates whose
    versions are test data.

Checked against the tag history, not assumed: each of the four above sat still
across five releases while the five below moved together.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

SEMVER = re.compile(r"\d+\.\d+\.\d+")
CARGO_VERSION = re.compile(r'version\s*=\s*"([^"]+)"')

AUTHORITY = Path("apps/desktop/src-tauri/tauri.conf.json")

FOLLOWERS = (
    Path("package.json"),
    Path("apps/desktop/package.json"),
    Path("packages/engine/package.json"),
    Path("apps/desktop/src-tauri/Cargo.toml"),
)


def cargo_package_version(text: str) -> str | None:
    """The `version` under `[package]` — not the first `version =` in the file.

    A Cargo manifest is full of `version = "…"` lines belonging to dependencies.
    Matching the first one would read a dependency pin and report it as the
    crate's own version, which is a check that passes for the wrong reason.
    """
    section: str | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            section = stripped[1:-1]
            continue
        if section != "package":
            continue
        match = CARGO_VERSION.fullmatch(stripped)
        if match:
            return match.group(1)
    return None


def json_version(text: str) -> str | None:
    value = json.loads(text).get("version")
    return value if isinstance(value, str) else None


def read_version(path: Path) -> str | None:
    """The version a manifest declares, or None if it declares none usably.

    Read as `utf-8-sig`, not `utf-8`: manifests in this repository are edited on
    Windows and some carry a UTF-8 BOM. `apps/desktop/src-tauri/Cargo.toml` did
    at v0.1.3. A BOM makes the first line `﻿[package]` rather than
    `[package]`, so the section scan below never enters `[package]` and the
    crate version reads as absent; `json.loads` rejects a leading BOM outright.
    Found by running this check against the v0.1.3 tag, where it reported the
    Cargo version missing on a file that plainly declares one.
    """
    text = (REPO_ROOT / path).read_text(encoding="utf-8-sig")
    return cargo_package_version(text) if path.name == "Cargo.toml" else json_version(text)


def main() -> int:
    missing = [path for path in (AUTHORITY, *FOLLOWERS) if not (REPO_ROOT / path).is_file()]
    if missing:
        print(
            "REFUSING: these version-carrying files do not exist:\n  "
            + "\n  ".join(path.as_posix() for path in missing)
            + "\n\nA file was moved or renamed without updating this check, so the "
            "check would silently stop governing it.",
            file=sys.stderr,
        )
        return 1

    expected = read_version(AUTHORITY)
    if expected is None or not SEMVER.fullmatch(expected):
        print(
            f"REFUSING: {AUTHORITY.as_posix()} has no usable version: {expected!r}",
            file=sys.stderr,
        )
        return 1

    print(f"version:check-sync — authority {AUTHORITY.as_posix()} = {expected}")

    disagreeing: list[tuple[Path, str | None]] = []
    for path in FOLLOWERS:
        found = read_version(path)
        mark = "ok" if found == expected else "DRIFT"
        print(f"  [{mark:>5}] {path.as_posix()} = {found}")
        if found != expected:
            disagreeing.append((path, found))

    if disagreeing:
        print(
            f"\nFAILED — {len(disagreeing)} file(s) disagree with the version the "
            f"bundler stamps ({expected}):\n  "
            + "\n  ".join(
                f"{path.as_posix()} says {found!r}, expected {expected!r}"
                for path, found in disagreeing
            )
            + "\n\nNothing may break today — the root manifest is private and the engine "
            "is unpublished — but each of these reads as authoritative to whoever opens "
            "it next, and the gap widens by one release each time it is missed.",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
