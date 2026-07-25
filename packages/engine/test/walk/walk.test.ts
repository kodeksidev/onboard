import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_REPO_FILES } from '../../src/constants';
import { RepoTooLargeError, walk, type DirEntryInfo, type WalkFs } from '../../src/walk/walk';

const KITCHEN_SINK = join(import.meta.dir, '..', '..', 'fixtures', 'kitchen-sink');

type FakeFile = { readonly kind: 'file'; readonly sizeBytes: number };
type FakeDir = {
  readonly kind: 'dir';
  readonly children: readonly string[];
  readonly gitignore?: string;
  readonly realPathOverride?: string;
};
type FakeNode = FakeFile | FakeDir;

function buildFakeFs(nodes: Readonly<Record<string, FakeNode>>, reverseReaddir: boolean): WalkFs {
  return {
    readDir: (absDirPath): readonly DirEntryInfo[] => {
      const node = nodes[absDirPath];
      if (node === undefined || node.kind !== 'dir') {
        return [];
      }
      const names = reverseReaddir ? [...node.children].reverse() : node.children;
      return names.map((name) => ({
        name,
        isDirectory: nodes[`${absDirPath}/${name}`]?.kind === 'dir',
      }));
    },
    realPath: (absPath) => {
      const node = nodes[absPath];
      return node?.kind === 'dir' && node.realPathOverride !== undefined ? node.realPathOverride : absPath;
    },
    readGitignoreText: (absDirPath) => {
      const node = nodes[absDirPath];
      return node?.kind === 'dir' && node.gitignore !== undefined ? node.gitignore : null;
    },
    statSize: (absPath) => {
      const node = nodes[absPath];
      return node?.kind === 'file' ? node.sizeBytes : 0;
    },
  };
}

describe('walk — nested .gitignore with a !negation, end to end', () => {
  test('re-includes a deeply nested file the root .gitignore would otherwise drop', () => {
    const result = walk(KITCHEN_SINK);
    const paths = result.files.map((file) => file.path);

    expect(paths).toContain('src/sub/nested/important.log');
    expect(paths).not.toContain('src/sub/nested/other.log');
    expect(paths).not.toContain('other.log');
    expect(result.filesIgnoredCount).toBeGreaterThan(0);
  });
});

describe('walk — a path containing a space (A22)', () => {
  test('discovers a file under a directory segment with a space, normalized to POSIX', () => {
    const result = walk(KITCHEN_SINK);
    const paths = result.files.map((file) => file.path);
    expect(paths).toContain('src/dir with space/file.ts');
  });
});

describe('walk — a CRLF file', () => {
  test('reports the exact on-disk byte size, proving raw bytes are never normalized', () => {
    const result = walk(KITCHEN_SINK);
    const record = result.files.find((file) => file.path === 'src/crlf-file.ts');
    expect(record).toBeDefined();
    expect(record?.sizeBytes).toBe(77);
  });
});

describe('walk — a symlink loop', () => {
  test('breaks the cycle via the realpath visited-set and emits SYMLINK_LOOP_SKIPPED', () => {
    const nodes: Record<string, FakeNode> = {
      '/repo': { kind: 'dir', children: ['a'] },
      '/repo/a': { kind: 'dir', children: ['file.ts', 'loop'] },
      '/repo/a/file.ts': { kind: 'file', sizeBytes: 10 },
      // 'loop' is a directory whose realpath resolves back to '/repo/a' itself,
      // simulating a self-referential symlink without needing OS symlink support.
      '/repo/a/loop': { kind: 'dir', children: [], realPathOverride: '/repo/a' },
    };
    const fs = buildFakeFs(nodes, false);

    const result = walk('/repo', { fs });

    expect(result.files.map((file) => file.path)).toEqual(['a/file.ts']);
    expect(result.diagnostics).toEqual([{ code: 'SYMLINK_LOOP_SKIPPED', path: 'a/loop' }]);
  });

  test('a real OS symlink loop is also skipped (best-effort; requires symlink privileges)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onboard-symlink-'));
    try {
      symlinkSync(dir, join(dir, 'loop'), 'dir');
    } catch {
      // Section 10: "skipped on Windows without dev mode". Nothing to assert
      // when the platform refuses to create the symlink in the first place.
      rmSync(dir, { recursive: true, force: true });
      return;
    }
    const result = walk(dir);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'SYMLINK_LOOP_SKIPPED')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('walk — determinism under a shuffled readdir stub', () => {
  test('produces an identical file list and diagnostics regardless of readdir order', () => {
    const nodes: Record<string, FakeNode> = {
      '/repo': { kind: 'dir', children: ['z-dir', 'a-file.ts', 'm-dir'] },
      '/repo/z-dir': { kind: 'dir', children: ['q.ts', 'a.ts'] },
      '/repo/z-dir/q.ts': { kind: 'file', sizeBytes: 30 },
      '/repo/z-dir/a.ts': { kind: 'file', sizeBytes: 10 },
      '/repo/m-dir': { kind: 'dir', children: ['x.ts'] },
      '/repo/m-dir/x.ts': { kind: 'file', sizeBytes: 20 },
      '/repo/a-file.ts': { kind: 'file', sizeBytes: 5 },
    };

    const natural = walk('/repo', { fs: buildFakeFs(nodes, false) });
    const shuffled = walk('/repo', { fs: buildFakeFs(nodes, true) });

    expect(shuffled.files).toEqual(natural.files);
    expect(shuffled.diagnostics).toEqual(natural.diagnostics);
    expect(natural.files.map((file) => file.path)).toEqual([
      'a-file.ts',
      'm-dir/x.ts',
      'z-dir/a.ts',
      'z-dir/q.ts',
    ]);
  });
});

describe('walk — MAX_REPO_FILES ceiling', () => {
  test('throws RepoTooLargeError once candidate files exceed the limit', () => {
    const children = Array.from({ length: MAX_REPO_FILES + 1 }, (_, i) => `file-${String(i).padStart(6, '0')}.ts`);
    const nodes: Record<string, FakeNode> = { '/repo': { kind: 'dir', children } };
    for (const name of children) {
      nodes[`/repo/${name}`] = { kind: 'file', sizeBytes: 1 };
    }

    expect(() => walk('/repo', { fs: buildFakeFs(nodes, false) })).toThrow(RepoTooLargeError);
  });
});
