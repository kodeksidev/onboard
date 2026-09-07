# Code signing — the path, deliberately not taken in v1

**Signing, notarization, stapling, auto-update and app-store submission are out
of scope for v1.** That is A3 and Section 3's third non-goal, and it is a scope
boundary rather than a defect: *"Do not build any of the following. If you find
yourself writing one, stop and delete it."*

This document exists so the decision is reversible by someone who was not in the
room — what it would cost, what it would change, and what it would NOT change.

## Why it is out of scope

Signing is not a code problem. It is a **procurement and custody** problem, and
none of it is work an implementation phase can complete on its own:

- An Apple Developer Program membership (US$99/year) and an Organization
  identity, which requires a D-U-N-S number for a company.
- A Windows code-signing certificate. Since June 2023 the CA/Browser Forum has
  required OV and EV keys be held in hardware — an HSM or a cloud signing
  service — so this is a physical token or a subscription, not a `.pfx` in a
  repository.
- Somewhere to keep both that is not this repository, and a rotation story for
  when someone with access leaves.

Buying identity is the whole task. Deferring it costs users the two dialogs in
[INSTALL.md](INSTALL.md); doing it early costs money, an annual renewal, and a
secret with real blast radius, for a v1 whose distribution is a link.

## What signing would change

**Windows.** An OV certificate removes the "Unknown publisher" line but not
necessarily the SmartScreen prompt — OV reputation accrues per-certificate over
download volume, so early users may still see a warning. An EV certificate gets
SmartScreen reputation immediately, which is the only reason to prefer it.

**macOS.** Signing with a Developer ID Application certificate is necessary but
not sufficient: Gatekeeper on current macOS also requires **notarization** (an
upload to Apple's service, which scans and returns a ticket) and, for offline
first launch, **stapling** that ticket to the `.dmg`. All three, or users still
see the dialog. This is why INSTALL.md's macOS section is longer than its
Windows one.

**Linux.** Nothing. There is no equivalent gate, so signing buys no user-facing
change.

## What signing would NOT change

Worth stating plainly, because "unsigned" is easy to read as "unsafe":

- It would not change the privacy model. The engine still has no network
  capability, there is still exactly one egress chokepoint, and static mode
  still makes no network calls. A signature attests to **who published a
  binary**, not to what that binary does.
- It would not change determinism, the analysis, or any acceptance criterion
  except the ones about installers.
- It would not make the checksum check in INSTALL.md redundant. Verifying the
  bytes you received is the check a signature is *supposed* to subsume, and it
  costs one command.

## The path, when it is taken

Tauri v2 supports both platforms natively; the work is credential plumbing, not
new code.

1. **Acquire identities — and decide WHO the certificate is issued to before
   applying for one, not after.** `bundle.publisher` (`tauri.conf.json`) is
   `kodeksidev` as of the rename in `docs/DECISIONS.md` — a brand/handle, not
   a legal name. A code-signing CA does not verify a handle; OV and EV
   verification attaches a certificate to a **legal identity** — a natural
   person (their real name) or a registered legal entity (a business name a
   D-U-N-S/registry lookup resolves to). That identity is what the
   certificate's Subject will read, and what Windows/macOS UI shows once
   signed. So this step is not "buy a certificate" — it is:
   - **Is `kodeksidev` a registered legal entity (a business), or does it
     resolve to an individual operating under that name?** If the former,
     the CA issues to the entity and the Subject can plausibly read
     `kodeksidev` (or its full registered name) — same shape as the Apple
     Organization path already below. If the latter, the CA issues to the
     PERSON, and the certificate's Subject will show their real name — NOT
     `kodeksidev` — regardless of what `bundle.publisher` says. That would
     make the signed installer show one identity in the installer's own
     metadata (Add/Remove Programs, `onboard.exe`'s CompanyName — all
     `kodeksidev`) and a DIFFERENT one in the OS's own signature-verification
     UI (the individual's legal name). Deciding this NOW avoids discovering
     it mid-procurement, when an HSM/subscription may already be paid for.
   - Apple Developer Program (Organization) for `Developer ID Application`;
     a Windows OV or EV certificate from a CA, held in an HSM or cloud
     signing service.
2. **Store them as CI secrets**, never in the repository. Tauri reads
   `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
   `APPLE_ID`, `APPLE_TEAM_ID` and an app-specific password for notarization;
   Windows signing is configured under `bundle.windows.certificateThumbprint`
   or an equivalent signing-service hook.
3. **Sign and notarize in the release job**, not locally. A signing key that
   lives on a laptop is a signing key that leaves with the laptop.
4. **Staple the notarization ticket** to the `.dmg` before publishing, so first
   launch works without network access — which matters more than usual for a
   product whose entire pitch is that it does not need the network.
5. **Rewrite [INSTALL.md](INSTALL.md).** Both bypass sections should shrink to
   nothing. Leave the checksum step.
6. **Only then consider auto-update.** A17 defers it, and the reason is this
   document: an unsigned auto-updater is a mechanism for silently replacing a
   binary with one nobody has attested to. Auto-update is downstream of signing,
   never alongside it.

## Where release builds happen

Recorded here because it constrains step 3, and because it is not obvious:
**the engine sidecars must be built on Linux.** `bun build --compile` produces
all four target triples from a Linux runner, and fails on Windows when
extracting the darwin bun executables. If per-OS runners are ever needed for the
bundles themselves — an `.msi` genuinely needs Windows — the sidecars must still
be built once on Linux and passed between jobs as artifacts, not rebuilt per
runner. See the cross-compile entry in [DECISIONS.md](DECISIONS.md).

## Status

Not started, and not scheduled. Nothing in this document is a commitment; it is
the map for whoever decides v2 needs it.
