/**
 * @onboard/contract — newline-delimited framing for the Section 7.3 stdio
 * transport.
 *
 * This lives in the contract package because framing IS the contract:
 * `rpc.ts`'s own header defines the transport as "Newline-delimited JSON-RPC
 * 2.0 over stdio between the Rust shell and the engine sidecar." A reader
 * that disagrees about where one frame ends is as much a contract violation
 * as a reader that disagrees about a field's type. `stable-stringify.ts` is
 * the existing precedent for non-schema runtime code here; no schema is
 * touched by this module.
 *
 * ## Why there is exactly one implementation
 *
 * There were two. `packages/engine/src/rpc/server.ts` had this one (correct,
 * after a Phase 11 fix) and `apps/desktop/bench/support/engine-rpc-client.ts`
 * had a hand-rolled copy that re-scanned the accumulated buffer from index 0
 * on every chunk — quadratic in a single line's length. The divergence, not
 * the missing `scanFrom`, was the defect: a patch to the copy would have left
 * two implementations free to drift apart again. `line-framing.guard.test.ts`
 * fails if a third appears.
 *
 * ## The cost model
 *
 * A JSON-RPC message is never guaranteed to arrive in one `read()` chunk, or
 * to be alone in one, so this buffers across chunks. `scanFrom` tracks how
 * much of `buffer` is already confirmed newline-free, so each `indexOf` scans
 * only the newly-appended tail. Without it, one large single-line message —
 * a 10,000-file `AnalysisResult` is tens of megabytes on ONE line — arriving
 * across many small chunks costs O(n^2) in the line's total length. Measured,
 * not hypothesised: 19,234.8 ms to reassemble a 4 MB line from 50,000 chunks
 * before the engine-side fix.
 */

/**
 * Optional instrumentation for the framing cost model.
 *
 * `charsScanned` counts the characters each `indexOf` call actually examines.
 * This is what makes the complexity of this reader a DETERMINISTIC assertion
 * instead of a wall-clock one: for a correct implementation `charsScanned`
 * stays within a small constant factor of `charsReceived` no matter how the
 * bytes are chunked, and for an accumulate-and-re-scan implementation it
 * grows quadratically. A timing assertion would be flaky and would eventually
 * get excluded from the default suite the way the Phase 10 perf gate was;
 * a counter is exact on every machine.
 */
export interface FramingStats {
  /** Characters appended to the buffer across all chunks. */
  charsReceived: number;
  /** Characters examined by newline searches. */
  charsScanned: number;
  /** Complete frames yielded. */
  framesYielded: number;
}

/** A zeroed stats object, so callers never have to remember the field names. */
export function createFramingStats(): FramingStats {
  return { charsReceived: 0, charsScanned: 0, framesYielded: 0 };
}

/**
 * Yields newline-delimited frames from a byte stream.
 *
 * Pass `stats` to record the cost model above; omit it in production, where
 * the three counter increments are the entire overhead.
 */
export async function* readLines(
  stream: ReadableStream<Uint8Array>,
  stats?: FramingStats,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let scanFrom = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      if (stats !== undefined) {
        stats.charsReceived += chunk.length;
      }

      let newlineIndex = indexOfNewline(buffer, scanFrom, stats);
      while (newlineIndex !== -1) {
        yield buffer.slice(0, newlineIndex);
        if (stats !== undefined) {
          stats.framesYielded += 1;
        }
        buffer = buffer.slice(newlineIndex + 1);
        scanFrom = 0;
        newlineIndex = indexOfNewline(buffer, scanFrom, stats);
      }
      scanFrom = buffer.length;
    }
  } finally {
    reader.releaseLock();
  }
  if (buffer.length > 0) {
    if (stats !== undefined) {
      stats.framesYielded += 1;
    }
    yield buffer;
  }
}

/**
 * `buffer.indexOf('\n', from)`, plus an exact account of the characters that
 * search examined: `[from, match]` when it finds one, `[from, end)` when it
 * does not. Keeping the accounting in the same function as the search is
 * deliberate — a future edit cannot change the scan without the counter
 * moving with it.
 */
function indexOfNewline(buffer: string, from: number, stats?: FramingStats): number {
  const found = buffer.indexOf('\n', from);
  if (stats !== undefined) {
    const examinedThrough = found === -1 ? buffer.length : found + 1;
    stats.charsScanned += Math.max(0, examinedThrough - from);
  }
  return found;
}
