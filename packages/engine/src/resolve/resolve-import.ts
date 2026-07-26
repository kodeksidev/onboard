/**
 * @onboard/engine — the top-level resolution dispatcher (Section 8.2).
 *
 * Combines the JS/TS/TSX and Python resolvers behind one pure function,
 * producing contract-shaped results directly: `graph/build-graph.ts` never
 * has to know which language a file was.
 */
import { z } from 'zod';
import { Ecosystem, ImportEdge, UnresolvedImport } from '@onboard/contract';
import type { RawImport, SupportedLanguageId } from '../parse/language-parser';
import { resolveNodeImport, type NodeResolutionContext } from './node-resolution';
import { resolvePythonImport, type PythonResolutionContext } from './python-resolution';

export type ImportEdgeValue = z.infer<typeof ImportEdge>;
export type UnresolvedImportValue = z.infer<typeof UnresolvedImport>;
export type EcosystemValue = z.infer<typeof Ecosystem>;

export interface ResolverContext {
  readonly node: NodeResolutionContext;
  readonly python: PythonResolutionContext;
}

export type ResolvedImportOutcome =
  | { readonly kind: 'edge'; readonly edge: ImportEdgeValue }
  | { readonly kind: 'external'; readonly packageName: string; readonly ecosystem: EcosystemValue }
  | { readonly kind: 'unresolved'; readonly unresolved: UnresolvedImportValue };

function resolveJsTsFamily(
  fromPath: string,
  rawImport: RawImport,
  context: NodeResolutionContext,
): ResolvedImportOutcome {
  if (rawImport.kind === 'dynamic' && !rawImport.isLiteral) {
    return {
      kind: 'unresolved',
      unresolved: {
        fromPath,
        specifier: rawImport.specifier,
        line: rawImport.line,
        reason: 'dynamic-expression',
      },
    };
  }
  const result = resolveNodeImport(fromPath, rawImport.specifier, context);
  if (result.kind === 'resolved') {
    return {
      kind: 'edge',
      edge: {
        fromPath,
        toPath: result.toPath,
        specifier: rawImport.specifier,
        line: rawImport.line,
        kind: rawImport.kind,
        isTypeOnly: rawImport.isTypeOnly,
      },
    };
  }
  if (result.kind === 'external') {
    return { kind: 'external', packageName: result.packageName, ecosystem: 'npm' };
  }
  return {
    kind: 'unresolved',
    unresolved: { fromPath, specifier: rawImport.specifier, line: rawImport.line, reason: result.reason },
  };
}

function resolvePython(fromPath: string, rawImport: RawImport, context: PythonResolutionContext): ResolvedImportOutcome {
  if (rawImport.kind === 'dynamic' && !rawImport.isLiteral) {
    return {
      kind: 'unresolved',
      unresolved: { fromPath, specifier: rawImport.specifier, line: rawImport.line, reason: 'dynamic-expression' },
    };
  }
  const result = resolvePythonImport(fromPath, rawImport.specifier, context);
  if (result.kind === 'resolved') {
    return {
      kind: 'edge',
      edge: {
        fromPath,
        toPath: result.toPath,
        specifier: rawImport.specifier,
        line: rawImport.line,
        kind: 'static',
        isTypeOnly: false,
      },
    };
  }
  if (result.kind === 'external') {
    return { kind: 'external', packageName: result.packageName, ecosystem: result.ecosystem };
  }
  return {
    kind: 'unresolved',
    unresolved: { fromPath, specifier: rawImport.specifier, line: rawImport.line, reason: result.reason },
  };
}

/** Resolves one raw import per Section 8.2, dispatching on the file's language. */
export function resolveRawImport(
  fromPath: string,
  languageId: SupportedLanguageId,
  rawImport: RawImport,
  context: ResolverContext,
): ResolvedImportOutcome {
  return languageId === 'python'
    ? resolvePython(fromPath, rawImport, context.python)
    : resolveJsTsFamily(fromPath, rawImport, context.node);
}
