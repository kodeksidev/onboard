import { describe, expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_PARSE_BYTES } from '../../src/constants';
import { determineSkipReason } from '../../src/walk/skip-rules';

const KITCHEN_SINK = join(import.meta.dir, '..', '..', 'fixtures', 'kitchen-sink');

function readerFor(text: string): { readFirstBytes: () => Uint8Array; readFullText: () => string } {
  const bytes = new TextEncoder().encode(text);
  return {
    readFirstBytes: () => bytes.subarray(0, 8192),
    readFullText: () => text,
  };
}

describe('determineSkipReason — too-large (checked before any content is read)', () => {
  test('flags a file above MAX_PARSE_BYTES without reading its content', () => {
    const reason = determineSkipReason({
      sizeBytes: MAX_PARSE_BYTES + 1,
      readFirstBytes: () => {
        throw new Error('must not read content once size alone decides too-large');
      },
      readFullText: () => {
        throw new Error('must not read content once size alone decides too-large');
      },
    });
    expect(reason).toBe('too-large');
  });

  test('the vendored 2 MB kitchen-sink fixture is skipped as too-large', () => {
    const filePath = join(KITCHEN_SINK, 'src', 'large-file.ts');
    const sizeBytes = statSync(filePath).size;
    expect(sizeBytes).toBeGreaterThan(MAX_PARSE_BYTES);
    const reason = determineSkipReason({
      sizeBytes,
      readFirstBytes: () => new Uint8Array(),
      readFullText: () => '',
    });
    expect(reason).toBe('too-large');
  });
});

describe('determineSkipReason — binary', () => {
  test('flags a NUL byte within the first 8 KB', () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x00, 0x63]);
    const reason = determineSkipReason({
      sizeBytes: bytes.length,
      readFirstBytes: () => bytes,
      readFullText: () => 'unused',
    });
    expect(reason).toBe('binary');
  });

  test('does not flag ordinary text as binary', () => {
    const input = readerFor('const x = 1;\nconst y = 2;\n');
    const reason = determineSkipReason({ sizeBytes: 26, ...input });
    expect(reason).toBeNull();
  });
});

describe('determineSkipReason — minified', () => {
  test('flags a file with a line longer than MINIFIED_MAX_LINE_LENGTH', () => {
    const longLine = `var packed = "${'a'.repeat(6000)}";`;
    const input = readerFor(longLine);
    const reason = determineSkipReason({ sizeBytes: longLine.length, ...input });
    expect(reason).toBe('minified');
  });

  test('the vendored kitchen-sink minified.js fixture is skipped as minified', () => {
    const filePath = join(KITCHEN_SINK, 'src', 'minified.js');
    const text = readFileSync(filePath, 'utf8');
    const sizeBytes = statSync(filePath).size;
    const reason = determineSkipReason({ sizeBytes, ...readerFor(text) });
    expect(reason).toBe('minified');
  });

  test('does not flag normally formatted source as minified', () => {
    const text = 'function add(a, b) {\n  return a + b;\n}\n';
    const reason = determineSkipReason({ sizeBytes: text.length, ...readerFor(text) });
    expect(reason).toBeNull();
  });
});
