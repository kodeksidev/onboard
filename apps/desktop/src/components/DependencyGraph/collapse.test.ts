import { describe, expect, test, vi } from 'vitest';
import cytoscape from 'cytoscape';
import type { ExpandCollapseApi } from './collapse';
import {
  GRAPH_AUTO_COLLAPSE_THRESHOLD,
  autoCollapseIfNeeded,
  computeAutoCollapsedDirectoryPaths,
  createNoopExpandCollapseApi,
  directoryDepth,
  expandLazyDirectory,
  getExpandCollapseApi,
  reconcileLazyElements,
} from './collapse';
import { buildLazyGraphElements, directoryNodeId, fileNodeId } from './graph-model';
import { buildLargeSyntheticResult } from './graph-lazy-fixtures';

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

describe('computeAutoCollapsedDirectoryPaths', () => {
  test('collapses nothing at or below the threshold', () => {
    const directories = [{ path: 'src' }, { path: 'src/mod0' }];
    expect(computeAutoCollapsedDirectoryPaths(directories, GRAPH_AUTO_COLLAPSE_THRESHOLD)).toEqual(new Set());
  });

  test('collapses every directory at depth >= 2 once the count exceeds the threshold, without touching a cytoscape.Core', () => {
    const directories = [{ path: 'src' }, { path: 'src/mod0' }, { path: 'src/mod0/nested' }];
    const collapsed = computeAutoCollapsedDirectoryPaths(directories, GRAPH_AUTO_COLLAPSE_THRESHOLD + 1);
    expect([...collapsed].sort()).toEqual(['src/mod0', 'src/mod0/nested']);
  });
});

/**
 * These exercise the actual performance fix (Section 9 Phase 8 follow-up):
 * `expandLazyDirectory` materializing real children into a live core, not
 * just unhiding elements that already existed. `buildLargeSyntheticResult`
 * exceeds `GRAPH_AUTO_COLLAPSE_THRESHOLD` and nests `src/modN/nested`
 * inside `src/modN` so both collapse levels are exercised at once.
 */
describe('expandLazyDirectory', () => {
  const MODULE_COUNT = 30;
  const FILES_PER_MODULE = 21; // 30 * 21 = 630 files + 61 directories > 600

  function setUp(): { cy: cytoscape.Core; result: ReturnType<typeof buildLargeSyntheticResult>; collapsedDirs: ReadonlySet<string> } {
    const result = buildLargeSyntheticResult(MODULE_COUNT, FILES_PER_MODULE);
    const totalElementCount = result.files.length + result.directories.length;
    const collapsedDirs = computeAutoCollapsedDirectoryPaths(result.directories, totalElementCount);
    const initial = buildLazyGraphElements(result, collapsedDirs);
    const cy = cytoscape({ headless: true, styleEnabled: true, elements: [...initial.nodes, ...initial.edges] });
    return { cy, result, collapsedDirs };
  }

  test('the direct child file of a lazily-collapsed directory does not exist in the core before it is expanded', () => {
    const { cy } = setUp();
    expect(cy.getElementById(fileNodeId('src/mod0/index.ts')).empty()).toBe(true);
    cy.destroy();
  });

  test('expanding a directory materializes its direct file child into the live Cytoscape core', () => {
    const { cy, result, collapsedDirs } = setUp();

    expandLazyDirectory(cy, result, 'src/mod0', collapsedDirs);

    const childFile = cy.getElementById(fileNodeId('src/mod0/index.ts'));
    expect(childFile.empty()).toBe(false);
    expect(childFile.hasClass('file-node')).toBe(true);
    cy.destroy();
  });

  test('expanding a directory reveals its still-collapsed nested subdirectory, whose own children stay hidden', () => {
    const { cy, result, collapsedDirs } = setUp();

    expandLazyDirectory(cy, result, 'src/mod0', collapsedDirs);

    const nestedDir = cy.getElementById(directoryNodeId('src/mod0/nested'));
    expect(nestedDir.empty()).toBe(false);
    expect(nestedDir.hasClass('hidden-by-collapse')).toBe(false); // no longer hidden — its blocking ancestor just expanded
    expect(nestedDir.hasClass('lazy-collapsed')).toBe(true); // but it is still itself collapsed
    expect(cy.getElementById(fileNodeId('src/mod0/nested/file1.ts')).empty()).toBe(true); // its own children stay lazy
    cy.destroy();
  });

  test('expanding one directory does not materialize an unrelated collapsed directory\'s children', () => {
    const { cy, result, collapsedDirs } = setUp();

    expandLazyDirectory(cy, result, 'src/mod0', collapsedDirs);

    expect(cy.getElementById(fileNodeId('src/mod1/index.ts')).empty()).toBe(true);
    cy.destroy();
  });

  test('returns the collapsed-directory set with the expanded directory removed', () => {
    const { cy, result, collapsedDirs } = setUp();

    const next = expandLazyDirectory(cy, result, 'src/mod0', collapsedDirs);

    expect(next.has('src/mod0')).toBe(false);
    expect(next.has('src/mod1')).toBe(true); // untouched directories remain collapsed
    cy.destroy();
  });
});

describe('reconcileLazyElements', () => {
  test('is idempotent: reconciling against the same target twice adds nothing extra', () => {
    const result = buildLargeSyntheticResult(30, 21);
    const totalElementCount = result.files.length + result.directories.length;
    const collapsedDirs = computeAutoCollapsedDirectoryPaths(result.directories, totalElementCount);
    const target = buildLazyGraphElements(result, collapsedDirs);
    const cy = cytoscape({ headless: true, styleEnabled: true, elements: [...target.nodes, ...target.edges] });
    const nodeCountBefore = cy.nodes().length;
    const edgeCountBefore = cy.edges().length;

    reconcileLazyElements(cy, target);

    expect(cy.nodes().length).toBe(nodeCountBefore);
    expect(cy.edges().length).toBe(edgeCountBefore);
    cy.destroy();
  });
});
