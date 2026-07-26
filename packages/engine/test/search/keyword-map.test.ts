import { describe, expect, test } from 'bun:test';
import { KEYWORD_MAP, loadUserKeywordMap, mergeKeywordMaps, parseUserKeywordMap } from '../../src/search/keyword-map';

const REQUIRED_CONCEPTS = [
  'auth',
  'payment',
  'database',
  'routing',
  'config',
  'logging',
  'cache',
  'email',
  'upload',
  'i18n',
  'permissions',
  'queue',
  'websocket',
  'testing',
  'error',
];

describe('KEYWORD_MAP', () => {
  test('contains at least the 15 concept sets Section 8.7 names', () => {
    REQUIRED_CONCEPTS.forEach((concept) => {
      expect(KEYWORD_MAP[concept]).toBeDefined();
      expect(KEYWORD_MAP[concept]!.length).toBeGreaterThan(0);
    });
  });

  test('auth expands to session/jwt/oauth (a representative sample)', () => {
    expect(KEYWORD_MAP.auth).toContain('session');
    expect(KEYWORD_MAP.auth).toContain('jwt');
    expect(KEYWORD_MAP.auth).toContain('oauth');
  });

  test('is frozen (cannot be mutated at runtime)', () => {
    expect(Object.isFrozen(KEYWORD_MAP)).toBe(true);
  });
});

describe('parseUserKeywordMap', () => {
  test('parses a valid keywords.json blob', () => {
    const result = parseUserKeywordMap(JSON.stringify({ shipping: ['ship', 'delivery', 'tracking'] }));
    expect(result).toEqual({ shipping: ['ship', 'delivery', 'tracking'] });
  });

  test('drops a non-array value for a key rather than throwing', () => {
    const result = parseUserKeywordMap(JSON.stringify({ shipping: 'not-an-array', valid: ['ok'] }));
    expect(result).toEqual({ valid: ['ok'] });
  });

  test('returns {} for malformed JSON rather than throwing', () => {
    expect(parseUserKeywordMap('{ not valid json')).toEqual({});
  });

  test('returns {} for a JSON array or primitive at the top level', () => {
    expect(parseUserKeywordMap('[]')).toEqual({});
    expect(parseUserKeywordMap('42')).toEqual({});
  });
});

describe('loadUserKeywordMap', () => {
  test('returns {} when path is null', () => {
    expect(loadUserKeywordMap(null, () => 'unused')).toEqual({});
  });

  test('returns {} when the file cannot be read', () => {
    expect(loadUserKeywordMap('/nowhere/keywords.json', () => null)).toEqual({});
  });

  test('reads and parses the file when present', () => {
    const content = JSON.stringify({ shipping: ['ship'] });
    expect(loadUserKeywordMap('/config/keywords.json', () => content)).toEqual({ shipping: ['ship'] });
  });
});

describe('mergeKeywordMaps', () => {
  test('user entries win on key collision (whole-array replace)', () => {
    const merged = mergeKeywordMaps(KEYWORD_MAP, { auth: ['custom-only'] });
    expect(merged.auth).toEqual(['custom-only']);
  });

  test('keeps base entries untouched when there is no collision', () => {
    const merged = mergeKeywordMaps(KEYWORD_MAP, { shipping: ['ship'] });
    expect(merged.payment).toEqual(KEYWORD_MAP.payment);
    expect(merged.shipping).toEqual(['ship']);
  });
});
