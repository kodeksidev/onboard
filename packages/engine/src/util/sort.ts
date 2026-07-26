/**
 * @onboard/engine — the one shared comparator (Section 8.8).
 *
 * "All sorts use `a < b ? -1 : a > b ? 1 : 0`. `localeCompare` is banned by
 * lint in packages/engine." Every module that needs a byte-ordering
 * comparator imports this rather than redeclaring it.
 */
export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `byteCompare` lifted to compare two items by a string key extracted from each. */
export function byKey<T>(keyOf: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => byteCompare(keyOf(a), keyOf(b));
}
