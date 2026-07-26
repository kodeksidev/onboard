import { afterEach, describe, expect, test, vi } from 'vitest';
import { registerGraphFocusHandler, useGraphStore } from './graphStore';

afterEach(() => {
  registerGraphFocusHandler(null);
  useGraphStore.setState({
    selectedPath: null,
    focusedPath: null,
    focusToken: 0,
    searchFocusToken: 0,
    routePaths: [],
  });
});

describe('graphStore', () => {
  test('focusPath updates focusedPath and selectedPath, and bumps focusToken', () => {
    useGraphStore.getState().focusPath('src/index.ts');
    const state = useGraphStore.getState();
    expect(state.focusedPath).toBe('src/index.ts');
    expect(state.selectedPath).toBe('src/index.ts');
    expect(state.focusToken).toBe(1);
  });

  test('focusToken increments even when focusing the same path twice in a row', () => {
    useGraphStore.getState().focusPath('src/index.ts');
    useGraphStore.getState().focusPath('src/index.ts');
    expect(useGraphStore.getState().focusToken).toBe(2);
  });

  test('focusPath invokes the registered handler with the path — this is what Phase 9 calls to center a roadmap step', () => {
    const handler = vi.fn();
    registerGraphFocusHandler(handler);

    useGraphStore.getState().focusPath('src/server.ts');

    expect(handler).toHaveBeenCalledWith('src/server.ts');
  });

  test('focusPath is safe to call with no handler registered (e.g. before the graph has mounted)', () => {
    expect(() => useGraphStore.getState().focusPath('src/server.ts')).not.toThrow();
  });

  test('selectPath sets selection without touching focusedPath or focusToken', () => {
    useGraphStore.getState().selectPath('src/a.ts');
    const state = useGraphStore.getState();
    expect(state.selectedPath).toBe('src/a.ts');
    expect(state.focusedPath).toBeNull();
    expect(state.focusToken).toBe(0);
  });

  test('requestSearchFocus bumps searchFocusToken so a "/" press can be observed by an effect', () => {
    useGraphStore.getState().requestSearchFocus();
    useGraphStore.getState().requestSearchFocus();
    expect(useGraphStore.getState().searchFocusToken).toBe(2);
  });

  test('clearFocus resets focusedPath but preserves selection', () => {
    useGraphStore.getState().focusPath('src/a.ts');
    useGraphStore.getState().clearFocus();
    const state = useGraphStore.getState();
    expect(state.focusedPath).toBeNull();
    expect(state.selectedPath).toBe('src/a.ts');
  });

  test('setRoutePaths replaces the published roadmap route (Phase 9: the overlay DependencyGraph reads)', () => {
    useGraphStore.getState().setRoutePaths(['a.ts', 'b.ts', 'c.ts']);
    expect(useGraphStore.getState().routePaths).toEqual(['a.ts', 'b.ts', 'c.ts']);

    useGraphStore.getState().setRoutePaths([]);
    expect(useGraphStore.getState().routePaths).toEqual([]);
  });
});
