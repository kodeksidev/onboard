import { describe, expect, test, vi } from 'vitest';
import cytoscape from 'cytoscape';
import type { AnalysisResult } from '@onboard/contract';
import {
  GRAPH_ENTERING_VIEW_MAX_NODES,
  collapseLazyDirectory,
  collapsedAncestorsOf,
  computeEnteringCollapsedDirectoryPaths,
  createNoopExpandCollapseApi,
  directoryDepth,
  expandLazyDirectory,
  getExpandCollapseApi,
  reconcileLazyElements,
  revealPath,
} from './collapse';
import { buildLazyGraphElements, directoryNodeId, fileNodeId } from './graph-model';
import { buildLargeSyntheticResult, buildRepoShapedResult } from './graph-lazy-fixtures';
import type { RepoShape } from './graph-lazy-fixtures';

/**
 * CacttusEdu as the engine actually measured it on 2026-09-08: 500 files, 90
 * directories, files bunched three and four levels down. The entering view's
 * legibility guard runs against this shape rather than a uniform synthetic
 * tree, because a uniform tree is the one case a depth-based rule cannot get
 * wrong (docs/DECISIONS.md).
 */
const CACTTUS_EDU_SHAPE: RepoShape = {
  directoriesPerDepth: [6, 15, 27, 40, 2],
  filesPerContainingDepth: [5, 49, 42, 189, 166, 49],
};

/** Nodes the canvas would actually draw: everything `buildLazyGraphElements` emits without `hidden-by-collapse`. */
function countVisibleNodes(result: AnalysisResult, collapsedDirs: ReadonlySet<string>): number {
  return buildLazyGraphElements(result, collapsedDirs).nodes.filter(
    (node) => !String(node.classes ?? '').includes('hidden-by-collapse'),
  ).length;
}

