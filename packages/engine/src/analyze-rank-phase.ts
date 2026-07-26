/**
 * @onboard/engine — `analyze()`'s resolve -> graph -> rank phase, split out
 * of `analyze.ts` to stay under the 50-line-per-function limit.
 */
import type { ParsedFile } from './parse/language-parser';
import { resolveAllImports, type ResolutionOutput } from './analyze-support';
import { buildGraph, type GraphData } from './graph/build-graph';
import { computeStronglyConnectedComponents } from './graph/tarjan-scc';
import { buildCycles, type CycleResult } from './graph/cycles';
import { findOrphanPaths } from './graph/orphans';
import { computeImportance, type ImportanceOutput, type ImportanceResult } from './rank/importance';
import { buildRoadmap, type RoadmapStepResult } from './rank/roadmap';
import { buildModules, computeModuleIdByPath, type ModuleResult } from './rank/modules';
import { detectSourceRoots } from './stack/detect-stack';
import type { PreparedAnalysis, PhaseTimingSink } from './analyze';

function reportPhaseTiming<T>(sink: PhaseTimingSink | undefined, label: string, fn: () => T): T {
  if (sink === undefined) {
    return fn();
  }
  const start = performance.now();
  const result = fn();
  sink(label, performance.now() - start);
  return result;
}

export interface ComputedAnalysis {
  readonly resolution: ResolutionOutput;
  readonly graph: GraphData;
  readonly sccEdgeRefs: readonly { readonly from: string; readonly to: string }[];
  readonly importanceByPath: ReadonlyMap<string, ImportanceResult>;
  readonly importantFilePaths: readonly string[];
  readonly sourceRoots: readonly string[];
  readonly modules: readonly ModuleResult[];
  readonly moduleIdByPath: ReadonlyMap<string, string>;
  readonly sccs: readonly (readonly string[])[];
  readonly cycles: readonly CycleResult[];
  readonly orphanPaths: readonly string[];
  readonly roadmapSteps: readonly RoadmapStepResult[];
}

function computeModules(prepared: PreparedAnalysis, importanceByPath: ReadonlyMap<string, ImportanceResult>, resolution: ResolutionOutput) {
  const sourceRoots = detectSourceRoots(prepared.workspacePackages.map((p) => p.dirPath));
  const moduleInput = {
    files: prepared.classified.map((f) => ({
      path: f.path,
      isParsed: f.isParsed,
      importance: importanceByPath.get(f.path)?.importance ?? 0,
      importanceRank: importanceByPath.get(f.path)?.importanceRank ?? 0,
    })),
    sourceRoots,
    edges: resolution.edges,
  };
  return { sourceRoots, modules: buildModules(moduleInput), moduleIdByPath: computeModuleIdByPath(moduleInput) };
}

function computeRoadmap(
  prepared: PreparedAnalysis,
  graph: GraphData,
  importanceByPath: ReadonlyMap<string, ImportanceResult>,
  sccEdgeRefs: readonly { readonly from: string; readonly to: string }[],
  moduleIdByPath: ReadonlyMap<string, string>,
  modules: readonly ModuleResult[],
): readonly RoadmapStepResult[] {
  const moduleNameById = new Map(modules.map((m) => [m.id, m.name] as const));
  return buildRoadmap({
    files: prepared.classified.map((f) => ({
      path: f.path,
      classification: f.classification,
      importance: importanceByPath.get(f.path)?.importance ?? 0,
      importanceRank: importanceByPath.get(f.path)?.importanceRank ?? 0,
      inDegree: graph.degrees.get(f.path)?.inDegree ?? 0,
    })),
    edges: sccEdgeRefs,
    entryPoints: prepared.entryPoints.map((e) => ({ path: e.path, rank: e.rank, evidence: e.evidence })),
    outLinks: graph.outLinks,
    moduleNameForPath: (path) => moduleNameById.get(moduleIdByPath.get(path) ?? '') ?? 'this codebase',
  });
}

function computeImportanceByPath(
  prepared: PreparedAnalysis,
  graph: GraphData,
): { readonly importance: ImportanceOutput; readonly importanceByPath: ReadonlyMap<string, ImportanceResult> } {
  const importance = computeImportance(
    prepared.classified.map((f) => ({
      path: f.path,
      isParsed: f.isParsed,
      classification: f.classification,
      pageRank: graph.pageRank.get(f.path) ?? 0,
      inDegree: graph.degrees.get(f.path)?.inDegree ?? 0,
      lineCount: f.lineCount,
    })),
  );
  const importanceByPath = new Map(importance.results.map((r) => [r.path, r] as const));
  return { importance, importanceByPath };
}

/** Resolves imports, builds the graph, and computes importance/roadmap/modules. */
export function computeGraphAndRanking(
  prepared: PreparedAnalysis,
  parsedByPath: ReadonlyMap<string, ParsedFile>,
  onPhaseTiming?: PhaseTimingSink,
): ComputedAnalysis {
  const resolution = reportPhaseTiming(onPhaseTiming, 'resolveImports', () =>
    resolveAllImports(prepared.classified, parsedByPath, prepared.resolverContext),
  );
  const graph = reportPhaseTiming(onPhaseTiming, 'buildGraph', () =>
    buildGraph({ allFilePaths: prepared.classified.map((f) => f.path), edges: resolution.edges }),
  );
  const sccEdgeRefs = resolution.edges.map((e) => ({ from: e.fromPath, to: e.toPath }));

  const { importance, importanceByPath } = reportPhaseTiming(onPhaseTiming, 'importance', () => computeImportanceByPath(prepared, graph));

  const { sourceRoots, modules, moduleIdByPath } = reportPhaseTiming(onPhaseTiming, 'modules', () =>
    computeModules(prepared, importanceByPath, resolution),
  );

  const { sccs, cycles, orphanPaths } = reportPhaseTiming(onPhaseTiming, 'sccCyclesOrphans', () => {
    const sccResult = computeStronglyConnectedComponents(prepared.classified.map((f) => f.path), sccEdgeRefs);
    return { sccs: sccResult, cycles: buildCycles(sccResult, graph.outLinks), orphanPaths: findOrphanPaths(graph.degrees) };
  });
  const roadmapSteps = reportPhaseTiming(onPhaseTiming, 'roadmap', () =>
    computeRoadmap(prepared, graph, importanceByPath, sccEdgeRefs, moduleIdByPath, modules),
  );

  return {
    resolution,
    graph,
    sccEdgeRefs,
    importanceByPath,
    importantFilePaths: importance.importantFilePaths,
    sourceRoots,
    modules,
    moduleIdByPath,
    sccs,
    cycles,
    orphanPaths,
    roadmapSteps,
  };
}
