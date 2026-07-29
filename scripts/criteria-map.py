"""`criteria:map` — derive acceptance-criteria status from evidence, not memory.

This is the ship-decision instrument, so nothing in it is hand-tallied. Three
inputs are joined:

  1. The 28 criteria, PARSED out of the build spec's Section 13. Retyping them
     is how a map starts describing a spec that has since changed.
  2. An evidence table below: criterion -> the gate that would prove it. This is
     the judgement, and it is deliberately the only judgement — reviewable in
     one place instead of spread through prose.
  3. What CI actually runs, PARSED out of `.github/workflows/ci.yml`: which jobs
     invoke which gate, and on how many operating systems.

Status and every count are computed from that join. A criterion cannot be marked
proven-in-CI unless a job is found that runs its gate.

Four refusals keep the map from drifting away from either end:
  * a parsed criterion with no evidence entry
  * an evidence entry naming a criterion the spec does not have
  * a gate declared to run in CI that no job invokes
  * a criterion whose required artifact does not exist on disk
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
CRITERIA_HEADING = "## 13. Acceptance criteria"
JOB_HEADER = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")
RUN_KEY = re.compile(r"^\s*-?\s*run:\s*(.*)$")


@dataclass(frozen=True)
class Evidence:
    """How a criterion would be proven, and by what."""

    gate: str | None  # substring of the CI command that runs it, or None
    kind: str  # 'ci' | 'not-wired' | 'no-gate' | 'manual'
    note: str
    requires: tuple[str, ...] = field(default=())  # repo-relative files that must exist


# The gate strings are matched against `run:` commands in ci.yml, so a job that
# stops invoking one is detected rather than assumed.
VERIFY = "bun run verify:report"
RUST_TEST = "cargo test"
DETERMINISM = "verify:determinism"
NO_NETWORK = "verify:no-network"

EVIDENCE: dict[int, Evidence] = {
    1: Evidence(VERIFY, "ci", "verify matrix + the space-in-path job"),
    2: Evidence(VERIFY, "ci", "contract:check-drift, inside verify"),
    3: Evidence(DETERMINISM, "ci", "engine determinism gate"),
    4: Evidence(VERIFY, "ci", "engine tests, inside verify"),
    5: Evidence(VERIFY, "ci", "engine tests, inside verify"),
    6: Evidence(VERIFY, "ci", "snapshot tests, inside verify"),
    7: Evidence(VERIFY, "ci", "kitchen-sink snapshot assertions, inside verify"),
    8: Evidence(NO_NETWORK, "ci", "Linux-only by construction: unshare -rn"),
    9: Evidence(RUST_TEST, "ci", "Rust suite"),
    10: Evidence(None, "no-gate", "coverage thresholds are not enforced anywhere"),
    11: Evidence(None, "not-wired", "bench: wall-clock budgets, deliberately off shared runners"),
    12: Evidence(None, "manual", "10s cold-open on a fresh 1,000-file repo, with UI"),
    13: Evidence(VERIFY, "ci", "UI tests, inside verify"),
    14: Evidence(VERIFY, "ci", "UI tests, inside verify"),
    15: Evidence(RUST_TEST, "ci", "key-never-persisted half only; the 5s flow is manual"),
    16: Evidence(RUST_TEST, "ci", "redaction corpus, in the Rust suite"),
    17: Evidence(RUST_TEST, "ci", "payload caps in Rust; the displayed counts in UI tests"),
    18: Evidence(RUST_TEST, "ci", "citation rejection, in the Rust suite"),
    19: Evidence(VERIFY, "ci", "UI copy tests, inside verify"),
    20: Evidence(VERIFY, "ci", "axe-core + keyboard tests, inside verify"),
    21: Evidence(VERIFY, "ci", "reduced-motion tests, inside verify"),
    22: Evidence(None, "not-wired", "e2e: wdio fixed-port race makes it unfit as a per-push gate"),
    23: Evidence(None, "not-wired", "installers: no release job yet; see the darwin cross-compile entry"),
    24: Evidence(None, "no-gate", "docs", requires=("docs/INSTALL.md", "docs/SIGNING.md")),
    25: Evidence(None, "no-gate", "docs", requires=("README.md", "docs/V2_BACKLOG.md")),
    26: Evidence(None, "manual", "audit is PARTIAL by its own §6 until a fail-open-aware re-audit"),
    27: Evidence(VERIFY, "ci", "lint + lint:check-rules-fire, inside verify; clippy in the Rust job"),
    28: Evidence(None, "no-gate", "conventional-commit linting is not wired"),
}


def parse_criteria() -> dict[int, str]:
    """The numbered list under the spec's Section 13 heading."""
    specs = sorted((REPO_ROOT / "prompts").glob("*.md"))
    for path in specs:
        text = path.read_text(encoding="utf-8")
        if CRITERIA_HEADING not in text:
            continue
        section = text.split(CRITERIA_HEADING, 1)[1].split("\n## ", 1)[0]
        found: dict[int, str] = {}
        for line in section.splitlines():
            match = re.match(r"^(\d+)\.\s+(.*)$", line.strip())
            if match:
                found[int(match.group(1))] = match.group(2)
        return found
    return {}


