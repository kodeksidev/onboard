"""`release:check-installed` — the INSTALLED app starts, resolves its engine, and analyses.

Criterion 23's text is "Installers build and LAUNCH on all three platforms".

This runs on a fresh GitHub runner — a genuinely clean machine, with no
repository checkout on the PATH, no bun, no cargo, no `node_modules` — after
the platform's installer has been applied the way a user would apply it. It
makes three claims, in increasing strength:

  1. **Layout.** The package installed the files it must ship. The STRENGTH OF
     THIS CLAIM DIFFERS PER PLATFORM, and the difference is the whole of what
     this paragraph exists to say, because an earlier version of it claimed
     "set equality on both platforms" and that claim was quoted into a status
     decision it did not support:

       - **Windows:** set equality, but scoped to `*.exe` in the install root.
         Non-executables — icons, resources, DLLs — are outside it entirely.
       - **Linux:** NOT set equality. A two-name banned-list scan over
         `dpkg -L`. It fails on `onboard_engine_stub` or
         `check_egress_chokepoint` by name and on nothing else.

     Where it does apply, set equality is what catches files that should NOT be
     there: the v0.1.0 packages shipped `onboard_engine_stub` — a
     fixture-replaying fake engine — beside the real one, and a presence-only
     check is blind to that by construction. It would also have reported the
     sidecar's ACTUAL installed location on day one, which is the single fact
     that would have prevented the resolution bug below.

     Real set equality on both platforms is QUEUED, not done — see the work
     item in `docs/SESSION_HANDOFF.md` and the INVALIDATES entry in
     `docs/DECISIONS.md`. Deliberately not strengthened in the same change that
     corrected this text: changing a release gate's strength while cutting a
     release produces a red nobody can interpret.

  2. **The shell starts and resolves its engine.** The v0.1.0 Windows `.msi`
     installed, launched, and then failed on the first user action with
     `os error 3`, because the shell looked for its sidecar in a `binaries/`
     subdirectory that a packaged app does not have. Nothing caught it: every
     developer machine resolved through a dev fallback, and the Linux job below
     drove the ENGINE DIRECTLY and never started the shell at all. So this
     starts the real shell and asserts its log says it resolved the sidecar.

  3. **The engine does the work.** The installed sidecar analyses a real
     repository over the same stdio RPC the app uses, and must report symbols
     and edges. An engine whose grammars did not ship returns a structurally
     valid, entirely empty result — a failure mode this repository has hit
     twice.

NOT covered, named so the gap is not mistaken for coverage: driving the
installed window to a RENDERED GRAPH. The E2E bridge (`window.__onboardE2E`)
is gated on `import.meta.env.MODE === 'e2e'` (`src/main.tsx`), so a release
bundle does not have it, and the native folder picker is unreachable from
WebDriver. Claim (2) targets the actual defect — sidecar resolution in a
packaged layout — but it is not the same as proving the UI renders.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

RPC_TIMEOUT_SECONDS = 120
SHELL_STARTUP_TIMEOUT_SECONDS = 60
SHELL_POLL_SECONDS = 1.0

# The log line `lib.rs` writes when it resolves the sidecar, and the one it
# writes when it cannot. Both are asserted: the success line must appear, and
# the failure line must not.
RESOLVED_MARKER = "sidecar resolved:"
FAILED_MARKER = "sidecar resolution failed:"


class Layout:
    """Where a platform's installer puts things, and what must be there."""

    def __init__(
        self,
        *,
        root: Path,
        shell: Path,
        sidecar: Path,
        grammars: Path,
        log_roots: tuple[Path, ...],
        required_executables: set[str],
        optional_executables: set[str] = frozenset(),
        extra_required: tuple[Path, ...] = (),
    ) -> None:
        self.root = root
        self.shell = shell
        self.sidecar = sidecar
        self.grammars = grammars
        self.log_roots = log_roots
        self.required_executables = required_executables
        # Present in SOME bundles and absent in others, so neither required
        # nor unexpected. `uninstall.exe` is the case this exists for: NSIS
        # writes one, and an .msi does not — Windows Installer owns uninstall
        # itself. Demanding it failed the first real .msi run, because the
        # expected set had been derived from an NSIS install inspected by
        # hand. Set equality is still enforced against every other `*.exe`, so
        # a stray test binary is still caught.
        self.optional_executables = optional_executables
        self.extra_required = extra_required


