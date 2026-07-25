import { describe, expect, test } from 'bun:test';
import { isIgnoredByStack, loadGitignoreLayer, type IgnoreLayer } from '../../src/walk/gitignore';

function layerFor(dirRelPath: string, text: string): IgnoreLayer {
  const layer = loadGitignoreLayer({ readGitignoreText: () => text }, '/unused', dirRelPath);
  if (layer === null) {
    throw new Error('expected a layer to load');
  }
  return layer;
}

describe('loadGitignoreLayer', () => {
  test('returns null when the directory has no .gitignore', () => {
    const layer = loadGitignoreLayer({ readGitignoreText: () => null }, '/repo', '');
    expect(layer).toBeNull();
  });

  test('loads a layer scoped to its own directory', () => {
    const layer = layerFor('src', '*.log');
    expect(layer.dirRelPath).toBe('src');
  });
});

describe('isIgnoredByStack — single root layer', () => {
  test('ignores a path matching the root .gitignore', () => {
    const root = layerFor('', '*.log');
    expect(isIgnoredByStack('debug.log', [root])).toBe(true);
  });

  test('does not ignore a path the root .gitignore has no opinion on', () => {
    const root = layerFor('', '*.log');
    expect(isIgnoredByStack('src/index.ts', [root])).toBe(false);
  });
});

describe('isIgnoredByStack — nested .gitignore with a "!negation" (Section 8.1, Section 10)', () => {
  test('a deeper layer re-includes a path the root layer ignores', () => {
    const root = layerFor('', '*.log');
    const nested = layerFor('src/sub/nested', '!important.log');
    const layers = [root, nested];

    expect(isIgnoredByStack('src/sub/nested/important.log', layers)).toBe(false);
  });

  test('a sibling file in the same deep directory is still ignored by the root rule', () => {
    const root = layerFor('', '*.log');
    const nested = layerFor('src/sub/nested', '!important.log');
    const layers = [root, nested];

    expect(isIgnoredByStack('src/sub/nested/other.log', layers)).toBe(true);
  });

  test('three nested levels: the deepest layer with an opinion always wins', () => {
    const root = layerFor('', '*.log');
    const middle = layerFor('src/sub', '*.tmp');
    const deepest = layerFor('src/sub/nested', '!important.log');
    const layers = [root, middle, deepest];

    expect(isIgnoredByStack('src/sub/nested/important.log', layers)).toBe(false);
    expect(isIgnoredByStack('src/sub/nested/other.log', layers)).toBe(true);
    expect(isIgnoredByStack('src/sub/scratch.tmp', layers)).toBe(true);
  });

  test('a path outside every non-root layer only consults the root layer', () => {
    const root = layerFor('', '*.log');
    const nested = layerFor('other/dir', '!keep.log');
    const layers = [root, nested];

    expect(isIgnoredByStack('unrelated/path.log', layers)).toBe(true);
  });
});
