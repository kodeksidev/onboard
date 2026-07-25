import { describe, expect, test, vi } from 'vitest';
import cytoscape from 'cytoscape';
import type { ExpandCollapseApi } from './collapse';
import {
  GRAPH_AUTO_COLLAPSE_THRESHOLD,
  autoCollapseIfNeeded,
  createNoopExpandCollapseApi,
  directoryDepth,
  getExpandCollapseApi,
} from './collapse';

/**
 * `cytoscape-expand-collapse`'s own `init()` unconditionally does
 * `cy.container().append(canvas)` for its cue layer, which throws under a
 * headless core (`cy.container()` is null) — a real limitation of the
 * vendored extension, not something this project's tests should paper over
 * with a fake canvas. So these tests exercise OUR selection/gating logic
 * (which nodes qualify, whether `collapse` gets called) against a plain
 * fake `ExpandCollapseApi` and a real headless `cytoscape.Core` for the
 * graph structure itself (headless core queries — `.nodes()`, `.data()`,
 * `.filter()` — need no canvas at all). The real extension only runs in the
 * actual Tauri webview, which always has a canvas.
 */
function buildNestedGraph(moduleCount: number): cytoscape.Core {
  const elements: cytoscape.ElementDefinition[] = [{ data: { id: 'dir:src', path: 'src' }, classes: 'directory-node' }];
  for (let index = 0; index < moduleCount; index += 1) {
    const dirPath = `src/mod${index}/nested`;
    elements.push({
      data: { id: `dir:src/mod${index}`, path: `src/mod${index}`, parent: 'dir:src' },
      classes: 'directory-node',
    });
    elements.push({
      data: { id: `dir:${dirPath}`, path: dirPath, parent: `dir:src/mod${index}` },
      classes: 'directory-node',
    });
    elements.push({
      data: { id: `file:${dirPath}/f.ts`, path: `${dirPath}/f.ts`, parent: `dir:${dirPath}` },
      classes: 'file-node',
    });
  }
  return cytoscape({ headless: true, styleEnabled: false, elements });
}

function buildFakeApi(): ExpandCollapseApi & { collapsedIds: () => string[] } {
  const collapsed: cytoscape.NodeCollection[] = [];
  return {
    collapse: (eles) => {
      collapsed.push(eles);
    },
    expand: () => undefined,
    collapseAll: () => undefined,
    expandAll: () => undefined,
    isCollapsible: () => true,
    isExpandable: () => false,
    collapsedIds: () => collapsed.flatMap((eles) => eles.map((ele) => ele.id())),
  };
}

describe('directoryDepth', () => {
  test('counts path segments', () => {
    expect(directoryDepth('src')).toBe(1);
    expect(directoryDepth('src/controllers')).toBe(2);
    expect(directoryDepth('src/sub/nested')).toBe(3);
  });
});

describe('autoCollapseIfNeeded', () => {
  test('does not call collapse at or below the threshold', () => {
    const cy = buildNestedGraph(2);
    const api = buildFakeApi();

    autoCollapseIfNeeded(cy, api, GRAPH_AUTO_COLLAPSE_THRESHOLD);

    expect(api.collapsedIds()).toEqual([]);
    cy.destroy();
  });

  test('collapses exactly the directories at depth >= 2 once the count exceeds the threshold', () => {
    const cy = buildNestedGraph(2);
    const api = buildFakeApi();

    autoCollapseIfNeeded(cy, api, GRAPH_AUTO_COLLAPSE_THRESHOLD + 1);

    // depth 1 ('src') is excluded; depth 2 ('src/mod0', 'src/mod1') and
    // depth 3 ('src/mod0/nested', 'src/mod1/nested') are both collapsed.
    expect(api.collapsedIds().sort()).toEqual(
      ['dir:src/mod0', 'dir:src/mod0/nested', 'dir:src/mod1', 'dir:src/mod1/nested'].sort(),
    );
    cy.destroy();
  });

  test('does nothing when there are no directories deep enough to collapse', () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: false,
      elements: [{ data: { id: 'dir:src', path: 'src' }, classes: 'directory-node' }],
    });
    const api = buildFakeApi();

    autoCollapseIfNeeded(cy, api, GRAPH_AUTO_COLLAPSE_THRESHOLD + 1);

    expect(api.collapsedIds()).toEqual([]);
    cy.destroy();
  });
});

describe('createNoopExpandCollapseApi', () => {
  test('is inert — safe to call from the headless test fallback with no real extension registered', () => {
    const api = createNoopExpandCollapseApi();
    expect(() => api.collapseAll()).not.toThrow();
    expect(() => api.expandAll()).not.toThrow();
    expect(api.isCollapsible({} as cytoscape.NodeSingular)).toBe(false);
  });
});

describe('getExpandCollapseApi', () => {
  test('proxies to cy.expandCollapse(options) without reimplementing the extension', () => {
    const expandCollapseSpy = vi.fn().mockReturnValue({ collapseAll: vi.fn() });
    const fakeCore = { expandCollapse: expandCollapseSpy } as unknown as cytoscape.Core;

    const options = { animate: false, undoable: false, cueEnabled: false };
    const api = getExpandCollapseApi(fakeCore, options);

    expect(expandCollapseSpy).toHaveBeenCalledWith(options);
    expect(api.collapseAll).toBeDefined();
  });
});