def parse_jobs() -> dict[str, tuple[list[str], int]]:
    """{job id: (commands it runs, number of operating systems it runs on)}."""
    text = WORKFLOW.read_text(encoding="utf-8")
    jobs: dict[str, tuple[list[str], int]] = {}
    current: str | None = None
    commands: list[str] = []
    os_count = 1

    def flush() -> None:
        if current is not None:
            jobs[current] = (commands.copy(), os_count)

    in_jobs = False
    for line in text.splitlines():
        if line.startswith("jobs:"):
            in_jobs = True
            continue
        if not in_jobs:
            continue
        header = JOB_HEADER.match(line)
        if header and not line.lstrip().startswith("#"):
            flush()
            current, commands, os_count = header.group(1), [], 1
            continue
        if current is None or line.lstrip().startswith("#"):
            continue
        matrix = re.match(r"^\s*os:\s*\[(.*)\]\s*$", line)
        if matrix:
            os_count = len([p for p in matrix.group(1).split(",") if p.strip()])
        run = RUN_KEY.match(line)
        if run and run.group(1).strip():
            commands.append(run.group(1).strip())
    flush()
    return jobs


def platforms_running(gate: str, jobs: dict[str, tuple[list[str], int]]) -> int:
    """Largest OS count among jobs invoking this gate; 0 if no job does."""
    return max(
        (count for _, (commands, count) in jobs.items() if any(gate in c for c in commands)),
        default=0,
    )


def classify(number: int, evidence: Evidence, jobs: dict[str, tuple[list[str], int]]) -> str:
    missing = [f for f in evidence.requires if not (REPO_ROOT / f).exists()]
    if missing:
        return f"NOT MET — missing {', '.join(missing)}"
    if evidence.kind == "ci":
        assert evidence.gate is not None
        count = platforms_running(evidence.gate, jobs)
        return f"CI on {count} OS" if count else "DECLARED CI BUT NO JOB RUNS IT"
    if evidence.kind == "not-wired":
        return "CI-BLOCKED — gate exists, not wired"
    if evidence.kind == "manual":
        return "MANUAL"
    return "NO GATE"


def main() -> int:
    criteria = parse_criteria()
    jobs = parse_jobs()

    if not criteria:
        print("REFUSING: no criteria parsed from the spec — the scan is broken", file=sys.stderr)
        return 1
    if not jobs:
        print("REFUSING: no jobs parsed from ci.yml — the scan is broken", file=sys.stderr)
        return 1

    unmapped = sorted(set(criteria) - set(EVIDENCE))
    phantom = sorted(set(EVIDENCE) - set(criteria))
    if unmapped or phantom:
        if unmapped:
            print(f"REFUSING: criteria with no evidence entry: {unmapped}", file=sys.stderr)
        if phantom:
            print(f"REFUSING: evidence for criteria the spec lacks: {phantom}", file=sys.stderr)
        return 1

    statuses = {n: classify(n, EVIDENCE[n], jobs) for n in sorted(criteria)}

    lying = [n for n, s in statuses.items() if s.startswith("DECLARED CI")]
    if lying:
        print(
            f"REFUSING: evidence claims CI coverage no job provides: {lying}",
            file=sys.stderr,
        )
        return 1

    ci_backed = [n for n, s in statuses.items() if s.startswith("CI on")]
    three_os = [n for n, s in statuses.items() if s == "CI on 3 OS"]
    not_ci = [n for n, s in statuses.items() if not s.startswith("CI on")]

    lines = [
        "# Acceptance-criteria map",
        "",
        "GENERATED by `scripts/criteria-map.py` (`bun run criteria:map`). Do not edit:",
        "the criteria are parsed from the build spec, the CI coverage is parsed from",
        "`.github/workflows/ci.yml`, and every count below is computed. Change the",
        "evidence table in the script, not this file.",
        "",
        f"- **{len(ci_backed)} of {len(criteria)}** criteria are backed by a CI job.",
        f"- **{len(three_os)}** of those run on all three operating systems.",
        f"- **{len(not_ci)}** are NOT evidenced by CI today: {', '.join(map(str, not_ci))}",
        "",
        "| # | Status | Evidence | Criterion |",
        "|---|---|---|---|",
    ]
    for number in sorted(criteria):
        text = criteria[number]
        short = text if len(text) <= 90 else text[:87].rstrip() + "..."
        lines.append(f"| {number} | {statuses[number]} | {EVIDENCE[number].note} | {short} |")

    lines += [
        "",
        "## What 'CI on N OS' means",
        "",
        "A job in `ci.yml` invokes the gate, and its matrix names N operating systems.",
        "It does NOT mean the job is currently passing — that is what the run itself",
        "says. It means the evidence is reachable without a human.",
        "",
    ]

    rendered = "\n".join(lines)
    target = REPO_ROOT / "docs" / "CRITERIA_MAP.md"

    print(f"criteria:map — {len(criteria)} criteria parsed, {len(jobs)} CI jobs parsed")
    print(f"  CI-backed:        {len(ci_backed)}")
    print(f"  of those, 3 OS:   {len(three_os)}")
    print(f"  NOT CI-evidenced: {len(not_ci)}  -> {not_ci}")

    # `--check` is the mode `verify` runs: a generated document that nothing
    # regenerates is a document that quietly stops describing the repository.
    # Same shape as `contract:check-drift`.
    if "--check" in sys.argv:
        current = target.read_text(encoding="utf-8") if target.exists() else ""
        if current != rendered:
            print(
                "\nFAILED — docs/CRITERIA_MAP.md is stale. Run `bun run criteria:map` "
                "and commit the result.",
                file=sys.stderr,
            )
            return 1
        print("docs/CRITERIA_MAP.md is up to date")
        return 0

    target.write_text(rendered, encoding="utf-8", newline="\n")
    print("wrote docs/CRITERIA_MAP.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
