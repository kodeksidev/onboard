"""`docs:check-dialogs` — the dialog strings INSTALL.md quotes must match the record.

`docs/INSTALL.md` walks a user past OS security dialogs, and its second
paragraph tells that user to **stop** if a step does not match what they see.
That turns every quoted string in it into an assertion with a consequence: a
misquote trains a reader to abort at a correct screen, which is worse than no
quote at all. One had already drifted — the doc quoted SmartScreen saying
`unrecognised` where Windows says `unrecognized`, dropped the sentence
`Running this app might put your PC at risk.`, and never named `Don't run`,
the control a frightened reader is most likely to press because it holds focus.

None of that was catchable, because the strings were prose. So they live in
`observed-dialogs.json` and this compares the two.

WHAT IS ACTUALLY ASSERTED, named precisely because the obvious reading is
wrong and this file is the kind that gets quoted:

  * Every string of an OBSERVED dialog appears VERBATIM in the document that
    dialog names. That is a consistency check between a doc and a dated human
    observation. It is NOT a check against Windows or macOS — there is no
    machine-readable source for what those dialogs say, and this script has
    never seen one.
  * An UNOBSERVED dialog declares no strings. This is the half that matters:
    it makes it impossible to write plausible-sounding wording into the record
    and have the doc inherit authority from it. A dialog nobody has seen has
    nothing to quote.
  * A document that names an unobserved dialog must SAY it is unobserved.
    Without this, INSTALL.md's second-stage SmartScreen steps read exactly like
    its first-stage steps, and only one of them is evidence.

The authority is entirely in `observedBy` and `observedOn`. This script only
stops the prose drifting away from them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RECORD = REPO_ROOT / "observed-dialogs.json"

# A document naming an unobserved dialog must carry this marker, so that a
# reader can tell a recorded observation from a plausible reconstruction
# without opening the JSON.
#
# The dialog's ID is IN the marker, and that is not decoration. The first
# version of this check looked for the bare word "UNOBSERVED" anywhere in the
# file, and both unobserved dialogs point at INSTALL.md — so a single marker
# written for the SmartScreen one silently satisfied the macOS one too. A
# check that passes because of a sentence about something else is the failure
# mode this whole file exists to catch, found in the file that catches it.
def unobserved_marker(identifier: str) -> str:
    return f"UNOBSERVED ({identifier})"


def load_dialogs() -> list[dict[str, object]]:
    data = json.loads(RECORD.read_text(encoding="utf-8"))
    dialogs = data.get("dialogs")
    if not isinstance(dialogs, list) or not dialogs:
        raise SystemExit(f"{RECORD.name} declares no dialogs")
    return dialogs


def self_test(dialogs: list[dict[str, object]]) -> list[str]:
    """The record must describe a real situation before anything is checked against it.

    Written after `release-formats.json` taught the lesson: a table that drives
    a gate needs its own sanity check, or an empty table silently disables the
    gate it feeds and every run goes green.
    """
    problems: list[str] = []
    if not any(d.get("observed") for d in dialogs):
        problems.append(
            "no dialog is marked observed — this check would assert nothing at all"
        )
    for dialog in dialogs:
        identifier = dialog.get("id", "<unnamed>")
        observed = dialog.get("observed")
        strings = dialog.get("strings") or []
        if observed and not strings:
            problems.append(f"{identifier}: marked observed but quotes no strings")
        if not observed and strings:
            problems.append(
                f"{identifier}: marked UNOBSERVED but carries {len(strings)} string(s). "
                "A dialog nobody has seen has nothing to quote — either someone saw it "
                "and the entry should say who and when, or the strings are invented."
            )
        if observed and not (dialog.get("observedBy") and dialog.get("observedOn")):
            problems.append(f"{identifier}: observed without naming observedBy and observedOn")
    return problems


def check_dialog(dialog: dict[str, object]) -> list[str]:
    identifier = str(dialog.get("id", "<unnamed>"))
    relative = str(dialog.get("documentedIn", ""))
    document = REPO_ROOT / relative
    if not document.is_file():
        return [f"{identifier}: documentedIn points at a missing file: {relative}"]

    text = document.read_text(encoding="utf-8")
    problems: list[str] = []

    if not dialog.get("observed"):
        marker = unobserved_marker(identifier)
        if marker not in text:
            problems.append(
                f"{identifier}: {relative} describes an UNOBSERVED dialog but never says so. "
                f"It must contain {marker!r} — naming the dialog, not just the word, because "
                "several unobserved dialogs share this document and a bare marker written for "
                "one of them would satisfy all of them."
            )
        return problems

    for quoted in dialog.get("strings") or []:
        if str(quoted) not in text:
            problems.append(
                f"{identifier}: {relative} does not contain, verbatim:\n      {quoted!r}"
            )
    return problems


def main() -> int:
    dialogs = load_dialogs()

    problems = self_test(dialogs)
    for dialog in dialogs:
        problems += check_dialog(dialog)

    if problems:
        print("docs:check-dialogs FAILED\n  " + "\n  ".join(problems), file=sys.stderr)
        print(
            "\nA quoted dialog string is an assertion: docs/INSTALL.md tells the reader\n"
            "to stop if a step does not match, so a misquote aborts a correct install.",
            file=sys.stderr,
        )
        return 1

    observed = [d for d in dialogs if d.get("observed")]
    pending = [d for d in dialogs if not d.get("observed")]
    quoted = sum(len(d.get("strings") or []) for d in observed)
    print(f"docs:check-dialogs — {quoted} string(s) across {len(observed)} observed dialog(s) match")
    for dialog in observed:
        print(f"  observed  {dialog['id']}  ({dialog['observedBy']}, {dialog['observedOn']})")
    for dialog in pending:
        print(f"  PENDING   {dialog['id']}  — nobody has seen this; {dialog['documentedIn']} says so")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
