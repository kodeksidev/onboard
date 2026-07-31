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
# ALL workflows, not just ci.yml. The release workflow now carries real
# evidence — it installs the .deb on a clean runner and drives the installed
# engine — and a map that only read ci.yml would refuse that as "no job runs
# it", which is how a criterion stays marked blocked after it stops being.
WORKFLOW_DIR = REPO_ROOT / ".github" / "workflows"
CRITERIA_HEADING = "## 13. Acceptance criteria"
JOB_HEADER = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")
RUN_KEY = re.compile(r"^\s*-?\s*run:\s*(.*)$")


# CI-BLOCKED, defined once and applied mechanically:
#
#   A criterion is CI-BLOCKED if and only if it CANNOT BE SETTLED WITHOUT A
#   MACHINE WE DO NOT HAVE.
#
# Nothing else counts. A criterion waiting on a tool nobody has configured, on a
# document nobody has written, or on an author finishing their own paragraph is
# not blocked by CI — it is unfinished, and calling it "CI-blocked" launders
# ordinary remaining work into an external constraint. That number has been
# steering this project for several turns, so it is derived under one stated
# definition rather than assembled by feel.
BLOCKERS = {
    "machine": "needs hardware or a runner this project does not have",
    "tooling": "needs a tool configured; the machines exist",
    "unwritten": "the artifact does not exist yet",
    "authoring": "waits on someone finishing prose they own",
    "none": "settled by CI",
}


@dataclass(frozen=True)
class Evidence:
    """How a criterion would be proven, and by what."""

    gate: str | None  # substring of the CI command that runs it, or None
    kind: str  # 'ci' | 'not-wired' | 'no-gate' | 'manual'
    note: str
    blocker: str = "none"
    # {repo-relative file: topics its text must name}. Existence alone is the
    # vacuity trap — a criterion naming "the exact Gatekeeper and SmartScreen
    # steps" is not met by an empty INSTALL.md. This checks the artifact exists
    # AND names what the criterion asks for. It does NOT review the prose, and
    # the status string says so.
    requires: tuple[tuple[str, tuple[str, ...]], ...] = field(default=())


