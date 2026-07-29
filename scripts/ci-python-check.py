"""`ci:check-python` — any CI job that reaches a Python gate must install Python.

`verify` shells out to `python` twice (`docs:check`, `ci:check-installs`), and
neither had ever executed in CI: `lint` failed ahead of them in the chain on
every platform, so the interpreter was an assumption nothing had tested. It is
also a wrong assumption on `macos-14`, whose runner image ships `python3` but no
bare `python`. Adding `actions/setup-python` to the two jobs that run `verify`
today fixes those two and says nothing about the third.

So the dependency is DERIVED, not declared, in both directions:

  * which package scripts need Python is read out of `package.json` and closed
    transitively — `verify` needs it because it calls `docs:check`, not because
    this file says so. Move `python` behind `test` tomorrow and the set grows by
    itself.
  * which jobs need the setup step is read out of the workflow — every job whose
    steps invoke one of those scripts, or `python` directly.

Both halves assert they matched something, and `self_test` asserts the detector
fires on a job that skips the setup step.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_DIR = REPO_ROOT / ".github" / "workflows"
PACKAGE_JSON = REPO_ROOT / "package.json"

INTERPRETER = re.compile(r"\bpython[0-9.]*\b")
BUN_RUN = re.compile(r"\bbun\s+run\b")
TOKEN = re.compile(r"[\w:@./-]+")
SETUP_PYTHON = re.compile(r"uses:\s*actions/setup-python@")
RUN_KEY = re.compile(r"^\s*-?\s*run:\s*(.*)$")

# Jobs sit at exactly one indent level under `jobs:` in a GitHub workflow.
JOB_HEADER = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")


def is_comment(line: str) -> bool:
    return line.lstrip().startswith("#")


def referenced_scripts(command: str, script_names: set[str]) -> set[str]:
    """Package scripts a `bun run` command reaches.

    Every token is considered, not just the one directly after `bun run`, so a
    chain named as an ARGUMENT is still seen — `verify:report` runs
    `run-verify-stages.ts verify`, and matching only the first token would lose
    `verify` and with it every Python gate underneath it.

    Deliberately over-approximating: a false positive costs a job an unneeded
    `setup-python` step, a false negative costs a job its interpreter at run
    time. Only the second is a failure.
    """
    if not BUN_RUN.search(command):
        return set()
    return {token for token in TOKEN.findall(command) if token in script_names}


def scripts_needing_python(scripts: dict[str, str]) -> set[str]:
    """Close the `bun run` call graph over scripts that invoke an interpreter."""
    names = set(scripts)
    needs = {name for name, body in scripts.items() if INTERPRETER.search(body)}
    changed = True
    while changed:
        changed = False
        for name, body in scripts.items():
            if name in needs:
                continue
            if referenced_scripts(body, names) & needs:
                needs.add(name)
                changed = True
    return needs


def split_jobs(text: str) -> dict[str, list[str]]:
    """Split a workflow into {job id: body lines}, by indentation."""
    jobs: dict[str, list[str]] = {}
    current: str | None = None
    in_jobs = False
    for line in text.splitlines():
        if line.startswith("jobs:"):
            in_jobs = True
            continue
        if not in_jobs:
            continue
        header = JOB_HEADER.match(line)
        if header and not is_comment(line):
            current = header.group(1)
            jobs[current] = []
        elif current is not None:
            jobs[current].append(line)
    return jobs


def command_lines(body: list[str]) -> list[str]:
    """Yield the shell text of every `run:` step, block scalars included.

    Scanning whole YAML lines instead would match `python-version:` inside the
    setup step itself, which makes every guarded job look like it reaches a
    Python gate — a detector that can only ever agree with itself. Only what
    the runner actually executes counts.
    """
    commands: list[str] = []
    block_indent: int | None = None
    for line in body:
        if block_indent is not None:
            if not line.strip():
                continue
            if len(line) - len(line.lstrip()) >= block_indent:
                if not is_comment(line):
                    commands.append(line.strip())
                continue
            block_indent = None
        if is_comment(line):
            continue
        match = RUN_KEY.match(line)
        if not match:
            continue
        rest = match.group(1).strip()
        if rest in ("|", ">", "|-", ">-", "|+", ">+"):
            block_indent = len(line) - len(line.lstrip()) + 1
        elif rest:
            commands.append(rest)
    return commands


def job_reaches_python(body: list[str], needs: set[str], names: set[str]) -> bool:
    for command in command_lines(body):
        if INTERPRETER.search(command):
            return True
        if referenced_scripts(command, names) & needs:
            return True
    return False


def job_sets_up_python(body: list[str]) -> bool:
    return any(SETUP_PYTHON.search(line) for line in body if not is_comment(line))


def self_test(needs: set[str], names: set[str]) -> str | None:
    """Prove the detector fires on a job that reaches Python without setting it up."""
    sample = next(iter(sorted(needs)))
    unguarded = f"jobs:\n  demo:\n    steps:\n      - run: bun run {sample}\n"
    jobs = split_jobs(unguarded)
    if "demo" not in jobs:
        return "job splitter did not find a job"
    if not job_reaches_python(jobs["demo"], needs, names):
        return f"detector missed `bun run {sample}`"
    if job_sets_up_python(jobs["demo"]):
        return "detector claimed a missing setup-python step exists"

    guarded = unguarded + "      - uses: actions/setup-python@v5\n"
    if not job_sets_up_python(split_jobs(guarded)["demo"]):
        return "detector missed a present setup-python step"

    # A chain named as an ARGUMENT, which is how `verify:report` reaches the
    # Python gates. Matching only the token after `bun run` loses this.
    as_argument = f"jobs:\n  demo:\n    steps:\n      - run: bun run runner.ts {sample}\n"
    if not job_reaches_python(split_jobs(as_argument)["demo"], needs, names):
        return f"detector missed `{sample}` passed as an argument"

    unrelated = "jobs:\n  demo:\n    steps:\n      - run: bun run build:sidecar\n"
    if job_reaches_python(split_jobs(unrelated)["demo"], needs, names):
        return "detector flagged a job that reaches no Python gate"

    return None


def main() -> int:
    scripts = json.loads(PACKAGE_JSON.read_text(encoding="utf-8")).get("scripts", {})
    names = set(scripts)
    needs = scripts_needing_python(scripts)

    # Derivation that finds nothing is broken, not clean: `docs:check` invokes
    # an interpreter directly and `verify` chains to it.
    if not needs:
        print(
            "REFUSING: no package script invokes an interpreter — the derivation "
            "is broken",
            file=sys.stderr,
        )
        return 1

    failure = self_test(needs, names)
    if failure:
        print(f"REFUSING: self-test failed — {failure}", file=sys.stderr)
        return 1

    workflows = sorted(WORKFLOW_DIR.glob("*.yml")) + sorted(WORKFLOW_DIR.glob("*.yaml"))
    if not workflows:
        print(f"REFUSING: no workflow files found under {WORKFLOW_DIR}", file=sys.stderr)
        return 1

    reaching = 0
    unguarded: list[str] = []
    for path in workflows:
        rel = str(path.relative_to(REPO_ROOT)).replace("\\", "/")
        for job_id, body in split_jobs(path.read_text(encoding="utf-8")).items():
            if not job_reaches_python(body, needs, names):
                continue
            reaching += 1
            if not job_sets_up_python(body):
                unguarded.append(f"{rel}: job `{job_id}`")

    print(
        f"ci:check-python — {len(needs)} package script(s) need an interpreter "
        f"({', '.join(sorted(needs))}); {reaching} CI job(s) reach one"
    )

    if reaching == 0:
        print(
            "REFUSING: no CI job reaches a Python gate — the scan is broken",
            file=sys.stderr,
        )
        return 1

    if unguarded:
        print("\nFAILED — jobs that reach Python without installing it:", file=sys.stderr)
        for item in unguarded:
            print(f"  {item}", file=sys.stderr)
        print(
            "\nThe macos-14 runner has no bare `python`. Add an "
            "actions/setup-python step to each job listed above.",
            file=sys.stderr,
        )
        return 1

    print("every job that reaches Python installs it")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
