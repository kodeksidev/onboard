import { describe, expect, test } from 'vitest';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import {
  assignModuleColors,
  buildAdjacency,
  buildGraphElements,
  buildLazyGraphElements,
  computeNodeSize,
  directoryNodeId,
  fileNodeId,
  orderPathsByImportance,
  pathFromNodeId,
  resolveVisibleNodeId,
} from './graph-model';
import { buildLargeSyntheticResult } from './graph-lazy-fixtures';

const SAMPLE = AnalysisEnvelope.parse(rawSampleAnalysis).result;

describe('fileNodeId / directoryNodeId / pathFromNodeId', () => {
  test('round-trips a file path through its node id', () => {
    const id = fileNodeId('src/index.ts');
    expect(id).not.toBe('src/index.ts'); // prefixed, never collides with a directory id
    expect(pathFromNodeId(id)).toBe('src/index.ts');
  });

  test('a directory node id is not mistaken for a file path', () => {
    expect(pathFromNodeId(directoryNodeId('src/services'))).toBeNull();
  });
});

describe('computeNodeSize', () => {
  test('maps importance 0 to the minimum size and 1 to the maximum size', () => {
    const min = computeNodeSize(0);
    const max = computeNodeSize(1);
    expect(max).toBeGreaterThan(min);
    expect(computeNodeSize(0.5)).toBeGreaterThan(min);
    expect(computeNodeSize(0.5)).toBeLessThan(max);
  });
});

describe('assignModuleColors', () => {
  test('gives every distinct module id a color, and the same id the same color', () => {
    const colors = assignModuleColors(['src-services', 'src-routes', 'src-controllers']);
    expect(colors.size).toBe(3);
    expect(colors.get('src-services')).toBe(colors.get('src-services'));
    expect(new Set(colors.values()).size).toBe(3); // all distinct
  });

  test('is deterministic across calls with the same input', () => {
    const first = assignModuleColors(['a', 'b', 'c']);
    const second = assignModuleColors(['a', 'b', 'c']);
    expect([...first.entries()]).toEqual([...second.entries()]);
  });
});

describe('orderPathsByImportance', () => {
  test('orders ascending by importanceRank, matching the fixture', () => {
    const ordered = orderPathsByImportance(SAMPLE.files);
    expect(ordered[0]).toBe('src/config/env.ts'); // importanceRank 1 in the fixture
    expect(ordered[ordered.length - 1]).toBe('web/src/vendor.min.js'); // rank 24, unparsed
  });
});

describe('buildAdjacency', () => {
  test('dependencies are sorted outgoing targets, dependents are sorted incoming sources', () => {
    const adjacency = buildAdjacency(SAMPLE.edges);
    expect(adjacency.dependencies.get('src/index.ts')).toEqual(['src/config/env.ts', 'src/server.ts']);
    expect(adjacency.dependents.get('src/config/env.ts')?.length).toBeGreaterThan(0);
  });

  test('a file with no edges has no adjacency entries', () => {
    const adjacency = buildAdjacency(SAMPLE.edges);
    expect(adjacency.dependencies.get('README.md')).toBeUndefined();
    expect(adjacency.dependents.get('README.md')).toBeUndefined();
  });
});

describe('buildGraphElements', () => {
  const elements = buildGraphElements(SAMPLE);

  test('produces one node per file plus one compound node per directory', () => {
    expect(elements.nodes.length).toBe(SAMPLE.files.length + SAMPLE.directories.length);
  });

  test('produces one edge per import edge, addressed by prefixed file ids', () => {
    expect(elements.edges).toHaveLength(SAMPLE.edges.length);
    const first = elements.edges[0]!;
    expect(first.data.source).toBe(fileNodeId(SAMPLE.edges[0]!.fromPath));
    expect(first.data.target).toBe(fileNodeId(SAMPLE.edges[0]!.toPath));
  });

  test('nests a file node under its directory\'s compound node', () => {
    const envNode = elements.nodes.find((node) => node.data.id === fileNodeId('src/config/env.ts'));
    expect(envNode?.data.parent).toBe(directoryNodeId('src/config'));
  });

  test('a root-level file has no compound parent', () => {
    const readme = elements.nodes.find((node) => node.data.id === fileNodeId('README.md'));
    expect(readme?.data.parent).toBeUndefined();
  });

  test('nests a directory node under its parent directory', () => {
    const controllers = elements.nodes.find(
      (node) => node.data.id === directoryNodeId('src/controllers'),
    );
    expect(controllers?.data.parent).toBe(directoryNodeId('src'));
  });

  test('every file node carries importance-derived size and module-derived color', () => {
    const envNode = elements.nodes.find((node) => node.data.id === fileNodeId('src/config/env.ts'));
    expect(envNode?.data.size).toBe(computeNodeSize(0.895));
    expect(typeof envNode?.data.color).toBe('string');
  });

  test('directory nodes are classed distinctly from file nodes for selector-based collapsing', () => {
    const dir = elements.nodes.find((node) => node.data.id === directoryNodeId('src'));
    const file = elements.nodes.find((node) => node.data.id === fileNodeId('src/index.ts'));
    expect(dir?.classes).toContain('directory-node');
    expect(file?.classes).toContain('file-node');
  });
});

