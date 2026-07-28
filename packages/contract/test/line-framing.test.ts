import { describe, expect, test } from 'bun:test';
import { createFramingStats, readLines, type FramingStats } from '../src/line-framing';

/**
 * Builds a stream that delivers `text` in fixed-size chunks — the shape that
 * makes the quadratic bug appear. One 4 MB JSON-RPC line does not arrive in
 * one `read()`; it arrives across tens of thousands of small ones.
 */
function chunkedStream(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

async function drain(
  stream: ReadableStream<Uint8Array>,
  stats?: FramingStats,
): Promise<readonly string[]> {
  const frames: string[] = [];
  for await (const frame of readLines(stream, stats)) {
    frames.push(frame);
  }
  return frames;
}

describe('readLines framing', () => {
  test('reassembles one large line split across many chunks', async () => {
    const line = 'x'.repeat(100_000);
    const frames = await drain(chunkedStream(`${line}\n`, 80));
    expect(frames).toEqual([line]);
  });

  test('splits multiple frames arriving in a single chunk', async () => {
    const frames = await drain(chunkedStream('a\nb\nc\n', 1024));
    expect(frames).toEqual(['a', 'b', 'c']);
  });

  test('yields a trailing unterminated frame', async () => {
    const frames = await drain(chunkedStream('a\nb', 1024));
    expect(frames).toEqual(['a', 'b']);
  });

  test('handles a multi-byte character split across a chunk boundary', async () => {
    // The stream is chunked by BYTES, so a 4-byte emoji can be cut in half.
    // TextDecoder({ stream: true }) is what holds the partial sequence.
    const frames = await drain(chunkedStream('héllo 🌍 wörld\n', 3));
    expect(frames).toEqual(['héllo 🌍 wörld']);
  });
});

/**
 * The complexity gate.
 *
 * Deliberately a COUNTER, not a stopwatch. Section 9 Phase 10's render gate
 * was excluded from the default suite because a wall-clock assertion was
 * flaky under CPU contention; that exclusion then meant it never ran in CI at
 * all. A scanned-character count is exact and identical on every machine, so
 * this gate can live in the default suite and stay there.
 */
describe('readLines complexity', () => {
  const LINE_BYTES = 2_000_000;
  const CHUNK_BYTES = 80;
  /**
   * A correct reader examines each character a small, bounded number of
   * times. 3x is generous headroom over the ~1x this implementation actually
   * achieves, chosen so ordinary refactors do not trip it while a return to
   * accumulate-and-re-scan misses by orders of magnitude.
   */
  const MAX_SCAN_RATIO = 3;

  test('scans a bounded multiple of the characters it receives', async () => {
    const line = 'y'.repeat(LINE_BYTES);
    const stats = createFramingStats();
    const frames = await drain(chunkedStream(`${line}\n`, CHUNK_BYTES), stats);

    expect(frames).toEqual([line]);
    expect(stats.charsReceived).toBe(LINE_BYTES + 1);
    expect(stats.framesYielded).toBe(1);
    expect(stats.charsScanned).toBeLessThanOrEqual(stats.charsReceived * MAX_SCAN_RATIO);
  });

  /**
   * Proves the assertion above is NON-VACUOUS.
   *
   * A threshold test that no realistic implementation could ever fail is
   * indistinguishable from no test. This re-implements the exact defect that
   * shipped in `apps/desktop/bench/support/engine-rpc-client.ts` — `indexOf`
   * from index 0 on every chunk, no `scanFrom` — and asserts the counter
   * catches it. The size is small enough to run in milliseconds and still
   * blow the ratio out by ~3 orders of magnitude.
   */
  test('the scan ratio detects an accumulate-and-re-scan implementation', () => {
    const chunkCount = 4_000;
    let buffer = '';
    let charsScanned = 0;
    let charsReceived = 0;

    for (let i = 0; i < chunkCount; i += 1) {
      const chunk = 'z'.repeat(CHUNK_BYTES);
      buffer += chunk;
      charsReceived += chunk.length;
      // The defect: always scans from 0, never from a confirmed offset.
      const found = buffer.indexOf('\n');
      charsScanned += found === -1 ? buffer.length : found + 1;
    }

    const brokenRatio = charsScanned / charsReceived;
    expect(brokenRatio).toBeGreaterThan(MAX_SCAN_RATIO * 100);
  });
});
