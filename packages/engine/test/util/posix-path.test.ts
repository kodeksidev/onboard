import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  posixBasename,
  posixBasenameWithoutExt,
  posixDirname,
  posixExtLower,
  posixJoin,
  splitPosixSegments,
  toPosixPath,
  toRepoRelativePosixPath,
} from '../../src/util/posix-path';

describe('toPosixPath', () => {
  test('replaces backslashes with forward slashes', () => {
    expect(toPosixPath('src\\api\\user.ts')).toBe('src/api/user.ts');
  });

  test('leaves an already-POSIX path unchanged', () => {
    expect(toPosixPath('src/api/user.ts')).toBe('src/api/user.ts');
  });
});

describe('toRepoRelativePosixPath', () => {
  test('normalizes a nested native path to a POSIX repo-relative path', () => {
    const repoRoot = join('C:', 'repos', 'acme');
    const absPath = join(repoRoot, 'src', 'api', 'user.ts');
    expect(toRepoRelativePosixPath(repoRoot, absPath)).toBe('src/api/user.ts');
  });

  test('round-trips a path segment containing a space unchanged (A22)', () => {
    const repoRoot = join('C:', 'Users', 'codex', 'Desktop', 'CodeBase onboarding');
    const absPath = join(repoRoot, 'dir with space', 'file.ts');
    expect(toRepoRelativePosixPath(repoRoot, absPath)).toBe('dir with space/file.ts');
  });
});

describe('splitPosixSegments', () => {
  test('splits a multi-segment path and drops empty segments', () => {
    expect(splitPosixSegments('src/api/user.ts')).toEqual(['src', 'api', 'user.ts']);
  });

  test('returns an empty array for a root-level basename', () => {
    expect(splitPosixSegments('index.ts')).toEqual(['index.ts']);
  });
});

describe('posixDirname / posixBasename / posixExtLower', () => {
  test('computes dirname for a nested path', () => {
    expect(posixDirname('src/api/user.ts')).toBe('src/api');
  });

  test('computes dirname as "." for a root-level file', () => {
    expect(posixDirname('index.ts')).toBe('.');
  });

  test('computes basename', () => {
    expect(posixBasename('src/api/user.ts')).toBe('user.ts');
  });

  test('computes a lowercased extension without the dot', () => {
    expect(posixExtLower('src/api/User.TSX')).toBe('tsx');
  });

  test('returns an empty extension for an extensionless file', () => {
    expect(posixExtLower('Dockerfile')).toBe('');
  });
});

describe('posixJoin', () => {
  test('joins segments with a single separator', () => {
    expect(posixJoin('src', 'api', 'user.ts')).toBe('src/api/user.ts');
  });
});

describe('posixBasenameWithoutExt', () => {
  test('strips only the final extension', () => {
    expect(posixBasenameWithoutExt('user.test.ts')).toBe('user.test');
  });

  test('returns the whole basename when there is no extension', () => {
    expect(posixBasenameWithoutExt('Makefile')).toBe('Makefile');
  });
});
