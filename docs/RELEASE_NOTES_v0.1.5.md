# Onboard v0.1.5

**A bug fix release for the Dependency graph tab. If you opened that tab in
v0.1.4 and gave up on it, this is the release to try again — the panel opened
on a view nobody could read, and clicking anything in it left you stuck.**

## What broke, and who it affected

### The graph opened on a view you could not read

Opening the Dependency graph tab on a real repository showed a handful of small
grey blocks floating in a mostly empty canvas, with no labels and no visible
structure. It read as a rendering glitch. Zooming in with Ctrl+scroll revealed a
genuinely useful map — labelled files, coloured modules, directory groupings —
but nothing told you that zooming was required, so a first-time user saw the
broken-looking view and left.

Three separate defects produced that, and all three are fixed.

**The panel showed the whole repository at once.** The original rule collapsed
directories only past 600 nodes, so any repo under that opened as every file at
once, fitted to the window. That is not readable at any zoom — a node-link
diagram stops being legible well below 500 nodes — and no amount of tuning the
label or collapse thresholds changes it. The graph now **always opens on a
bounded directory view**: the deepest level of detail that still fits a
legibility budget, chosen from the size of your panel. On a 500-file repository
that is typically 6–12 boxes, each sized by how many files it contains and
tinted by the module that owns most of them. Everything deeper is one click
away — tap a directory to open it, tap again to fold it, or use **Expand all**.
Small repositories still show every file, because they fit.

**Nothing re-fitted the view after the first paint.** A fit that corrects the
zoom was accidentally made conditional on an unrelated layout step, so for any
repository whose top-level directories import each other — the normal case —
expanding, collapsing, or drilling ran a layout and then never corrected the
viewport. Fitting is now unconditional after every layout.

**The layout ignored the shape of your window.** The graph was laid out roughly
square and then fitted into a panel about twice as wide as it is tall, so the
fit was limited by height, two thirds of the width went unused, and the zoom
dropped to a point where a 13px directory label renders at 5px — drawn, and
unreadable. The layout now targets the panel's proportions, and the number of
boxes shown is capped at what your window can display legibly rather than
shrinking them until they fit.

Alongside those: the graph had **no dark-mode palette at all**, so in the app's
dark theme it drew near-black labels on dark boxes; collapsed directories were
identical grey blobs regardless of size or contents; and an animated layout
could hang without ever finishing on repositories whose top-level areas do not
import each other, leaving the view stuck mid-arrangement.

### Clicking a node left you in a state with no way out

Clicking any node dimmed everything else. If you clicked a file with no imports
in either direction — a README, a config file, or the common case of a file
whose dependencies all live inside collapsed directories — **the entire graph
dimmed and nothing lit up**: the whole view destroyed in exchange for no
information.

And there was no way back. Clicking empty canvas did nothing, because that was
never wired. Escape did nothing either: it was wired, but the graph's keyboard
handler could only receive it if you had arrived by pressing Tab, and clicking
the canvas leaves keyboard focus elsewhere entirely. The only escape anyone
found was to leave the panel and come back.

Now: clicking empty canvas clears the selection, Escape clears it (press it
again to leave the graph), and a **Clear selection** button sits in the toolbar
for the case where neither of those occurs to you. Dimmed nodes recede instead
of disappearing, so you keep your sense of where the highlighted file sits, and
nothing is dimmed at all when there is nothing to highlight.

The toolbar is now **Clear selection · Expand all · Reset view**. "Collapse all"
described what the code did; "Reset view" describes what you want. Clearing a
selection never moves the camera — restoring the view is the separate, explicit
action.

## Upgrading

Nothing to migrate. Analysis results and caches are unchanged; this release
touches only how the graph is drawn and how you interact with it.

## Still open

**"Expand all" still produces an unreadable hairball on a large repository.**
That is now a deliberate action rather than the default, which is the change
this release makes — but if you press it on a 500-file project, you will get
what the old default gave you.

Two smaller things remain: labels of low-importance files can still overlap each
other inside a densely-packed directory, and the graph does not re-fit when you
resize the window (open a different tab and come back, or press **Reset view**).

## Downloads

| file | platform |
|---|---|
| `Onboard_0.1.5_x64-setup.exe` | Windows |
| `Onboard_0.1.5_amd64.deb` | Debian / Ubuntu |
| `Onboard-0.1.5-1.x86_64.rpm` | Fedora / RHEL |

Onboard is unsigned in v1, so Windows SmartScreen and macOS Gatekeeper will
object on first launch. `docs/INSTALL.md` quotes what each dialog says and
how to proceed.

## Verification

Every fix above was verified against the built installer on a real 500-file
repository, not a development server — twice during this work a development
server reported the graph as working while the shipped application was
unreadable, so the checks were redone by driving the release binary itself.
