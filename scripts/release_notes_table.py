"""The Downloads table in `docs/RELEASE_NOTES_v<version>.md`, parsed once.

Imported rather than reimplemented, because TWO checks read this table and they
assert different things about it:

  * `release-notes-check.py` — the table's EXTENSIONS equal the set
    `release-formats.json` says a release publishes. Static, needs no artefacts,
    so it runs on every release-workflow run including a dry one.
  * `release-assets-check.py` — the table's FILENAMES equal the filenames
    actually staged for the release. Exact, and only possible where the real
    artefacts exist.

Neither subsumes the other. The first catches a row for a format that is no
longer built; the second catches a row whose extension is right and whose name
is wrong — a download link to a file that does not exist, which is the same
broken experience arrived at differently.

WHY THIS FILE EXISTS AT ALL. `release-formats.json` drives the bundle matrix,
the upload glob and the asset check, and it does NOT drive this markdown table.
So the table was a fourth place deciding what a release contains, kept in step
by memory. It fell out of step the moment the `.msi` was dropped: the table
listed four downloads and the release staged three. Caught by review rather
than by a gate, which is precisely how the `.rpm` upload gap survived — the
matrix asked for it, the glob never sent it, and the difference was invisible
because nothing compared the two lists.

Underscored filename so it can be imported; every other script here is invoked,
not imported, and is hyphenated to match its package-script name.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TAURI_CONF = REPO_ROOT / "apps" / "desktop" / "src-tauri" / "tauri.conf.json"

DOWNLOADS_HEADING = "## Downloads"

# A table row's first cell, backtick-quoted: | `Onboard_0.1.0_x64-setup.exe` | Windows |
ROW = re.compile(r"^\|\s*`([^`]+)`\s*\|")


class TableError(RuntimeError):
    """The table could not be read. Never returns an empty list instead.

    A parser that answers "no filenames" when it means "I could not find the
    table" makes both callers assert nothing while both report success. That
    vacuity is the failure mode these checks exist to prevent, so it is raised
    rather than returned.
    """


def shipped_version() -> str:
    """The version the bundler stamps onto the artefacts."""
    config = json.loads(TAURI_CONF.read_text(encoding="utf-8"))
    version = config.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise TableError(f"tauri.conf.json has no usable version: {version!r}")
    return version


def notes_path() -> Path:
    return REPO_ROOT / "docs" / f"RELEASE_NOTES_v{shipped_version()}.md"


def download_filenames(notes: Path | None = None) -> list[str]:
    """Every filename in the Downloads table, in the order it appears.

    Raises TableError if the heading is absent, or if the section under it has
    no rows — both meaning "the table is not where it is expected", which must
    fail loudly rather than pass as an empty set.
    """
    path = notes or notes_path()
    if not path.is_file():
        raise TableError(f"{path.name} does not exist")

    text = path.read_text(encoding="utf-8")
    if DOWNLOADS_HEADING not in text:
        raise TableError(f"{path.name} has no {DOWNLOADS_HEADING!r} heading")

    section = text.split(DOWNLOADS_HEADING, 1)[1]
    # Stop at the next heading of any level, so a later section's inline code
    # cannot be mistaken for a download row.
    section = re.split(r"^#{1,6} ", section, maxsplit=1, flags=re.MULTILINE)[0]

    names = [match.group(1).strip() for line in section.splitlines() if (match := ROW.match(line))]
    if not names:
        raise TableError(
            f"{path.name}'s {DOWNLOADS_HEADING!r} section has no rows of the form "
            "`| `filename` | platform |`. Either the table moved or its format changed; "
            "an empty parse would make the download checks assert nothing."
        )
    return names
