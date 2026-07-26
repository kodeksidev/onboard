/**
 * @onboard/engine — resolves the engine's own version string, which feeds
 * `schema_meta.engineVersion` (one of Section 6.1's four cache-invalidation
 * keys).
 *
 * A bare `package.json` version string ("0.1.0") does not move when the
 * engine's CODE changes without a version bump — the exact gap behind a
 * confirmed poisoned-cache bug: a defective compiled binary wrote an empty
 * `ParsedFile` cache, then a FIXED binary was staged with no manual cache
 * clear and kept serving the poisoned rows forever, because none of the
 * four invalidation keys had changed (see `docs/DECISIONS.md`).
 *
 * `scripts/build-sidecar.ts` computes a sha256 of the emitted bundle and
 * injects it as a compile-time constant via `bun build --define` (so it is
 * baked into the binary as a literal, not a real environment-variable
 * lookup at runtime — see that script's own doc comment). This function
 * appends it when present. Running from source (`bun run`) never has this
 * constant defined (no `--define` step ran), so `buildHash` is a genuinely
 * unset value there — falling back to the bare package version is the
 * correct, honest behavior for that case, not a bug: there is no
 * meaningful "build" to fingerprint when running interpreted source.
 */
export function resolveEngineVersion(packageVersion: string, buildHash: string | undefined): string {
  return buildHash === undefined || buildHash.length === 0 ? packageVersion : `${packageVersion}+${buildHash}`;
}
