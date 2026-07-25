import { describe, expect, test } from 'bun:test';
import { computeRepoId, countLines, sha256Hex } from '../../src/util/hash';

describe('sha256Hex', () => {
  test('matches the known sha256 digest of an empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  test('matches the known sha256 digest of a simple string', () => {
    expect(sha256Hex('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  test('hashes raw bytes identically to the equivalent UTF-8 string', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(sha256Hex(bytes)).toBe(sha256Hex('hello'));
  });
});

describe('computeRepoId', () => {
  test('truncates the sha256 digest to 16 lowercase hex characters', () => {
    const repoId = computeRepoId('/repos/acme');
    expect(repoId).toHaveLength(16);
    expect(repoId).toBe(sha256Hex('/repos/acme').slice(0, 16));
  });

  test('is deterministic for the same canonical path', () => {
    expect(computeRepoId('/repos/acme')).toBe(computeRepoId('/repos/acme'));
  });

  test('differs for different canonical paths', () => {
    expect(computeRepoId('/repos/acme')).not.toBe(computeRepoId('/repos/other'));
  });
});

describe('countLines', () => {
  test('counts zero lines for an empty file', () => {
    expect(countLines('')).toBe(0);
  });

  test('counts a trailing partial line without a final newline', () => {
    expect(countLines('a\nb')).toBe(2);
  });

  test('does not count a phantom line after a trailing newline', () => {
    expect(countLines('a\nb\n')).toBe(2);
  });

  test('CRLF line endings are counted the same as LF (the \\r stays part of the line)', () => {
    const crlf = 'a\r\nb\r\n';
    const lf = 'a\nb\n';
    expect(countLines(crlf)).toBe(countLines(lf));
    expect(countLines(crlf)).toBe(2);
  });

  test('CRLF and LF versions of the same logical content hash differently (Section 10)', () => {
    const crlf = 'a\r\nb\r\n';
    const lf = 'a\nb\n';
    expect(sha256Hex(crlf)).not.toBe(sha256Hex(lf));
  });
});