def windows_layout() -> Layout:
    # WiX (.msi) installs per-machine under Program Files; NSIS installs
    # per-user under LOCALAPPDATA. Accept whichever is present so the same
    # check serves both bundles.
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Onboard",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Onboard",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Onboard",
    ]
    root = next((c for c in candidates if c.is_dir()), candidates[0])
    local_app_data = Path(os.environ.get("LOCALAPPDATA", ""))
    return Layout(
        root=root,
        shell=root / "onboard.exe",
        sidecar=root / "onboard-engine.exe",
        grammars=root / "resources" / "grammars",
        log_roots=(
            local_app_data / "dev.onboard.app" / "logs",
            Path(os.environ.get("APPDATA", "")) / "dev.onboard.app" / "logs",
        ),
        # Tauri strips the -<target-triple> suffix from an externalBin and
        # places it NEXT TO the shell — not in a `binaries/` subdirectory.
        # Confirmed against the real .msi's own file table (`msiexec /a`):
        #   PFiles\Onboard\onboard.exe
        #   PFiles\Onboard\onboard-engine.exe
        #   PFiles\Onboard\resources\grammars\*.wasm
        # That is the whole content of the resolution bug, asserted rather
        # than assumed.
        required_executables={"onboard.exe", "onboard-engine.exe"},
        optional_executables={"uninstall.exe"},
    )


def linux_layout() -> Layout:
    return Layout(
        root=Path("/usr/bin"),
        shell=Path("/usr/bin/onboard"),
        sidecar=Path("/usr/bin/onboard-engine"),
        grammars=Path("/usr/lib/Onboard/resources/grammars"),
        # Tauri's `app_log_dir()` is $XDG_DATA_HOME/<identifier>/logs on
        # Linux — NOT ~/.config, which this check assumed on its first real
        # run and consequently reported "the shell did not resolve its
        # engine" when the truth was "I could not find the log". All
        # plausible roots are searched, and not finding one is reported as
        # an inability to verify rather than as a product failure.
        log_roots=(
            Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
            / "dev.onboard.app"
            / "logs",
            Path.home() / ".config" / "dev.onboard.app" / "logs",
        ),
        # /usr/bin is shared with the whole system, so a set-equality sweep of
        # it would be meaningless. The shipped-file assertion for the .deb is
        # done from the package manifest instead — but only as a banned-name
        # scan, NOT set equality (see check_deb_banned_binaries).
        required_executables=set(),
        extra_required=(Path("/usr/share/applications/Onboard.desktop"),),
    )


def check_required_paths(layout: Layout) -> list[str]:
    problems: list[str] = []
    for path in (layout.shell, layout.sidecar, *layout.extra_required):
        if not path.exists():
            problems.append(f"{path} is missing")
    if not layout.grammars.is_dir():
        problems.append(f"{layout.grammars} is missing")
    else:
        if not sorted(layout.grammars.glob("*.wasm")):
            problems.append(f"{layout.grammars} contains no .wasm grammars")
    return problems


def check_shipped_exe_set_equality(layout: Layout) -> list[str]:
    """SET EQUALITY over the shipped `*.exe` FILES ONLY — not the whole layout.

    The scope is in the name because the unqualified name plus an unqualified
    docstring is what let this be reported as "the installed layout is asserted
    by set equality". It is not. It globs `*.exe` in the install root, so the
    set it compares excludes every non-executable the package installs — icons,
    `resources/grammars/*.wasm`, WebView DLLs. A wrong or extra icon passes here
    silently, and that is a scope limit, not an oversight to be read past.

    Within that scope the assertion is real: an unexpected executable is as much
    a defect as a missing one. Test binaries (`onboard_engine_stub`,
    `check_egress_chokepoint`) have no business in a user's install — a fake
    engine sitting beside the real one in a user-writable directory is a
    substitution target on a product whose whole thesis is that nothing leaves
    the machine.
    """
    if not layout.required_executables:
        return []
    actual = {p.name for p in layout.root.glob("*.exe")}
    missing = layout.required_executables - actual
    unexpected = actual - layout.required_executables - layout.optional_executables
    problems: list[str] = []
    if missing:
        problems.append(f"missing from the install: {sorted(missing)}")
    if unexpected:
        problems.append(f"UNEXPECTED executables shipped to users: {sorted(unexpected)}")
    return problems


