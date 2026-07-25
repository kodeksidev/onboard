/**
 * @onboard/contract — stableStringify (Section 8.8, FROZEN at Phase 1).
 *
 * The ONLY serializer used for fingerprinting (`AnalysisResult.fingerprint`)
 * and for snapshot writing. Keys are sorted recursively using byte
 * comparison (never `localeCompare`, which is locale-sensitive and therefore
 * non-deterministic), and the output contains no whitespace.
 *
 * Documented behavior for the three edge cases the spec calls out:
 *  - `undefined` object-property values are OMITTED, matching `JSON.stringify`.
 *    This keeps `stableStringify` a drop-in canonical form of the same JSON
 *    a downstream `JSON.parse` would produce.
 *  - `undefined` array ELEMENTS become `null`, matching `JSON.stringify`, so
 *    array length/shape is never silently altered.
 *  - `null` serializes as the literal `null`.
 *  - Non-finite numbers (`NaN`, `Infinity`, `-Infinity`) throw a `TypeError`
 *    rather than silently degrading to `null` (which is what `JSON.stringify`
 *    does). A non-finite number reaching the fingerprint boundary is always
 *    a determinism bug upstream (e.g. a division by zero in PageRank); this
 *    function fails loudly instead of masking it.
 *  - A top-level `undefined` throws a `TypeError`: `stableStringify` is only
 *    ever called with a concrete `AnalysisResult`-shaped object, so an
 *    `undefined` at the root indicates a programming error.
 */

function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stringifyArray(value: readonly unknown[]): string {
  const items = value.map((item) => stringifyValue(item) ?? 'null');
  return `[${items.join(',')}]`;
}

function stringifyObject(value: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(value).sort(byteCompare);
  const parts: string[] = [];
  for (const key of keys) {
    const serialized = stringifyValue(value[key]);
    if (serialized === undefined) {
      continue; // omit undefined-valued properties, matching JSON.stringify
    }
    parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(',')}}`;
}

function stringifyNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `stableStringify: refusing to serialize non-finite number (${String(value)}); ` +
        'this indicates a determinism bug upstream, not a valid contract value.',
    );
  }
  return String(value);
}

function stringifyValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return stringifyNumber(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return stringifyArray(value);
  }
  if (typeof value === 'object') {
    return stringifyObject(value as Record<string, unknown>);
  }
  throw new TypeError(
    `stableStringify: unsupported value type "${typeof value}"; ` +
      'only JSON-representable values may cross the contract boundary.',
  );
}

/**
 * Recursively key-sorted, whitespace-free JSON serialization. Same input
 * always produces the same output string, regardless of key insertion order,
 * `Map`/`Set` involvement (never accepted directly — pass a sorted array),
 * or the host machine's locale.
 */
export function stableStringify(value: unknown): string {
  const result = stringifyValue(value);
  if (result === undefined) {
    throw new TypeError('stableStringify: cannot serialize a top-level undefined value.');
  }
  return result;
}