describe('directoryDepth', () => {
  test('counts path segments', () => {
    expect(directoryDepth('src')).toBe(1);
    expect(directoryDepth('src/controllers')).toBe(2);
    expect(directoryDepth('src/sub/nested')).toBe(3);
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

describe('computeEnteringCollapsedDirectoryPaths', () => {
  test('collapses nothing when the whole repo already fits the budget — a small repo still shows every file', () => {
    const directories = [{ path: 'src' }, { path: 'src/mod0' }];
    const files = [{ path: 'src/a.ts' }, { path: 'src/mod0/b.ts' }, { path: 'README.md' }];

    expect(computeEnteringCollapsedDirectoryPaths(directories, files)).toEqual(new Set());
  });

  test('collapses to the deepest level that still fits the budget, not to a fixed depth', () => {
    const directories = [{ path: 'src' }, { path: 'src/mod0' }, { path: 'src/mod0/nested' }];
    // 6 files directly in src/mod0 and 2 deeper; a budget of 5 cannot afford
    // to open src/mod0, so the cut lands one level shallower.
    const files = [
      ...Array.from({ length: 6 }, (_unused, index) => ({ path: `src/mod0/f${String(index)}.ts` })),
      { path: 'src/mod0/nested/deep.ts' },
      { path: 'src/top.ts' },
    ];

    const collapsed = computeEnteringCollapsedDirectoryPaths(directories, files, 5);

    expect([...collapsed].sort()).toEqual(['src/mod0', 'src/mod0/nested']);
  });

  test('a real repository shape (CacttusEdu, 500 files) enters under the legibility budget', () => {
    const result = buildRepoShapedResult(CACTTUS_EDU_SHAPE);
    expect(result.files.length).toBe(500);

    const collapsed = computeEnteringCollapsedDirectoryPaths(result.directories, result.files);

    // The assertion that matters: whatever the repo, the view a user LANDS on
    // is small enough for every visible label to be readable without zooming.
    // The screenshot is the judgment; this is the guard against regressing it.
    expect(countVisibleNodes(result, collapsed)).toBeLessThanOrEqual(GRAPH_ENTERING_VIEW_MAX_NODES);
  });

  test('the entering view keeps every top-level directory — the structure is the whole point of it', () => {
    const result = buildRepoShapedResult(CACTTUS_EDU_SHAPE);

    const collapsed = computeEnteringCollapsedDirectoryPaths(result.directories, result.files);
    const visiblePaths = new Set(
      buildLazyGraphElements(result, collapsed)
        .nodes.filter((node) => !String(node.classes ?? '').includes('hidden-by-collapse'))
        .map((node) => node.data.path as string),
    );

    result.directories
      .filter((directory) => directoryDepth(directory.path) === 1)
      .forEach((directory) => {
        expect(visiblePaths.has(directory.path)).toBe(true);
      });
  });

  test('a repo too flat to fit stays over budget rather than pretending otherwise', () => {
    // 200 files directly at the repo root: collapsing cannot hide root files,
    // so the floor depth is the best available and it is still over budget.
    const files = Array.from({ length: 200 }, (_unused, index) => ({ path: `f${String(index)}.ts` }));

    const collapsed = computeEnteringCollapsedDirectoryPaths([], files);

    expect(collapsed).toEqual(new Set());
  });
});

describe('collapsedAncestorsOf', () => {
  test('reports every collapsed directory hiding a path, not just the shallowest', () => {
    const collapsed = new Set(['src', 'src/deep', 'other']);

    expect(collapsedAncestorsOf('src/deep/file.ts', collapsed)).toEqual(['src', 'src/deep']);
  });

  test('is empty for a file at the repo root', () => {
    expect(collapsedAncestorsOf('README.md', new Set(['src']))).toEqual([]);
  });
});

/**
 * These exercise the actual performance fix (Section 9 Phase 8 follow-up):
 * `expandLazyDirectory` materializing real children into a live core, not
 * just unhiding elements that already existed. `buildLargeSyntheticResult`
 * nests `src/modN/nested` inside `src/modN`, so the entering view's cut lands
 * at depth 2 and both collapse levels are exercised at once.
 */
describe('expandLazyDirectory', () => {
  const MODULE_COUNT = 30;
  const FILES_PER_MODULE = 21; // 630 files + 61 directories

  function setUp(): { cy: cytoscape.Core; result: ReturnType<typeof buildLargeSyntheticResult>; collapsedDirs: ReadonlySet<string> } {
    const result = buildLargeSyntheticResult(MODULE_COUNT, FILES_PER_MODULE);
    const collapsedDirs = computeEnteringCollapsedDirectoryPaths(result.directories, result.files);
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

describe('revealPath', () => {
  function setUp(): { cy: cytoscape.Core; result: ReturnType<typeof buildLargeSyntheticResult>; collapsedDirs: ReadonlySet<string> } {
    const result = buildLargeSyntheticResult(30, 21);
    const collapsedDirs = computeEnteringCollapsedDirectoryPaths(result.directories, result.files);
    const initial = buildLazyGraphElements(result, collapsedDirs);
    const cy = cytoscape({ headless: true, styleEnabled: true, elements: [...initial.nodes, ...initial.edges] });
    return { cy, result, collapsedDirs };
  }

  /**
   * The divergence this exists to close: `keyboard-nav.ts` traverses every
   * file in the `AnalysisResult`, so `ArrowDown`/`[`/`]` routinely target a
   * file that the entering view has collapsed away. Before `revealPath`,
   * focusing it found no node, returned silently, and left the panel
   * announcing a file to screen readers that nobody could see on the canvas.
   */
  test('materializes a file that is buried two collapsed levels deep, and reports that it did', () => {
    const { cy, result, collapsedDirs } = setUp();
    const buried = 'src/mod3/nested/file1.ts';
    expect(cy.getElementById(fileNodeId(buried)).empty()).toBe(true);

    const outcome = revealPath(cy, result, buried, collapsedDirs);

    expect(outcome.didReveal).toBe(true);
    const revealed = cy.getElementById(fileNodeId(buried));
    expect(revealed.empty()).toBe(false);
    expect(revealed.hasClass('hidden-by-collapse')).toBe(false);
    cy.destroy();
  });

  test('leaves the graph untouched for a file that is already visible', () => {
    const { cy, result, collapsedDirs } = setUp();
    // Nothing is visible at file level in the entering view of this fixture,
    // so open one directory first — the point of the test is that revealing
    // an ALREADY-revealed file is a no-op, not that files start visible.
    const expanded = expandLazyDirectory(cy, result, 'src/mod0', collapsedDirs);
    const nodeCountBefore = cy.nodes().length;

    const outcome = revealPath(cy, result, 'src/mod0/index.ts', expanded);

    expect(outcome.didReveal).toBe(false);
    expect(outcome.collapsedDirs).toBe(expanded);
    expect(cy.nodes().length).toBe(nodeCountBefore);
    cy.destroy();
  });
});

describe('collapseLazyDirectory', () => {
  test('folds an expanded directory back up, hiding the files it had materialized', () => {
    const result = buildLargeSyntheticResult(30, 21);
    const entering = computeEnteringCollapsedDirectoryPaths(result.directories, result.files);
    const initial = buildLazyGraphElements(result, entering);
    const cy = cytoscape({ headless: true, styleEnabled: true, elements: [...initial.nodes, ...initial.edges] });
    const expanded = expandLazyDirectory(cy, result, 'src/mod0', entering);
    expect(cy.getElementById(fileNodeId('src/mod0/index.ts')).hasClass('hidden-by-collapse')).toBe(false);

    collapseLazyDirectory(cy, result, 'src/mod0', expanded);

    // The node still exists (nodes are never removed once real) but is no
    // longer drawn — without the class toggle, re-collapsing a directory left
    // its files on screen with nothing containing them.
    expect(cy.getElementById(fileNodeId('src/mod0/index.ts')).hasClass('hidden-by-collapse')).toBe(true);
    cy.destroy();
  });
});

describe('reconcileLazyElements', () => {
  test('is idempotent: reconciling against the same target twice adds nothing extra', () => {
    const result = buildLargeSyntheticResult(30, 21);
    const collapsedDirs = computeEnteringCollapsedDirectoryPaths(result.directories, result.files);
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
