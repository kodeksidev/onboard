/**
 * @onboard/engine — file skip rules (Section 8.1's skip-rule paragraph).
 *
 * Rules are applied in this exact order, the same order the spec lists them
 * in, because each is cheaper than the next and `too-large` must short
 * circuit before any file content is ever read:
 *   1. `sizeBytes > MAX_PARSE_BYTES`           -> 'too-large' (metadata only)
 *   2. a NUL byte in the first `BINARY_CHECK_BYTES` bytes -> 'binary'
 *   3. `maxLineLength`/`meanLineLength` over threshold    -> 'minified'
 * Skipped files still appear in `files[]` with `isParsed: false` — callers
 * decide that; this module only classifies the reason.
 */
import {
  BINARY_CHECK_BYTES,
  MAX_PARSE_BYTES,
  MINIFIED_MAX_LINE_LENGTH,
  MINIFIED_MEAN_LINE_LENGTH,
} from '../constants';

export type SkipReason = 'binary' | 'too-large' | 'minified';

export interface SkipCheckInput {
  readonly sizeBytes: number;
  /** Up to `BINARY_CHECK_BYTES` leading bytes of the file. */
  readonly readFirstBytes: () => Uint8Array;
  /** Full file content, UTF-8 (lossy) decoded. Only called when needed. */
  readonly readFullText: () => string;
}

function hasNulByte(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) {
      return true;
    }
  }
  return false;
}

interface LineLengthStats {
  readonly maxLineLength: number;
  readonly meanLineLength: number;
}

function computeLineLengthStats(text: string): LineLengthStats {
  if (text.length === 0) {
    return { maxLineLength: 0, meanLineLength: 0 };
  }
  const lines = text.split('\n');
  let total = 0;
  let max = 0;
  for (const line of lines) {
    total += line.length;
    max = line.length > max ? line.length : max;
  }
  return { maxLineLength: max, meanLineLength: total / lines.length };
}

/** Returns the skip reason for a file's content, or `null` when it parses normally. */
export function determineSkipReason(input: SkipCheckInput): SkipReason | null {
  if (input.sizeBytes > MAX_PARSE_BYTES) {
    return 'too-large';
  }
  const head = input.readFirstBytes();
  if (hasNulByte(head.subarray(0, BINARY_CHECK_BYTES))) {
    return 'binary';
  }
  const { maxLineLength, meanLineLength } = computeLineLengthStats(input.readFullText());
  if (maxLineLength > MINIFIED_MAX_LINE_LENGTH || meanLineLength > MINIFIED_MEAN_LINE_LENGTH) {
    return 'minified';
  }
  return null;
}
