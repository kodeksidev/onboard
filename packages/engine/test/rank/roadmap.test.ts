import { describe, expect, test } from 'bun:test';
import { buildRoadmap, type RoadmapEntryPointInput, type RoadmapFileInput, type RoadmapInput } from '../../src/rank/roadmap';
import type { GraphEdge } from '../../src/graph/tarjan-scc';

function file(overrides: Partial<RoadmapFileInput> & { path: string }): RoadmapFileInput {
  return { classification: 'unknown', importance: 0, importanceRank: 99, inDegree: 0, ...overrides };
}

function baseInput(overrides: Partial<RoadmapInput> = {}): RoadmapInput {
  return {
    files: [],
    edges: [],
    entryPoints: [],
    outLinks: new Map(),
    moduleNameForPath: () => 'app',
    ...overrides,
  };
}

describe('buildRoadmap — entry points', () => {
  test('an entry point becomes the first step, section "entry", with its evidence in why', () => {
    const entryPoints: RoadmapEntryPointInput[] = [{ path: 'src/index.ts', rank: 1, evidence: 'package.json#main' }];
    const files = [file({ path: 'src/index.ts', importance: 0.9, importanceRank: 1 })];
    const steps = buildRoadmap(baseInput({ files, entryPoints }));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ order: 1, path: 'src/index.ts', section: 'entry' });
    expect(steps[0]?.why).toBe('Entry point (package.json#main). Start reading here.');
  });

  test('falls back to the highest-importance file as the single seed when there are no entry points', () => {
    const files = [
      file({ path: 'a.ts', importance: 0.2, importanceRank: 2 }),
      file({ path: 'b.ts', importance: 0.8, importanceRank: 1 }),
    ];
    const steps = buildRoadmap(baseInput({ files }));
    expect(steps[0]?.path).toBe('b.ts');
    expect(steps[0]?.section).toBe('entry');
  });
});

describe('buildRoadmap — cycles collapse to one step', () => {
  test('a 3-file import cycle produces one step with companionPaths and the cycle why template', () => {
    const entryPoints: RoadmapEntryPointInput[] = [{ path: 'a.ts', rank: 1, evidence: 'convention:src/index.ts' }];
    const files = [
      file({ path: 'a.ts', importance: 0.5, importanceRank: 1 }),
      file({ path: 'b.ts', importance: 0.4, importanceRank: 2 }),
      file({ path: 'c.ts', importance: 0.3, importanceRank: 3 }),
    ];
    const edges: GraphEdge[] = [
      { from: 'a.ts', to: 'b.ts' },
      { from: 'b.ts', to: 'c.ts' },
      { from: 'c.ts', to: 'a.ts' },
    ];
    const steps = buildRoadmap(baseInput({ files, entryPoints, edges }));
    expect(steps).toHaveLength(1);
    expect(steps[0]?.companionPaths).toHaveLength(2);
    expect(steps[0]?.why).toContain('Entry point'); // entry-ness is checked before the cycle template
  });

  test('a cycle NOT containing the entry point uses the cycle why template', () => {
    const entryPoints: RoadmapEntryPointInput[] = [{ path: 'main.ts', rank: 1, evidence: 'package.json#main' }];
    const files = [
      file({ path: 'main.ts', importance: 0.9, importanceRank: 1 }),
      file({ path: 'b.ts', importance: 0.5, importanceRank: 2 }),
      file({ path: 'c.ts', importance: 0.4, importanceRank: 3 }),
    ];
    const edges: GraphEdge[] = [
      { from: 'main.ts', to: 'b.ts' },
      { from: 'b.ts', to: 'c.ts' },
      { from: 'c.ts', to: 'b.ts' },
    ];
    const steps = buildRoadmap(baseInput({ files, entryPoints, edges }));
    const cycleStep = steps.find((s) => s.companionPaths.length > 0);
    expect(cycleStep?.why).toBe('Part of a 2-file import cycle; read these together.');
  });
});