# The gate strings are matched against `run:` commands in ci.yml, so a job that
# stops invoking one is detected rather than assumed.
VERIFY = "bun run verify:report"
RUST_TEST = "verify:rust"  # fmt --check + clippy -D warnings + cargo test, one command
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
    10: Evidence(None, "no-gate", "coverage thresholds are enforced nowhere", blocker="tooling"),
    11: Evidence(None, "not-wired", "wall-clock budgets need a consistent runner; a shared one cannot measure them honestly", blocker="machine"),
    12: Evidence(None, "manual", "10s cold-open needs a real desktop session and a human with a stopwatch", blocker="machine"),
    # 13/14: the CRITERION TEXT in the column to the right is parsed from the
    # frozen spec and still shows the `🔒`/`☁️` prefixes. The shipped strings no
    # longer carry them — removed 2026-07-31 by product-owner decision
    # (AMENDMENT in docs/DECISIONS.md). The tests assert the SHIPPED strings,
    # so a reader comparing this row's evidence to its criterion text will find
    # a one-prefix difference; that difference is the amendment, not a drift.
    13: Evidence(
        VERIFY,
        "ci",
        "UI tests, inside verify. DEPARTS FROM A6: the shipped string has no "
        "`🔒` prefix (2026-07-31, product owner). A padlock renders beside it "
        "as an aria-hidden SVG, deliberately outside the string so the "
        "accessible name stays byte-exact",
    ),
    14: Evidence(
        VERIFY,
        "ci",
        "UI tests, inside verify. DEPARTS FROM A6: the shipped string has no "
        "`☁️` prefix (2026-07-31, product owner). Both indicator strings "
        "changed together — one with an emoji and one without would be worse "
        "than either",
    ),
    15: Evidence(RUST_TEST, "ci", "key-never-persisted half only; the 5s flow is manual"),
    16: Evidence(RUST_TEST, "ci", "redaction corpus, in the Rust suite"),
    17: Evidence(RUST_TEST, "ci", "payload caps in Rust; the displayed counts in UI tests"),
    18: Evidence(RUST_TEST, "ci", "citation rejection, in the Rust suite"),
    19: Evidence(VERIFY, "ci", "UI copy tests, inside verify"),
    20: Evidence(VERIFY, "ci", "axe-core + keyboard tests, inside verify"),
    21: Evidence(VERIFY, "ci", "reduced-motion tests, inside verify"),
    22: Evidence(None, "not-wired", "wdio port race is tooling, but the macOS smoke half needs a Mac", blocker="machine"),
    23: Evidence(
        "installed-app-check",
        "ci",
        "TWO HALVES, verified differently. (a) Installer builds, the SHELL "
        "launches, and it resolves its engine — CI, via `installed` and "
        "`installed-windows`, which `publish` depends on (the gap that let "
        "v0.1.0 ship a .msi failing on first use). Now OBSERVED GREEN on "
        "Windows and Linux: the installed shell logged `sidecar resolved: "
        "C:\\Program Files\\Onboard\\onboard-engine.exe` and "
        "`/usr/bin/onboard-engine`, and the installed engine analysed a real "
        "repo (symbols=2, edges=1) — substance, not just a clean exit. The "
        "Linux job previously drove the ENGINE directly and never started the "
        "shell, so the resolution bug was latent there too rather than caught. "
        "(b) Installed app RENDERS A GRAPH from a picked folder — MANUAL on "
        "all three platforms, docs/SMOKE_CHECKLIST.md, because the E2E bridge "
        "is absent from a release bundle (MODE === 'e2e') and the native "
        "picker is unreachable from WebDriver. Half (b) has no run id by "
        "construction. NOW A RECORDED OBSERVATION ON WINDOWS (2026-07-31, "
        "product owner, tag -> 68c8f97): graph rendered, node click opened the "
        "file, search jumped to the hit line. Linux and macOS remain "
        "UNOBSERVED for half (b); macOS needs a Mac for both halves. That run "
        "did NOT observe SmartScreen — it used `gh release download`, which "
        "attaches no Mark-of-the-Web — so it says nothing about criterion 24",
        blocker="machine",
    ),
    24: Evidence(
        None,
        "artifact",
        "INSTALL.md names both bypass paths; SIGNING.md names the signing path",
        requires=(
            ("docs/INSTALL.md", ("Gatekeeper", "SmartScreen", "unsigned")),
            ("docs/SIGNING.md", ("notariz", "out of scope")),
        ),
    ),
    25: Evidence(
        None,
        "artifact",
        "README covers install, the privacy model and enabling AI",
        requires=(
            ("README.md", ("Install", "privacy", "AI")),
            ("docs/V2_BACKLOG.md", ("v2",)),
        ),
    ),
    26: Evidence(
        None,
        "artifact",
        "guard-disposition sweep done; every fail-open found got a fix or a failing test",
        requires=(
            ("docs/KNOWN_ISSUES.md", ("fail-open", "disposition", "severity")),
            ("docs/SECURITY_AUDIT.md", ("what was examined",)),
        ),
    ),
    27: Evidence(VERIFY, "ci", "lint + lint:check-rules-fire, inside verify; clippy in the Rust job"),
    28: Evidence(
        "commit-message-check",
        "ci",
        "CI-backed FROM THE BOUNDARY FORWARD, not unqualified: the gate checks "
        "every commit after d67b30e, where it landed, with no exceptions list. "
        "A commit-message linter cannot retroactively govern history that "
        "predates it. Pre-boundary subjects remain visible via "
        "`commit:check --all-history`, which is INFORMATIONAL and wired to "
        "nothing",
    ),
}


# ---------------------------------------------------------------------------
# OBSERVED, not derived — the one table in this file a human must edit
# ---------------------------------------------------------------------------
#
# Everything above is DERIVED from the workflow files: which job claims a
# criterion, on how many operating systems. That derivation can prove a job
# EXISTS. It cannot prove the job has ever RUN GREEN, and printing the first
# as though it were the second is the unrun-gate problem one level up — which
# is exactly how criterion 23 read "CI-backed" for weeks while its jobs had
# never executed at all.
#
# So the observation is recorded by hand, with a run id anyone can open.
# Deliberately NOT a network check: a check that queries the API would make
# this file's output depend on credentials and on GitHub's retention window,
# and would turn a stale claim into a flaky one. A hand-entered run id is an
# honest claim about what a human saw; a derived "the job exists" is what just
# went stale.
#
# When a gate changes, DELETE its row rather than editing the id. An entry
# that outlives the gate it attests to is the same failure in a new place.
# Run 30522786141 is the first CI run in which ALL THIRTEEN jobs were green,
# including criterion 28's. It superseded run 30489773361 as the recorded
# observation because that earlier run was red on 28, and citing a run that was
# partly red as evidence for the gates that happened to be green in it invites
# exactly the confusion this table exists to prevent.
CI_RUN = "run 30522786141 (2026-07-30)"
RELEASE_RUN = "run 30489773363 (2026-07-29)"