def check_deb_banned_binaries() -> list[str]:
    """Scans `dpkg -L` for TWO BANNED NAMES. This is NOT set equality.

    Named for what it does, after the previous name (`check_deb_manifest`) and
    the previous docstring ("Set equality over what the .deb declares it
    installs") described an assertion this function has never made. The body
    below is the whole of it: iterate the file list, flag a path whose basename
    is in `banned`. There is no expected set, so nothing is compared against
    one, so an unexpected file that is not one of those two names — a stray
    binary, a wrong icon, a leftover fixture — passes.

    The gap matters more here than on Windows: the .deb ships into shared
    system directories (`/usr/bin`, `/usr/share/icons/hicolor/...`), so its
    file list is exactly where a set-equality sweep would pay off.

    Strengthening this is QUEUED — see `docs/SESSION_HANDOFF.md`. Until then
    the honest reading of a green Linux job is "neither banned test binary
    shipped", not "the shipped file list is correct".
    """
    try:
        completed = subprocess.run(
            ["dpkg", "-L", "onboard"], capture_output=True, text=True, timeout=60, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return [f"could not read the .deb file list: {error}"]
    if completed.returncode != 0:
        return [f"dpkg -L onboard failed: {completed.stderr.strip()[:200]}"]

    shipped = {line.strip() for line in completed.stdout.splitlines() if line.strip()}
    banned = {"onboard_engine_stub", "check_egress_chokepoint"}
    problems = [
        f"UNEXPECTED test binary shipped to users: {path}"
        for path in sorted(shipped)
        if Path(path).name in banned
    ]
    return problems


def find_logs(layout: Layout) -> list[Path]:
    """Every `onboard.log` under any plausible log root.

    Searched rather than assumed. `lib.rs` writes to
    `app_log_dir()/onboard/onboard.log`, and `app_log_dir()` differs per
    platform in ways this script got wrong on its first real run — it
    guessed `~/.config` on Linux, found nothing, and reported that as the
    shell failing to resolve its engine. That is a wrong finding, which is
    worse than a missing one.
    """
    found: list[Path] = []
    for root in layout.log_roots:
        if root.is_dir():
            found.extend(sorted(root.rglob("onboard.log")))
    return found


def start_shell_and_read_log(layout: Layout) -> tuple[bool, str]:
    """Starts the real app shell and waits for its sidecar-resolution line.

    Deliberately starts the SHELL, not the engine. The Linux job previously
    drove the engine directly, which is why it never exercised the shell's
    sidecar resolution and the packaging bug stayed latent there too.
    """
    for stale in find_logs(layout):
        try:
            stale.unlink()
        except OSError:
            pass

    env = dict(os.environ)
    if platform.system() != "Windows":
        # A GitHub Linux runner has no display; without this the window cannot
        # be created and the process exits before it ever reaches sidecar
        # resolution — which would look like a resolution failure.
        env.setdefault("DISPLAY", ":99")
        env.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")

    try:
        process = subprocess.Popen(
            [str(layout.shell)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
    except OSError as error:
        return False, f"the installed shell could not be started at all: {error}"

    deadline = time.monotonic() + SHELL_STARTUP_TIMEOUT_SECONDS
    verdict: tuple[bool, str] | None = None
    try:
        while time.monotonic() < deadline:
            for log in find_logs(layout):
                text = log.read_text(encoding="utf-8", errors="replace")
                if FAILED_MARKER in text:
                    line = next(l for l in text.splitlines() if FAILED_MARKER in l)
                    verdict = (False, f"the shell started but could NOT resolve its engine: {line.strip()}")
                    break
                if RESOLVED_MARKER in text:
                    line = next(l for l in text.splitlines() if RESOLVED_MARKER in l)
                    verdict = (True, f"{line.strip()}  [{log}]")
                    break
            if verdict is not None:
                break
            if process.poll() is not None:
                stderr = (process.stderr.read() or b"").decode("utf-8", "replace")
                verdict = (
                    False,
                    f"the shell exited early (code {process.returncode}) without resolving. stderr: {stderr[:300]}",
                )
                break
            time.sleep(SHELL_POLL_SECONDS)
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()

    if verdict is None:
        # CANNOT ANSWER, not "found a problem". The shell stayed alive for
        # the whole window and no log turned up in any known root, so this
        # says so in those words rather than blaming the resolver.
        searched = ", ".join(str(r) for r in layout.log_roots)
        return False, (
            f"INCONCLUSIVE — the shell ran for {SHELL_STARTUP_TIMEOUT_SECONDS}s and stayed "
            f"alive, but no onboard.log appeared under any known log root ({searched}). "
            "This is an inability to verify, NOT evidence that resolution failed; "
            "the log location is what needs fixing."
        )
    return verdict


def analyze_with_installed_engine(layout: Layout, repo: Path, app_data: Path) -> tuple[bool, str]:
    """Drives the INSTALLED sidecar over stdio, exactly as the app does."""
    request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "engine.analyze",
        "params": {
            "repoPath": str(repo),
            "appDataDir": str(app_data),
            "excludeGlobs": [],
            "isForceRefresh": True,
        },
    }
    try:
        completed = subprocess.run(
            [str(layout.sidecar), "--grammars-dir", str(layout.grammars)],
            input=json.dumps(request) + "\n",
            capture_output=True,
            text=True,
            timeout=RPC_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"the installed engine did not answer within {RPC_TIMEOUT_SECONDS}s"

    for raw in completed.stdout.splitlines():
        line = raw.strip()
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
        if symbols > 0:
            return True, f"symbols={symbols}, edges={edges}"
        return False, f"the installed engine answered but found nothing: symbols={symbols}, edges={edges}"

    return False, f"no usable response. stderr: {completed.stderr[:300]}"


def sample_repo(base: Path) -> Path:
    repo = base / "onboard-installed-check"
    (repo / "src").mkdir(parents=True, exist_ok=True)
    (repo / "package.json").write_text('{"name":"probe","dependencies":{"zod":"^4.0.0"}}\n', encoding="utf-8")
    (repo / "src" / "index.ts").write_text(
        "import { helper } from './helper';\nexport function main(): void {\n  helper();\n}\n",
        encoding="utf-8",
    )
    (repo / "src" / "helper.ts").write_text(
        "export function helper(): number {\n  return 1;\n}\n", encoding="utf-8"
    )
    return repo


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-shell",
        action="store_true",
        help="skip the shell-launch claim (for environments with no session at all)",
    )
    args = parser.parse_args()

    is_windows = platform.system() == "Windows"
    layout = windows_layout() if is_windows else linux_layout()
    print(f"release:check-installed — against the app installed from the {'.msi' if is_windows else '.deb'}")
    print(f"  install root: {layout.root}")

    problems = check_required_paths(layout)
    problems += check_shipped_exe_set_equality(layout) if is_windows else check_deb_banned_binaries()
    if problems:
        print("\nFAILED — the installed package's layout is wrong:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    # The strength is printed, not just the verdict. "layout OK (set equality)"
    # was printed on BOTH platforms and was true on neither in the way it read.
    scope = "set equality over *.exe" if is_windows else "banned-name scan only, NOT set equality"
    print(f"  layout OK [{scope}]: {layout.shell.name}, {layout.sidecar.name}, grammars")

    if args.skip_shell:
        print("  shell launch: SKIPPED by flag")
    else:
        ok, detail = start_shell_and_read_log(layout)
        print(f"  installed shell: {detail}")
        if not ok:
            if detail.startswith("INCONCLUSIVE"):
                print(
                    "\nCOULD NOT VERIFY — the shell started but its log was not found.\n"
                    "Distinguished from a failure deliberately: this says nothing about\n"
                    "whether the engine resolved. Fix the log discovery, not the resolver.",
                    file=sys.stderr,
                )
            else:
                print(
                    "\nFAILED — the installed shell did not resolve its engine.\n"
                    "This is the exact failure the v0.1.0 .msi shipped with.",
                    file=sys.stderr,
                )
            return 1

    base = Path(os.environ.get("RUNNER_TEMP") or os.environ.get("TEMP") or "/tmp")
    app_data = base / "onboard-check-data"
    app_data.mkdir(parents=True, exist_ok=True)
    ok, detail = analyze_with_installed_engine(layout, sample_repo(base), app_data)
    print(f"  installed engine: {detail}")
    if not ok:
        print(
            "\nFAILED — the installed engine could not analyse a repository.\n"
            "The package installs, and the thing it exists to do does not work.",
            file=sys.stderr,
        )
        return 1

    print("\nthe installed package starts, resolves its engine, and analyses a real repository")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
