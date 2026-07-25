/**
 * Tests for `stableStringify` (Section 8.8).
 *
 * This is the only serializer used for the fingerprint and for snapshot
 * writing, so its determinism is what acceptance criterion 3 ultimately
 * rests on.
 */
import { describe, expect, test } from 'bun:test';
import { stableStringify } from '../src/stable-stringify';

describe('stableStringify key ordering', () => {
  test('produces identical output regardless of key insertion order', () => {
    // Arrange
    const insertedOneWay = { beta: 1, alpha: 2, gamma: 3 };
    const insertedAnother = { gamma: 3, beta: 1, alpha: 2 };

    // Act
    const first = stableStringify(insertedOneWay);
    const second = stableStringify(insertedAnother);

    // Assert
    expect(first).toBe(second);
    expect(first).toBe('{"alpha":2,"beta":1,"gamma":3}');
  });

  test('sorts keys recursively at every depth', () => {
    const value = { z: { y: 1, x: { b: 2, a: 3 } }, a: 4 };
    expect(stableStringify(value)).toBe('{"a":4,"z":{"x":{"a":3,"b":2},"y":1}}');
  });

  test('sorts by byte order, not locale order', () => {
    // In several locales 'Z' collates before 'a'; byte order puts 'Z' (0x5A)
    // before 'a' (0x61) too, but 'a' before 'z' (0x7A). A locale-aware sort
    // would disagree on at least one of these pairs.
    const value = { z: 1, a: 2, Z: 3, A: 4 };
    expect(stableStringify(value)).toBe('{"A":4,"Z":3,"a":2,"z":1}');
  });

  test('produces different output when a value actually differs', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  test('emits no whitespace', () => {
    const serialized = stableStringify({ a: [1, 2], b: { c: 'd' } });
    expect(serialized).not.toMatch(/\s/);
  });
});

describe('stableStringify value handling', () => {
  test('preserves array order rather than sorting it', () => {
    expect(stableStringify(['c', 'a', 'b'])).toBe('["c","a","b"]');
  });

  test('serializes null as the literal null', () => {
    expect(stableStringify({ a: null })).toBe('{"a":null}');
  });

  test('omits properties whose value is undefined, matching JSON.stringify', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  test('renders an undefined array element as null so length is preserved', () => {
    expect(stableStringify([1, undefined, 3])).toBe('[1,null,3]');
  });

  test('serializes booleans', () => {
    expect(stableStringify({ t: true, f: false })).toBe('{"f":false,"t":true}');
  });

  test('escapes strings using JSON rules', () => {
    expect(stableStringify({ a: 'he said "hi"\n' })).toBe('{"a":"he said \\"hi\\"\\n"}');
  });

  test('escapes keys that contain quotes', () => {
    expect(stableStringify({ 'a"b': 1 })).toBe('{"a\\"b":1}');
  });

  test('handles an empty object and an empty array', () => {
    expect(stableStringify({})).toBe('{}');
    expect(stableStringify([])).toBe('[]');
  });

  test('handles nested empty structures', () => {
    expect(stableStringify({ a: {}, b: [] })).toBe('{"a":{},"b":[]}');
  });
});

describe('stableStringify failure modes', () => {
  // A non-finite number reaching the fingerprint boundary is always an upstream
  // determinism bug (e.g. a divide-by-zero in PageRank). Failing loudly beats
  // JSON.stringify's silent coercion to null.
  test.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('throws a TypeError on %s rather than coercing it', (_label, value) => {
    expect(() => stableStringify({ a: value })).toThrow(TypeError);
  });

  test('throws on a non-finite number nested inside an array', () => {
    expect(() => stableStringify({ a: [1, Number.NaN] })).toThrow(TypeError);
  });

  test('throws on a top-level undefined', () => {
    expect(() => stableStringify(undefined)).toThrow(TypeError);
  });

  test('throws on a value type that cannot cross the contract boundary', () => {
    expect(() => stableStringify({ a: () => 1 })).toThrow(TypeError);
    expect(() => stableStringify({ a: BigInt(1) })).toThrow(TypeError);
  });
});

describe('stableStringify determinism', () => {
  test('is idempotent across repeated calls on the same input', () => {
    const value = { b: [3, 1, 2], a: { d: null, c: 'x' } };
    const runs = Array.from({ length: 5 }, () => stableStringify(value));
    expect(new Set(runs).size).toBe(1);
  });

  test('does not mutate the input object', () => {
    const value = { b: 1, a: 2 };
    const before = Object.keys(value).join(',');
    stableStringify(value);
    expect(Object.keys(value).join(',')).toBe(before);
  });
});