describe('buildRoadmap — layering', () => {
  test('a direct dependency of the entry point is section "core"', () => {
    const entryPoints: RoadmapEntryPointInput[] = [{ path: 'main.ts', rank: 1, evidence: 'package.json#main' }];
    const files = [
      file({ path: 'main.ts', importance: 0.9, importanceRank: 1 }),
      file({ path: 'src/services/helper.ts', classification: 'service', importance: 0.1, importanceRank: 4, inDegree: 1 }),
    ];
    const edges: GraphEdge[] = [{ from: 'main.ts', to: 'src/services/helper.ts' }];
    const steps = buildRoadmap(
      baseInput({ files, entryPoints, edges, outLinks: new Map([['main.ts', ['src/services/helper.ts']]]) }),
    );
    const helperStep = steps.find((s) => s.path === 'src/services/helper.ts');
    expect(helperStep?.section).toBe('core');
  });
});

describe('buildRoadmap — leaf utilities', () => {
  test('a util-classified file with no further dependencies is pulled into the leaf-utility section', () => {
    const entryPoints: RoadmapEntryPointInput[] = [{ path: 'main.ts', rank: 1, evidence: 'package.json#main' }];
    const files = [
      file({ path: 'main.ts', importance: 0.9, importanceRank: 1 }),
      file({ path: 'src/utils/format.ts', classification: 'util', importance: 0.1, importanceRank: 5, inDegree: 1 }),
    ];
    const edges: GraphEdge[] = [{ from: 'main.ts', to: 'src/utils/format.ts' }];
    const steps = buildRoadmap(baseInput({ files, entryPoints, edges }));
    const utilStep = steps.find((s) => s.path === 'src/utils/format.ts');
    expect(utilStep?.section).toBe('leaf-utility');
    expect(utilStep?.why).toBe('Leaf utility imported by 1 files; read last, for reference.');
  });
});

describe('buildRoadmap — unreached', () => {
  test('a file never reached from any entry point is section "unreached"', () => {
    const entryPoints: RoadmapEntryPointInput[] = [{ path: 'main.ts', rank: 1, evidence: 'package.json#main' }];
    const files = [
      file({ path: 'main.ts', importance: 0.9, importanceRank: 1 }),
      file({ path: 'orphaned-tool.ts', importance: 0.05, importanceRank: 5 }),
    ];
    const steps = buildRoadmap(baseInput({ files, entryPoints }));
    const orphanStep = steps.find((s) => s.path === 'orphaned-tool.ts');
    expect(orphanStep?.section).toBe('unreached');
    expect(orphanStep?.why).toBe('Not reached from any entry point — likely dead code or a separate tool.');
  });
});

describe('buildRoadmap — ordering and caps', () => {
  test('assigns order 1..n and dependsOnPaths sorted and capped at 8', () => {
    const entryPoints: RoadmapEntryPointInput[] = [{ path: 'main.ts', rank: 1, evidence: 'package.json#main' }];
    const targets = Array.from({ length: 10 }, (_, i) => `t${String(i)}.ts`);
    const files = [
      file({ path: 'main.ts', importance: 0.9, importanceRank: 1 }),
      ...targets.map((t, i) => file({ path: t, importance: 0.5 - i * 0.01, importanceRank: i + 2, inDegree: 1 })),
    ];
    const edges: GraphEdge[] = targets.map((t) => ({ from: 'main.ts', to: t }));
    const outLinks = new Map([['main.ts', [...targets].sort()]]);
    const steps = buildRoadmap(baseInput({ files, entryPoints, edges, outLinks }));
    const mainStep = steps.find((s) => s.path === 'main.ts')!;
    expect(mainStep.dependsOnPaths).toHaveLength(8);
    const sorted = [...mainStep.dependsOnPaths];
    expect(sorted).toEqual([...mainStep.dependsOnPaths].sort());
    steps.forEach((step, index) => expect(step.order).toBe(index + 1));
  });

  test('is deterministic across two calls with the same input', () => {
    const entryPoints: RoadmapEntryPointInput[] = [{ path: 'main.ts', rank: 1, evidence: 'package.json#main' }];
    const files = [
      file({ path: 'main.ts', importance: 0.9, importanceRank: 1 }),
      file({ path: 'a.ts', importance: 0.3, importanceRank: 2, inDegree: 1 }),
      file({ path: 'b.ts', importance: 0.2, importanceRank: 3, inDegree: 1 }),
    ];
    const edges: GraphEdge[] = [
      { from: 'main.ts', to: 'a.ts' },
      { from: 'main.ts', to: 'b.ts' },
    ];
    const first = buildRoadmap(baseInput({ files, entryPoints, edges }));
    const second = buildRoadmap(baseInput({ files: [...files].reverse(), entryPoints, edges: [...edges].reverse() }));
    expect(second).toEqual(first);
  });
});
