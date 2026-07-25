import { describe, expect, test } from 'bun:test';
import { buildTokenIndexRows } from '../../src/index/token-index';
import { MAX_LINES_PER_TOKEN } from '../../src/constants';

describe('buildTokenIndexRows', () => {
  test('lowercases tokens and drops tokens shorter than 3 characters', () => {
    const rows = buildTokenIndexRows('a.ts', 'AUTH is ok\n');
    const tokens = rows.map((r) => r.token);
    expect(tokens).toContain('auth');
    expect(tokens).not.toContain('is'); // length 2, dropped
    expect(tokens).not.toContain('ok'); // length 2, dropped
  });

  test('counts every occurrence of a token, even on the same line', () => {
    const rows = buildTokenIndexRows('a.ts', 'auth auth auth\n');
    const authRow = rows.find((r) => r.token === 'auth');
    expect(authRow?.count).toBe(3);
    expect(JSON.parse(authRow?.linesJson ?? '[]')).toEqual([1]);
  });

  test('records an ascending, de-duplicated line list', () => {
    const rows = buildTokenIndexRows('a.ts', 'session\nsession\nother\nsession\n');
    const sessionRow = rows.find((r) => r.token === 'session');
    expect(JSON.parse(sessionRow?.linesJson ?? '[]')).toEqual([1, 2, 4]);
  });

  test('caps the recorded line list at MAX_LINES_PER_TOKEN', () => {
    const lines = Array.from({ length: MAX_LINES_PER_TOKEN + 10 }, () => 'token').join('\n');
    const rows = buildTokenIndexRows('a.ts', lines);
    const tokenRow = rows.find((r) => r.token === 'token');
    const recordedLines: number[] = JSON.parse(tokenRow?.linesJson ?? '[]');
    expect(recordedLines).toHaveLength(MAX_LINES_PER_TOKEN);
    expect(tokenRow?.count).toBe(MAX_LINES_PER_TOKEN + 10);
  });

  test('splits a camelCase identifier into its constituent words plus the whole token (words under 3 chars are dropped, same as any other token)', () => {
    const rows = buildTokenIndexRows('a.ts', 'getUserById\n');
    const tokens = rows.map((r) => r.token);
    expect(tokens).toContain('getuserbyid');
    expect(tokens).toContain('get');
    expect(tokens).toContain('user');
    expect(tokens).not.toContain('by'); // length 2, dropped
    expect(tokens).not.toContain('id'); // length 2, dropped
  });

  test('splits a snake_case identifier into its constituent words plus the whole token', () => {
    const rows = buildTokenIndexRows('a.ts', 'find_by_id\n');
    const tokens = rows.map((r) => r.token);
    expect(tokens).toContain('find_by_id');
    expect(tokens).toContain('find');
    expect(tokens).not.toContain('by'); // length 2, dropped
  });

  test('sorts rows by token ascending', () => {
    const rows = buildTokenIndexRows('a.ts', 'zebra apple mango\n');
    expect(rows.map((r) => r.token)).toEqual(['apple', 'mango', 'zebra']);
  });

  test('returns an empty array for text with no qualifying tokens', () => {
    expect(buildTokenIndexRows('a.ts', 'a b c\n')).toEqual([]);
  });

  test('every row carries the given path', () => {
    const rows = buildTokenIndexRows('src/deep/file.ts', 'auth\n');
    expect(rows.every((r) => r.path === 'src/deep/file.ts')).toBe(true);
  });
});
