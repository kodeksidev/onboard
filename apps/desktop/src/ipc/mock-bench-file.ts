/**
 * A synthetic 20,000-line file, served only by `mock-ipc.ts`'s
 * `readRepoFile` for a reserved sentinel path. Section 9 Phase 10's gate
 * ("a 20,000-line fixture file renders in <= 400 ms") needs a file at that
 * scale; `sample-analysis.json` is a deliberately small, hand-authored
 * 24-file fixture (Phase 1) with no file anywhere near that size, and nothing
 * about the frozen fixture may change to accommodate a Phase 10 benchmark.
 * Generated deterministically (no randomness) so the content — and
 * therefore the render — is identical on every run.
 */
export const BENCH_LARGE_FILE_PATH = 'bench/synthetic-20000-lines.ts';
export const BENCH_LARGE_FILE_LINE_COUNT = 20_000;

export function buildBenchLargeFileContent(lineCount: number = BENCH_LARGE_FILE_LINE_COUNT): string {
  const lines = Array.from({ length: lineCount }, (_unused, index) => {
    const lineNumber = index + 1;
    return `export const syntheticValue${lineNumber} = ${lineNumber}; // deterministic bench line ${lineNumber}`;
  });
  return lines.join('\n');
}
