# Onboard v0.1.3

**A branding fix. No behavior changed from v0.1.2 — upgrade whenever convenient.**

## What changed

The installer's publisher identity moves from an individual's name to
**`kodeksidev`**. This value is baked into the installer at build time, so it
had to change before this release's artifacts were published rather than in a
later one.

Every surface it reaches, confirmed rather than assumed:

- Windows **Add/Remove Programs** → Publisher
- The NSIS installer's `MANUFACTURER` (the registry path that stores
  install-language and shortcut bookkeeping)
- `onboard.exe`'s own file properties → **Company name** — verified directly
  against the built binary, not inferred from config
- The `.deb` package's **Maintainer** field

The `.rpm`'s equivalent field very likely follows the same value (RPM and deb
packaging share the same settings upstream) but was not independently
confirmed against a built `.rpm` in this environment — flagged, not
assumed, in `docs/DECISIONS.md`.

**What did NOT change:** the copyright holder. `Copyright (c) 2026 Onboard
contributors` — in the installer, in `LICENSE`, everywhere it appears — was
never tied to the individual's name and stays exactly as it was. Publisher and
copyright answer different questions and always have.

Also: the CI job that verifies a real Windows install now asserts the
publisher string rather than only printing it, so a future silent revert
fails the build instead of waiting for someone to read a log. Full detail,
including the one surface (`.rpm`) not independently confirmed, in
`docs/DECISIONS.md`.

## Upgrading

Install over v0.1.2; no migration, no settings change, no cache invalidation
— the analysis engine itself is unchanged from v0.1.2.

## Platform status

Unchanged from v0.1.2. Windows and Linux are installed and verified on clean
machines in CI. **macOS is built but never run**, and remains excluded from
the release until `docs/MACOS_SMOKE.md` is signed off on real hardware.

## Downloads

| file | platform |
|---|---|
| `Onboard_0.1.3_x64-setup.exe` | Windows |
| `Onboard_0.1.3_amd64.deb` | Debian / Ubuntu |
| `Onboard-0.1.3-1.x86_64.rpm` | Fedora / RHEL |

Onboard is unsigned in v1, so Windows SmartScreen and macOS Gatekeeper will
object on first launch. `docs/INSTALL.md` quotes what each dialog says and
how to proceed. That dialog says "Unknown publisher" regardless of this
release's change — it reads the Authenticode signature, not this field; see
`docs/INSTALL.md`.

## With AI off, it still makes no network connections at all

Unchanged, and still enforced by the egress checks in CI.
