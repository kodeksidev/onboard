/**
 * @onboard/engine — JSON parsing that keeps "did not parse" distinct from
 * "parsed to nothing".
 *
 * Three modules — `stack/manifests.ts`, `stack/entry-points.ts` and
 * `resolve/workspaces.ts` — each defined their own identical `parseJsonSafely`
 * returning `null` on failure, and two of them then wrote `?? {}`. That
 * coalesces two different facts: `null` meant *this file did not parse*, `{}`
 * meant *it parsed and was empty*. A malformed `package.json` therefore
 * produced a manifest reported as present and valid with zero dependencies, so
 * the map told the user their project had no external dependencies — silently,
 * with no diagnostic anywhere.
 *
 * That is the third instance of one mechanism in this codebase. INV-3 dropped a
 * refusal and returned a shorter array; KI-1 collapsed an integer overflow into
 * "no line number"; this collapses a parse failure into "empty object". Every
 * time, the output is well formed and reads as success.
 *
 * The duplication is not incidental to it either. `resolve/tsconfig-paths.ts`
 * has the same failure and DOES surface it, as `TSCONFIG_UNREADABLE` — someone
 * decided this class of failure was worth telling the user about, and three
 * copies of the helper meant that decision reached one module out of four. One
 * definition is why the other three now report it too.
 */

export type JsonOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

const FAILED: JsonOutcome<never> = { ok: false };

/** Parses `text`, distinguishing a parse failure from any successful value. */
export function parseJsonValue(text: string): JsonOutcome<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return FAILED;
  }
}

/**
 * Parses `text` and requires a JSON object.
 *
 * A valid JSON document that is not an object — `null`, `[]`, `"text"`, `7` —
 * is reported as a FAILURE rather than as an empty object, because for every
 * caller here it means the same thing a syntax error does: this is not a
 * manifest. Returning `{}` for it would rebuild the exact conflation this
 * module exists to remove.
 */
export function parseJsonObject(text: string): JsonOutcome<Record<string, unknown>> {
  const outcome = parseJsonValue(text);
  if (!outcome.ok) {
    return FAILED;
  }
  const { value } = outcome;
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ok: true, value: value as Record<string, unknown> }
    : FAILED;
}

/** Notified with the repo-relative path of every manifest that failed to parse. */
export type UnparseableSink = (path: string) => void;

/**
 * Parses a manifest, reporting failure to `onUnparseable` instead of returning
 * a value indistinguishable from an empty one.
 *
 * The sink takes a path rather than returning a diagnostic so that the same
 * file read by two different modules reports once — `package.json` is parsed by
 * all three callers, and three copies of one warning would be worse than none.
 */
export function parseManifest(
  text: string,
  path: string,
  onUnparseable?: UnparseableSink,
): Record<string, unknown> | null {
  const outcome = parseJsonObject(text);
  if (outcome.ok) {
    return outcome.value;
  }
  onUnparseable?.(path);
  return null;
}
