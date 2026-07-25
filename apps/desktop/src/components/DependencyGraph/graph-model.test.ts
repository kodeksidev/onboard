import { describe, expect, test } from 'vitest';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import {
  assignModuleColors,
  buildAdjacency,
  buildGraphElements,
  computeNodeSize,
  directoryNodeId,
  fileNodeId,
  orderPathsByImportance,
  pathFromNodeId,
} from './graph-model';

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
