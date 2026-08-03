# Installing Onboard

**Onboard v1 ships unsigned.** That is a deliberate scope decision (A3 / Section
3 non-goal 3), not an oversight, and it has a concrete consequence: both Windows
and macOS will actively try to stop you running it, with wording that suggests
the file is dangerous rather than merely unsigned.

This document is the exact click path through each. If a step below does not
match what you see, **stop** — a mismatch is worth more suspicion than an
unsigned binary, because these dialogs are also what real malware has to get you
past.

Before any of it: check the download's checksum against the release page. An
unsigned build gives you no other way to tell that the bytes you have are the
bytes that were published.

```bash
# macOS / Linux
shasum -a 256 Onboard_0.1.0_aarch64.dmg

# Windows PowerShell
Get-FileHash .\Onboard_0.1.0_x64-setup.exe -Algorithm SHA256
```

---

## Windows — SmartScreen

Artefact: `Onboard_0.1.0_x64-setup.exe`. One file, deliberately.

Until 2026-08-03 there was also an `.msi`. It did the same job and asked you to
choose between two files whose difference you could not see, so it was dropped —
see the amendment in [DECISIONS.md](DECISIONS.md). The one that stayed is the one
that **installs without administrator rights**: Onboard installs per-user into
`%LOCALAPPDATA%\Onboard` and raises no UAC prompt, which matters if you are on a
work machine you do not administer. The `.msi` installed to `Program Files` and
required elevation.

Because the installer is unsigned and has no reputation history, Microsoft
Defender SmartScreen blocks it on first run.

1. Double-click the installer. A blue box appears, headed
   **"Windows protected your PC"**, reading:

   > Microsoft Defender SmartScreen prevented an unrecognized app from starting.
   > Running this app might put your PC at risk.

   Two controls are offered: **More info** and **Don't run**. **Don't run** is
   the focused default, so pressing Enter or Space dismisses the installer.
2. Click **More info**. This is the step most people miss; the link is plain
   text under the message, not a button.
3. The publisher line will read **Unknown publisher**. That is expected for an
   unsigned build — it is exactly what A3 means in practice.
4. Click **Run anyway**.

> **Steps 3 and 4 have not been observed against this build** — they are
> recorded as UNOBSERVED (windows-smartscreen-stage-2) in
> `observed-dialogs.json`. The wording is what Windows shows for an unsigned
> executable generally, not something anyone has seen here. Step 1 **has** been
> observed, and its strings are quoted verbatim from that record. If you are the
> first person past step 2, the second screen's exact wording is worth reporting.

If **Run anyway** is absent, SmartScreen is in "Block" rather than "Warn" mode,
which is set by policy — usually a managed work machine. Do not try to disable
SmartScreen globally to get around it. Ask whoever administers the machine, or
build from source (see the README).

Some browsers also quarantine the download itself. If the file is flagged before
you can run it, choose **Keep** in the browser's download list.

### Removing it

Settings → Apps → Installed apps → **Onboard** → Uninstall, or run
`%LOCALAPPDATA%\Onboard\uninstall.exe` directly. Because the install is per-user,
the entry appears only for the account that installed it.

Onboard leaves data in **two** places, and uninstalling removes neither:

