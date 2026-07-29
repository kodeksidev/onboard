"""`release:check-installed` — the installed app launches and analyses a repo.

Criterion 23's text is "Installers build and LAUNCH on all three platforms".
Until now this project could not say either half: `@tauri-apps/cli` was never a
dependency, so no installer had ever been built, and the criteria map recorded
the blocker as "needs a Mac to launch" — the wrong reason, for a criterion
nobody re-examined because it was already marked blocked.

A fresh GitHub runner IS a clean machine. This runs against one, after the
`.deb` has been installed with `apt`, and checks what an installed app can be
checked for without a display server driving it:

  1. the package installed its files where the desktop entry says they are;
  2. the ENGINE SIDECAR shipped inside the package runs, and analyses a real
     repository over the same stdio RPC the app uses.

(2) is the substantive half. A launcher that starts and immediately fails to
find its engine would pass a "did the process start" check; this asks the
installed engine to do the actual work and report symbols and edges.

NOT covered here, and named so the gap is not mistaken for coverage: driving the
window to a rendered graph. That needs the WebDriver harness, whose fixed-port
race makes it unfit as a gate (`.github/workflows/ci.yml` records the
diagnosis). Until that is fixed, criterion 23's "launch" is proven for the
engine and unproven for the UI.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

# Where the .deb puts things (from the bundle's own data tree).
INSTALLED_BINARY = Path("/usr/bin/onboard")
INSTALLED_SIDECAR = Path("/usr/bin/onboard-engine")
INSTALLED_GRAMMARS = Path("/usr/lib/Onboard/resources/grammars")
DESKTOP_ENTRY = Path("/usr/share/applications/Onboard.desktop")

RPC_TIMEOUT_SECONDS = 120


def check_layout() -> list[str]:
    problems: list[str] = []
    for path in (INSTALLED_BINARY, INSTALLED_SIDECAR, DESKTOP_ENTRY):
        if not path.exists():
            problems.append(f"{path} is missing")
    if not INSTALLED_GRAMMARS.is_dir():
        problems.append(f"{INSTALLED_GRAMMARS} is missing")
        return problems
    grammars = sorted(INSTALLED_GRAMMARS.glob("*.wasm"))
    if not grammars:
        problems.append(f"{INSTALLED_GRAMMARS} contains no .wasm grammars")
    return problems


def analyze_with_installed_engine(repo: Path) -> tuple[bool, str]:
    """Drives the INSTALLED sidecar over stdio, exactly as the app does."""
    request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "engine.analyze",
        "params": {"repoPath": str(repo), "appDataDir": "/tmp/onboard-check", "excludeGlobs": [], "isForceRefresh": True},
    }
    try:
        completed = subprocess.run(
            [str(INSTALLED_SIDECAR), "--grammars-dir", str(INSTALLED_GRAMMARS)],
            input=json.dumps(request) + "\n",
            capture_output=True,
            text=True,
            timeout=RPC_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"the installed engine did not answer within {RPC_TIMEOUT_SECONDS}s"

    for line in completed.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "error" in message:
            return False, f"the installed engine returned an error: {message['error']}"
        result = message.get("result")
        if not isinstance(result, dict):
            continue
        stats = result.get("result", {}).get("stats") or result.get("stats")
        if not isinstance(stats, dict):
            continue
        symbols = stats.get("symbolCount", 0)
        edges = stats.get("edgeCount", 0)
        # SUBSTANCE, not just a well-formed answer. An engine whose grammars did
        # not ship returns a valid AnalysisResult with nothing in it — the
        # failure mode this repository has hit twice with Parser.init().
        if symbols > 0:
            return True, f"symbols={symbols}, edges={edges}"
        return False, f"the installed engine answered but found nothing: symbols={symbols}, edges={edges}"

    return False, f"no usable response. stderr: {completed.stderr[:300]}"


def sample_repo() -> Path:
    repo = Path("/tmp/onboard-installed-check")
    (repo / "src").mkdir(parents=True, exist_ok=True)
    (repo / "package.json").write_text('{"name":"probe","dependencies":{"zod":"^4.0.0"}}\n', encoding="utf-8")
    (repo / "src" / "index.ts").write_text("import { helper } from './helper';\nexport function main(): void {\n  helper();\n}\n", encoding="utf-8")
    (repo / "src" / "helper.ts").write_text("export function helper(): number {\n  return 1;\n}\n", encoding="utf-8")
    return repo


def main() -> int:
    print("release:check-installed — against the app installed from the .deb")

    problems = check_layout()
    if problems:
        print("\nFAILED — the installed package is missing files:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    print(f"  layout OK: {INSTALLED_BINARY}, {INSTALLED_SIDECAR}, grammars, desktop entry")

    ok, detail = analyze_with_installed_engine(sample_repo())
    print(f"  installed engine: {detail}")
    if not ok:
        print(
            "\nFAILED — the installed engine could not analyse a repository.\n"
            "The package installs, and the thing it exists to do does not work.",
            file=sys.stderr,
        )
        return 1

    print("\nthe installed package launches its engine and analyses a real repository")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
