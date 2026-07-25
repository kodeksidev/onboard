/**
 * Emits the frozen contract as JSON Schema (Phase 1 deliverable).
 *
 * `bun run contract:emit` regenerates `dist/analysis-result.schema.json`.
 * The companion drift check (`check-schema-drift.ts`) asserts the emitted
 * bytes match the committed file, so an accidental schema edit fails CI
 * instead of silently changing the contract three tracks depend on.
 *
 * Serialization is deterministic: zod emits a stable object graph for a
 * given schema, and `JSON.stringify(_, null, 2)` preserves that order, so
 * two runs on the same source always produce identical bytes.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { AnalysisEnvelope, AnalysisResult, SCHEMA_VERSION } from '../src/analysis-result';
import { AppError } from '../src/error';
import { SearchRequest, SearchResponse } from '../src/search';

/** Repo-relative POSIX output path, resolved from this script's own location. */
const OUTPUT_PATH = join(import.meta.dir, '..', 'dist', 'analysis-result.schema.json');

interface EmittedSchema {
  readonly $schema: string;
  readonly title: string;
  readonly schemaVersion: number;
  readonly definitions: Readonly<Record<string, unknown>>;
}

export function buildSchemaDocument(): EmittedSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Onboard AnalysisResult contract',
    schemaVersion: SCHEMA_VERSION,
    definitions: {
      AnalysisResult: z.toJSONSchema(AnalysisResult),
      AnalysisEnvelope: z.toJSONSchema(AnalysisEnvelope),
      SearchRequest: z.toJSONSchema(SearchRequest),
      SearchResponse: z.toJSONSchema(SearchResponse),
      AppError: z.toJSONSchema(AppError),
    },
  };
}

/** The exact bytes written to disk, including the trailing newline. */
export function serializeSchemaDocument(): string {
  return `${JSON.stringify(buildSchemaDocument(), null, 2)}\n`;
}

export function getOutputPath(): string {
  return OUTPUT_PATH;
}

if (import.meta.main) {
  await Bun.write(OUTPUT_PATH, serializeSchemaDocument());
  console.log(`contract:emit wrote ${OUTPUT_PATH}`);
}