- `%APPDATA%\dev.onboard.app\onboard\cache\` — the analysis cache (a SQLite
  database per repository you opened).
- `%LOCALAPPDATA%\dev.onboard.app\` — logs, and the WebView2 profile.

Delete both to remove everything. Any API key you stored is in **Windows
Credential Manager**, under the service `dev.onboard.app`, and is likewise not
removed by uninstalling — delete it there if you want it gone.

---

## macOS — NOT PUBLISHED IN THE FIRST RELEASE

**There is no macOS download.** The build produces `.dmg` artefacts and CI
verifies their format and architecture from the header bytes, but **no macOS
build has ever been executed on a Mac.** This project has no Apple hardware, and
a runner that can *produce* a darwin binary cannot *run* one.

Shipping it anyway would be publishing an assumption: the engine sidecar inside
that `.dmg` has never started on the platform it targets. macOS is released when
`MACOS_SMOKE.md` is signed off on real hardware, and not before.

The steps below are correct and are kept here for whoever performs that
verification — they are not instructions for a download that exists yet.

Artefacts (when published): `Onboard_0.1.0_aarch64.dmg` (Apple Silicon) or
`Onboard_0.1.0_x64.dmg` (Intel). Take the one matching your machine — Apple menu
→ About This Mac shows which.

The build is neither signed nor notarized, so Gatekeeper refuses it. On recent
macOS the message is **"Onboard is damaged and can't be opened. You should move
it to the Bin."** That wording is misleading: the app is not damaged. macOS says
this when a quarantined app has no valid signature.

> That wording, and every macOS step below it, is general knowledge of
> Gatekeeper rather than something anyone has seen here — recorded as
> UNOBSERVED (macos-gatekeeper-damaged) in `observed-dialogs.json`. Nothing on
> this half of the page is evidence until `MACOS_SMOKE.md` is signed off on real
> hardware, which is the same reason there is no macOS download.

1. Open the `.dmg` and drag **Onboard** to your Applications folder.
2. Open **System Settings → Privacy & Security**.
3. Try to launch Onboard once, from Applications. It will be refused.
4. Return to **Privacy & Security** and scroll to the Security section. A line
   now reads *"Onboard was blocked from use because it is not from an identified
   developer."* Click **Open Anyway**.
5. Authenticate, then confirm **Open** in the dialog that follows.

macOS remembers the decision; subsequent launches are normal.

If step 4 shows no such line — common when the "damaged" message appeared — the
quarantine attribute needs removing explicitly:

```bash
xattr -d com.apple.quarantine /Applications/Onboard.app
```

**Understand what that command does before running it.** It strips the flag
macOS uses to mark files that came from the internet, for that one path. Run it
only against a path you typed yourself, after checking the checksum. Never run
it recursively over a directory, and never against a file you did not
deliberately download.

The right-click → **Open** trick from older macOS versions no longer works on
recent releases for unsigned apps. It is listed here only so you know it is not
worth trying.

### Removing it

Drag `/Applications/Onboard.app` to the Bin. Onboard's cache and settings live
under `~/Library/Application Support/onboard/`; delete that directory to remove
them too.

---

## Linux

Artefacts: `Onboard_0.1.0_amd64.deb` or `Onboard-0.1.0-1.x86_64.rpm`.

**There is no `.AppImage` in the first release.** Tauri builds it through
`linuxdeploy`, which fails on our CI runners even with FUSE available; `.deb`
and `.rpm` build cleanly in the same run. Shipping a format that has never been
produced is what the macOS hold exists to prevent, and the same rule applies
here. See `KNOWN_ISSUES.md` KI-9.

Linux has no equivalent gatekeeper, so there is nothing to bypass.

```bash
# Debian / Ubuntu
sudo dpkg -i Onboard_0.1.0_amd64.deb
sudo apt-get install -f     # only if dependencies are missing

# Fedora / RHEL
sudo rpm -i Onboard-0.1.0-1.x86_64.rpm
```

Onboard needs a Secret Service provider (GNOME Keyring, KWallet) to store an AI
API key at rest. Without one it will offer a **session-only in-memory key**
instead, which is discarded when the app closes — Onboard will not write a
plaintext key to `~/.config` to save you a step (A18). Static mode needs no
keychain at all.

### Removing it

Run `sudo apt-get remove onboard` or `sudo rpm -e Onboard`. Cache and settings live
under `~/.local/share/onboard/` and `~/.config/onboard/`.

---

## What is not on this page

**Anything that turns a protection off globally.** Every step above is scoped to
this one application. If a future version of this document tells you to disable
SmartScreen, run `spctl --master-disable`, or add a blanket antivirus exclusion,
treat that as a defect in the document.

**Signing.** v1 does not sign, notarize or staple anything, and there is no
auto-update — auto-update would require signing. The intended path out of this
page entirely is [SIGNING.md](SIGNING.md).
