"""`release:check-assets` — refuse to publish an artefact nobody has run.

macOS is held from the first release because no macOS build has ever been
executed on a Mac. That decision lives in three documents and one `publish:
false` line in a workflow matrix, and none of those stop a `.dmg` from reaching
the release if a glob is widened, an artifact name is copied, or a future job
downloads one directory too many.

So the decision is enforced where it takes effect: immediately before the
release is created, over the files actually staged.

The rule is by EXTENSION, not by filename, because a `.dmg` renamed is still a
macOS disk image and the point is what the file is. Held extensions and shipped
extensions are both listed, and an asset matching NEITHER also fails — a new
bundle format should be an explicit decision rather than something that ships
because nobody wrote it down.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Not published until docs/MACOS_SMOKE.md is signed off on real hardware.
HELD_SUFFIXES = {".dmg", ".app", ".pkg"}

# Windows and Linux, the two platforms whose artefacts have been executed by CI.
SHIPPED_SUFFIXES = {".msi", ".exe", ".appimage", ".deb", ".rpm"}


def classify(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in HELD_SUFFIXES:
        return "held"
    if suffix in SHIPPED_SUFFIXES:
        return "shipped"
    return "unknown"


def self_test() -> str | None:
    """Prove the classifier separates the three cases before it is trusted."""
    cases = {
        "Onboard_0.1.0_aarch64.dmg": "held",
        "Onboard.app": "held",
        "Onboard_0.1.0_x64-setup.exe": "shipped",
        "onboard_0.1.0_amd64.AppImage": "shipped",
        "onboard_0.1.0_amd64.deb": "shipped",
        "notes.txt": "unknown",
    }
    for name, expected in cases.items():
        actual = classify(Path(name))
        if actual != expected:
            return f"{name} classified as {actual}, expected {expected}"
    return None


def main() -> int:
    failure = self_test()
    if failure:
        print(f"REFUSING: self-test failed — {failure}", file=sys.stderr)
        return 1

    if len(sys.argv) < 2:
        print("REFUSING: no asset directory given", file=sys.stderr)
        return 1

    root = Path(sys.argv[1])
    if not root.is_dir():
        print(f"REFUSING: {root} is not a directory", file=sys.stderr)
        return 1

    assets = sorted(p for p in root.rglob("*") if p.is_file())
    held = [p for p in assets if classify(p) == "held"]
    shipped = [p for p in assets if classify(p) == "shipped"]
    unknown = [p for p in assets if classify(p) == "unknown"]

    print(f"release:check-assets — {len(assets)} staged asset(s)")
    for path in assets:
        print(f"  [{classify(path):7s}] {path.relative_to(root)}")

    # An empty staging directory would pass every check below while publishing
    # a release with nothing in it.
    if not shipped:
        print(
            "\nREFUSING: no Windows or Linux installer staged — the release would be empty",
            file=sys.stderr,
        )
        return 1

    if held:
        print(
            "\nFAILED — macOS artefacts staged for publication:\n  "
            + "\n  ".join(str(p.relative_to(root)) for p in held)
            + "\n\nNo macOS build has been executed on a Mac. Publishing one ships an "
            "assumption. Release it after docs/MACOS_SMOKE.md is signed off, not before.",
            file=sys.stderr,
        )
        return 1

    if unknown:
        print(
            "\nFAILED — assets of an unrecognised kind:\n  "
            + "\n  ".join(str(p.relative_to(root)) for p in unknown)
            + "\n\nAdd the extension to SHIPPED_SUFFIXES or HELD_SUFFIXES. A new bundle "
            "format should ship because someone decided to, not because nobody listed it.",
            file=sys.stderr,
        )
        return 1

    print("\nevery staged asset is a platform this project has run")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
