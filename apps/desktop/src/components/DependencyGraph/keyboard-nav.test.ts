import { describe, expect, test } from 'vitest';
import { interpretGraphKey, reduceGraphFocus } from './keyboard-nav';
import type { GraphKeyboardModel } from './keyboard-nav';

const MODEL: GraphKeyboardModel = {
  orderedPaths: ['a.ts', 'b.ts', 'c.ts'],
  dependencies: new Map([
    ['a.ts', ['b.ts', 'c.ts']],
    ['b.ts', []],
  ]),
  dependents: new Map([
    ['b.ts', ['a.ts']],
    ['c.ts', ['a.ts']],
  ]),
};

describe('interpretGraphKey', () => {
  test.each([
    ['ArrowDown', { type: 'move', direction: 'next' }],
    ['ArrowUp', { type: 'move', direction: 'previous' }],
    ['[', { type: 'step', direction: 'dependents' }],
    [']', { type: 'step', direction: 'dependencies' }],
    ['Enter', { type: 'open' }],
    ['/', { type: 'search' }],
    ['Escape', { type: 'exit' }],
    ['x', { type: 'none' }],
  ])('maps key %s to %j', (key, expected) => {
    expect(interpretGraphKey(key)).toEqual(expected);
  });
});

describe('reduceGraphFocus', () => {
  test('with nothing focused, any move focuses the most important file (rank 1)', () => {
    expect(reduceGraphFocus(MODEL, null, { type: 'move', direction: 'next' })).toBe('a.ts');
    expect(reduceGraphFocus(MODEL, null, { type: 'move', direction: 'previous' })).toBe('a.ts');
  });

  test('"next" moves one step down in importance rank and clamps at the end', () => {
    expect(reduceGraphFocus(MODEL, 'a.ts', { type: 'move', direction: 'next' })).toBe('b.ts');
    expect(reduceGraphFocus(MODEL, 'c.ts', { type: 'move', direction: 'next' })).toBe('c.ts');
  });

  test('"previous" moves one step up in importance rank and clamps at the start', () => {
    expect(reduceGraphFocus(MODEL, 'c.ts', { type: 'move', direction: 'previous' })).toBe('b.ts');
    expect(reduceGraphFocus(MODEL, 'a.ts', { type: 'move', direction: 'previous' })).toBe('a.ts');
  });

  test('"step dependencies" jumps to the first (sorted) file the current one imports', () => {
    expect(reduceGraphFocus(MODEL, 'a.ts', { type: 'step', direction: 'dependencies' })).toBe('b.ts');
  });

  test('"step dependencies" is a no-op when the current file has none', () => {
    expect(reduceGraphFocus(MODEL, 'b.ts', { type: 'step', direction: 'dependencies' })).toBe('b.ts');
  });

  test('"step dependents" jumps to the first (sorted) file that imports the current one', () => {
    expect(reduceGraphFocus(MODEL, 'b.ts', { type: 'step', direction: 'dependents' })).toBe('a.ts');
  });

  test('"step dependents" is a no-op when nothing imports the current file', () => {
    expect(reduceGraphFocus(MODEL, 'a.ts', { type: 'step', direction: 'dependents' })).toBe('a.ts');
  });

  test('an unknown path is treated as if nothing were focused', () => {
    expect(reduceGraphFocus(MODEL, 'nope.ts', { type: 'move', direction: 'next' })).toBe('a.ts');
  });

  test('an empty model never throws and returns the current (null) focus', () => {
    const empty: GraphKeyboardModel = { orderedPaths: [], dependencies: new Map(), dependents: new Map() };
    expect(reduceGraphFocus(empty, null, { type: 'move', direction: 'next' })).toBeNull();
  });
});