describe('buildLazyGraphElements', () => {
  test('with an empty collapsed set, produces the same nodes and edges as buildGraphElements (never a behavior change for a small repo)', () => {
    const full = buildGraphElements(SAMPLE);
    const lazy = buildLazyGraphElements(SAMPLE, new Set());

    expect(lazy.nodes.map((node) => node.data.id).sort()).toEqual(full.nodes.map((node) => node.data.id).sort());
    expect(lazy.edges.map((edge) => edge.data.id).sort()).toEqual(full.edges.map((edge) => edge.data.id).sort());
  });

  test('a file inside a collapsed directory is not materialized as a node', () => {
    const lazy = buildLazyGraphElements(SAMPLE, new Set(['src/config']));

    expect(lazy.nodes.find((node) => node.data.id === fileNodeId('src/config/env.ts'))).toBeUndefined();
  });

  test('the collapsed directory itself is still materialized, labeled with its hidden descendant count', () => {
    const lazy = buildLazyGraphElements(SAMPLE, new Set(['src/config']));

    const dirNode = lazy.nodes.find((node) => node.data.id === directoryNodeId('src/config'));
    expect(dirNode).toBeDefined();
    expect(dirNode?.classes).toContain('lazy-collapsed');
    // Two lines — "config\n1 file" — since a collapsed directory is now the
    // primary thing being read in the entering view, not a footnote on a
    // file-level graph (docs/DECISIONS.md, 2026-09-08).
    expect(dirNode?.data.label).toBe('config\n1 file');
  });

  test('a collapsed directory is sized by what it contains, so identical grey blobs stop being identical', () => {
    const large = buildLargeSyntheticResult(30, 21);
    const lazy = buildLazyGraphElements(large, new Set(['src', 'src/mod0']));

    const root = lazy.nodes.find((node) => node.data.id === directoryNodeId('src'));
    const child = lazy.nodes.find((node) => node.data.id === directoryNodeId('src/mod0'));

    expect(Number(root?.data.size)).toBeGreaterThan(Number(child?.data.size));
  });

  test('at a large scale, node/edge count scales with the collapsed set, not with the total file count', () => {
    const large = buildLargeSyntheticResult(30, 21); // 630 files, 61 directories
    const totalElementCount = large.files.length + large.directories.length;
    expect(totalElementCount).toBeGreaterThan(600);

    const collapsedDirs = new Set(large.directories.filter((directory) => directory.path !== 'src').map((directory) => directory.path));
    const lazy = buildLazyGraphElements(large, collapsedDirs);

    // Only the always-materialized directory nodes remain — every file is hidden.
    expect(lazy.nodes).toHaveLength(large.directories.length);
    expect(lazy.nodes.some((node) => (node.classes ?? '').includes('file-node'))).toBe(false);
  });

  test('multiple edges that redirect to the same directory pair are deduplicated into one directory-level edge', () => {
    const large = buildLargeSyntheticResult(2, 2);
    const result = {
      ...large,
      edges: [
        { fromPath: 'src/mod0/index.ts', toPath: 'src/mod1/index.ts', specifier: './x', line: 1, kind: 'static' as const, isTypeOnly: false },
        { fromPath: 'src/mod0/nested/file1.ts', toPath: 'src/mod1/index.ts', specifier: './x', line: 1, kind: 'static' as const, isTypeOnly: false },
        { fromPath: 'src/mod0/index.ts', toPath: 'src/mod1/nested/file1.ts', specifier: './x', line: 1, kind: 'static' as const, isTypeOnly: false },
      ],
    };
    const collapsedDirs = new Set(['src/mod0', 'src/mod1']);

    const lazy = buildLazyGraphElements(result, collapsedDirs);

    const dir0ToDir1 = lazy.edges.filter(
      (edge) => edge.data.source === directoryNodeId('src/mod0') && edge.data.target === directoryNodeId('src/mod1'),
    );
    expect(dir0ToDir1).toHaveLength(1); // three underlying edges, one aggregate edge
  });

  test('an edge whose endpoints both fold into the same collapsed directory is not rendered at all (internal to that directory)', () => {
    const large = buildLargeSyntheticResult(1, 5);
    const collapsedDirs = new Set(['src/mod0', 'src/mod0/nested']);

    const lazy = buildLazyGraphElements(large, collapsedDirs);

    expect(lazy.edges).toHaveLength(0); // every file in this fixture folds into 'src/mod0' — no edge survives
  });
});

describe('resolveVisibleNodeId', () => {
  test('resolves to the real file id when nothing is collapsed', () => {
    expect(resolveVisibleNodeId('src/config/env.ts', new Set())).toBe(fileNodeId('src/config/env.ts'));
  });

  test('resolves to the shallowest collapsed ancestor directory, even when a deeper ancestor is also collapsed', () => {
    const collapsedDirs = new Set(['src/mod0', 'src/mod0/nested']);
    expect(resolveVisibleNodeId('src/mod0/nested/file.ts', collapsedDirs)).toBe(directoryNodeId('src/mod0'));
  });
});
