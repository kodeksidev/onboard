/**
 * Drift check for the frozen contract (Phase 1 gate).
 *
 * Regenerates the JSON Schema in memory and compares it byte-for-byte with
 * the committed `dist/analysis-result.schema.json`. Exits non-zero on any
 * difference. Section 7 forbids a later phase adding, renaming, retyping, or
 * reordering a field; this is the mechanical enforcement of that rule.
 */
import { getOutputPath, serializeSchemaDocument } from './emit-schema';

const expected = serializeSchemaDocument();
const outputPath = getOutputPath();
const committedFile = Bun.file(outputPath);

if (!(await committedFile.exists())) {
  console.error(
    `contract drift check FAILED: ${outputPath} does not exist.\n` +
      'Run `bun run contract:emit` and commit the result.',
  );
  process.exit(1);
}

const actual = await committedFile.text();

if (actual !== expected) {
  console.error(
    'contract drift check FAILED: the committed JSON Schema does not match the schemas in src/.\n' +
      `  committed bytes: ${actual.length}\n` +
      `  emitted bytes:   ${expected.length}\n` +
      'If this change is intentional it is a BREAKING CONTRACT CHANGE: bump SCHEMA_VERSION,\n' +
      're-run the Phase 1 gate, and announce it to the engine, Rust, and UI tracks.\n' +
      'If it is not intentional, revert the schema edit.',
  );
  process.exit(1);
}

console.log('contract drift check OK: emitted schema is byte-identical to the committed file.');