EXECUTED: dict[int, str] = {
    1: CI_RUN,
    2: CI_RUN,
    3: CI_RUN,
    4: CI_RUN,
    5: CI_RUN,
    6: CI_RUN,
    7: CI_RUN,
    8: CI_RUN,
    9: CI_RUN,
    13: CI_RUN,
    14: CI_RUN,
    15: CI_RUN,
    16: CI_RUN,
    17: CI_RUN,
    18: CI_RUN,
    19: CI_RUN,
    20: CI_RUN,
    21: CI_RUN,
    # Half (a) only — installer builds, shell launches, engine resolves and
    # analyses, on Windows and Linux. Half (b), the rendered graph, is the
    # manual checklist and has no run id by construction.
    23: f"{RELEASE_RUN}, half (a) on Windows + Linux; half (b) Windows only (manual, 2026-07-31)",
    27: CI_RUN,
    # 28 was ABSENT while its gate was wired and RED. It is now green and
    # observed: the gate was scoped to commits after it landed (a linter cannot
    # retroactively govern history that predates it), and the one violating
    # commit that POSTDATED the boundary had its subject shortened. The two
    # remaining non-conforming subjects predate the boundary and are out of
    # scope by principle, not by exception — `commit:check --all-history` still
    # reports them, informationally.
    28: f"{CI_RUN}, from boundary d67b30e forward",
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
    jobs: dict[str, tuple[list[str], int]] = {}
    for path in sorted(WORKFLOW_DIR.glob("*.yml")) + sorted(WORKFLOW_DIR.glob("*.yaml")):
        jobs.update(parse_one_workflow(path))
    return jobs


def parse_one_workflow(path: Path) -> dict[str, tuple[list[str], int]]:
    text = path.read_text(encoding="utf-8")
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


def missing_requirements(evidence: Evidence) -> list[str]:
    """Files that do not exist, plus files that exist without naming their topic."""
    problems: list[str] = []
    for name, topics in evidence.requires:
        path = REPO_ROOT / name
        if not path.exists():
            problems.append(f"{name} (absent)")
            continue
        text = path.read_text(encoding="utf-8").lower()
        absent = [topic for topic in topics if topic.lower() not in text]
        if absent:
            problems.append(f"{name} (does not mention {', '.join(absent)})")
    return problems


def classify(number: int, evidence: Evidence, jobs: dict[str, tuple[list[str], int]]) -> str:
    missing = missing_requirements(evidence)
    if missing:
        return f"NOT MET — {'; '.join(missing)}"
    if evidence.kind == "ci":
        assert evidence.gate is not None
        count = platforms_running(evidence.gate, jobs)
        if not count:
            return "DECLARED CI BUT NO JOB RUNS IT"
        # WIRED is derived from the workflows; EXECUTED is observed by a
        # human and carries a run id. A gate that is wired but has never been
        # seen green reads exactly like one that passes, so the two are never
        # collapsed into a single word here.
        seen = EXECUTED.get(number)
        if seen:
            return f"EXECUTED on {count} OS — {seen}"
        return f"WIRED on {count} OS — never observed green"
    if evidence.kind == "not-wired":
        return "CI-BLOCKED — gate exists, not wired"
    if evidence.kind == "manual":
        return "MANUAL"
    if evidence.kind == "artifact":
        return "ARTIFACT CHECKED (exists + names its topics; prose not reviewed)"
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

    unknown = sorted(n for n, e in EVIDENCE.items() if e.blocker not in BLOCKERS)
    if unknown:
        print(f"REFUSING: unknown blocker category on criteria {unknown}", file=sys.stderr)
        return 1

    lying = [n for n, s in statuses.items() if s.startswith("DECLARED CI")]
    if lying:
        print(
            f"REFUSING: evidence claims CI coverage no job provides: {lying}",
            file=sys.stderr,
        )
        return 1

    ci_backed = [n for n, s in statuses.items() if s.startswith(("EXECUTED on", "WIRED on"))]
    three_os = [n for n, s in statuses.items() if "on 3 OS" in s]
    executed = sorted(n for n, s in statuses.items() if s.startswith("EXECUTED on"))
    wired_only = sorted(n for n, s in statuses.items() if s.startswith("WIRED on"))
    not_ci = [n for n, s in statuses.items() if not s.startswith(("EXECUTED on", "WIRED on"))]

    by_blocker: dict[str, list[int]] = {}
    for number in not_ci:
        by_blocker.setdefault(EVIDENCE[number].blocker, []).append(number)
    ci_blocked = sorted(by_blocker.get("machine", []))

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
        f"- **{len(executed)}** have been OBSERVED GREEN, with a run id: {executed}.",
        (
            f"- **{len(wired_only)}** are WIRED but never observed green: {wired_only}."
            if wired_only
            else "- **0** are wired-but-unobserved."
        ),
        f"- **{len(not_ci)}** are not evidenced by CI, of which:",
        "",
        "## CI-blocked, strictly",
        "",
        "> **CI-BLOCKED means: cannot be settled without a machine we do not have.**",
        "> Nothing else counts. A criterion waiting on an unconfigured tool, an",
        "> unwritten document, or an unfinished paragraph is not blocked — it is",
        "> unfinished, and calling it blocked launders remaining work into an",
        "> external constraint.",
        "",
        f"**CI-BLOCKED: {len(ci_blocked)}** — {', '.join(f'#{n}' for n in ci_blocked) or 'none'}",
        "",
        "The rest, under their real cause:",
        "",
    ]
    for blocker in sorted(k for k in by_blocker if k != "machine"):
        numbers = ", ".join(f"#{n}" for n in sorted(by_blocker[blocker]))
        lines.append(f"- **{blocker}** ({BLOCKERS[blocker]}) — {numbers}")
    lines += [
        "",
        "| # | Status | Blocker | Evidence | Criterion |",
        "|---|---|---|---|---|",
    ]
    for number in sorted(criteria):
        text = criteria[number]
        short = text if len(text) <= 80 else text[:77].rstrip() + "..."
        blocker = EVIDENCE[number].blocker
        lines.append(
            f"| {number} | {statuses[number]} | {'—' if blocker == 'none' else blocker} "
            f"| {EVIDENCE[number].note} | {short} |"
        )

    lines += [
        "",
        "## What 'CI on N OS' means",
        "",
        "A job in `ci.yml` invokes the gate, and its matrix names N operating systems.",
        "It does NOT mean the job is currently passing — that is what the run itself",
        "says. It means the evidence is reachable without a human.",
        "",
        "**WIRED vs EXECUTED.** This file DERIVES which job claims a criterion, from",
        "the workflow files. Derivation can prove a job exists; it cannot prove the job",
        "has ever run green, and treating the first as the second is how criterion 23",
        "read CI-backed for weeks while its jobs had never executed at all. So a status",
        "says EXECUTED only when a human recorded a run id (the `EXECUTED` table in",
        "`scripts/criteria-map.py`), and WIRED otherwise. A wired-but-unobserved gate",
        "reads exactly like a passing one, which is the failure this distinction exists",
        "to make visible.",
        "",
        "Criterion 28 is neither: its gate is wired and has RUN, and FAILED, on two",
        "pre-existing commits. Wired-and-red is recorded as no-gate-passed, not as",
        "executed.",
        "",
        "**What the OS count means.** It is the largest matrix among the jobs invoking",
        "the gate — not the number of distinct platforms covered. Where a criterion is",
        "covered by SEVERAL single-OS jobs it therefore UNDERSTATES coverage: criterion",
        "23 reads `1 OS` while `installed` (Linux) and `installed-windows` both ran it.",
        "Stated rather than silently corrected, because a figure whose derivation is not",
        "described is the kind that gets quoted as something it is not.",
        "",
    ]

    rendered = "\n".join(lines)
    target = REPO_ROOT / "docs" / "CRITERIA_MAP.md"

    print(f"criteria:map — {len(criteria)} criteria parsed, {len(jobs)} CI jobs parsed")
    print(f"  CI-backed:        {len(ci_backed)}")
    print(f"  of those, 3 OS:   {len(three_os)}")
    print(f"  NOT CI-evidenced: {len(not_ci)}  -> {not_ci}")
    print(f"  CI-BLOCKED (strict, machine-only): {len(ci_blocked)}  -> {ci_blocked}")
    for blocker in sorted(k for k in by_blocker if k != "machine"):
        print(f"    not blocked, {blocker}: {sorted(by_blocker[blocker])}")

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
