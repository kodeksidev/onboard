"""Composes the NSIS installer artwork from `assets/onboard-icon.png`.

Run BY HAND when the mark changes. Not wired into `verify`, not run in CI, and
deliberately so: it needs Pillow, which is not a dependency of this repository,
and its output is two small files that change roughly never. The alternative —
two BMPs in the tree with no record of where they came from — is the thing this
script exists to prevent. Regenerating is:

    pip install pillow
    python scripts/make-installer-art.py

and the output is byte-identical for a given input, so a regenerated file that
differs means the mark changed.

SCOPE, because it is a decision and not a limitation to be fixed later. This
places the existing mark on a white field at the two sizes NSIS asks for. It
draws no text, no wordmark, no gradient, no illustration. Anything beyond
"the mark on a field" is design work that a designer should do, and shipping a
default we chose is better than shipping an amateur composition we did not.
See the AMENDMENT dated 2026-08-03 in `docs/DECISIONS.md`.

WHICH SURFACES THESE FEED, from `NsisConfig` in tauri-utils:

  * `sidebarImage`  -> 164x314, the welcome page and the finish page. This is
    the surface that shipped NSIS's stock `win.bmp` — the blue arrow with a
    computer in a box — through v0.1.0.
  * `headerImage`   -> 150x57, the strip on every page after the welcome one.
    Unset, NSIS draws no header image at all rather than a stock one, so this
    one was not stale; it was absent. Supplied for consistency.

White, not a brand colour: the mark is blue-on-orange-on-white and both NSIS
dialog backgrounds are white, so a coloured field would put a visible seam
around the image. The dimensions are fixed by NSIS, not chosen here.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ModuleNotFoundError:  # pragma: no cover - hand-run script
    print("this script needs Pillow: pip install pillow", file=sys.stderr)
    raise SystemExit(2)

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_MARK = REPO_ROOT / "assets" / "onboard-icon.png"
OUTPUT_DIR = REPO_ROOT / "apps" / "desktop" / "src-tauri" / "installer"

WHITE = (255, 255, 255)

# (filename, canvas width, canvas height, mark size, mark left, mark top).
# The sidebar's mark sits in the upper third because NSIS draws the welcome
# text to its right and the finish text below it.
SURFACES = (
    ("nsis-sidebar.bmp", 164, 314, 112, 26, 46),
    ("nsis-header.bmp", 150, 57, 45, 52, 6),
)


def compose(mark: Image.Image, width: int, height: int, size: int, left: int, top: int) -> Image.Image:
    canvas = Image.new("RGB", (width, height), WHITE)
    scaled = mark.resize((size, size), Image.LANCZOS)
    # The source has an alpha channel; the mark is flat colour on transparency,
    # so compositing onto white is what makes the edges clean rather than
    # fringed. Pasting without the mask would carry the black of the
    # zeroed-out RGB under transparent pixels.
    canvas.paste(scaled, (left, top), scaled if scaled.mode == "RGBA" else None)
    return canvas


def main() -> int:
    if not SOURCE_MARK.is_file():
        print(f"missing source mark: {SOURCE_MARK}", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with Image.open(SOURCE_MARK) as raw:
        mark = raw.convert("RGBA")
        for name, width, height, size, left, top in SURFACES:
            art = compose(mark, width, height, size, left, top)
            destination = OUTPUT_DIR / name
            # 24-bit BI_RGB. NSIS renders a plain BMP reliably and an alpha or
            # compressed one unpredictably, which is a defect you only see by
            # running the installer.
            art.save(destination, format="BMP")
            print(f"{destination.relative_to(REPO_ROOT)}  {width}x{height}  mark {size}px at ({left},{top})")

    print("\nrendered output is NOT verified here — an assembled installer page")
    print("can only be seen by running the installer. See docs/SMOKE_CHECKLIST.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
