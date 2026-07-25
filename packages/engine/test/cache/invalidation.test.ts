import { describe, expect, test } from 'bun:test';
import { decideCacheInvalidation } from '../../src/cache/invalidation';
import type { CacheSchemaMeta } from '../../src/cache/cache-store';

const EXPECTED: CacheSchemaMeta = {
  cacheSchemaVersion: 1,
  engineVersion: '0.1.0',
  grammarFingerprint: 'abc123',
  contractSchemaVersion: 1,
};

describe('decideCacheInvalidation', () => {
  test('keeps the cache when every value matches and integrity passed', () => {
    expect(decideCacheInvalidation({ ...EXPECTED }, EXPECTED, true)).toEqual({
      action: 'keep',
      reason: null,
    });
  });

  test('recreates when PRAGMA integrity_check failed, before even looking at stored meta', () => {
    expect(decideCacheInvalidation({ ...EXPECTED }, EXPECTED, false)).toEqual({
      action: 'recreate',
      reason: 'integrity-check-failed',
    });
  });

  test('recreates when the database is missing or unreadable', () => {
    expect(decideCacheInvalidation(null, EXPECTED, true)).toEqual({
      action: 'recreate',
      reason: 'missing-or-unreadable',
    });
  });

  test('recreates on a cacheSchemaVersion mismatch', () => {
    const stored = { ...EXPECTED, cacheSchemaVersion: 2 };
    expect(decideCacheInvalidation(stored, EXPECTED, true)).toEqual({
      action: 'recreate',
      reason: 'cacheSchemaVersion-mismatch',
    });
  });

  test('recreates on an engineVersion mismatch', () => {
    const stored = { ...EXPECTED, engineVersion: '0.2.0' };
    expect(decideCacheInvalidation(stored, EXPECTED, true)).toEqual({
      action: 'recreate',
      reason: 'engineVersion-mismatch',
    });
  });

  test('recreates on a grammarFingerprint mismatch', () => {
    const stored = { ...EXPECTED, grammarFingerprint: 'different' };
    expect(decideCacheInvalidation(stored, EXPECTED, true)).toEqual({
      action: 'recreate',
      reason: 'grammarFingerprint-mismatch',
    });
  });

  test('recreates on a contractSchemaVersion mismatch', () => {
    const stored = { ...EXPECTED, contractSchemaVersion: 2 };
    expect(decideCacheInvalidation(stored, EXPECTED, true)).toEqual({
      action: 'recreate',
      reason: 'contractSchemaVersion-mismatch',
    });
  });

  test('never migrates: every mismatch reason maps to a full recreate, not a partial update', () => {
    const reasons = [
      decideCacheInvalidation({ ...EXPECTED, cacheSchemaVersion: 99 }, EXPECTED, true),
      decideCacheInvalidation({ ...EXPECTED, engineVersion: 'x' }, EXPECTED, true),
      decideCacheInvalidation({ ...EXPECTED, grammarFingerprint: 'x' }, EXPECTED, true),
      decideCacheInvalidation({ ...EXPECTED, contractSchemaVersion: 99 }, EXPECTED, true),
    ];
    for (const decision of reasons) {
      expect(decision.action).toBe('recreate');
    }
  });
});
