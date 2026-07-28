import { describe, expect, test } from 'vitest';
import { evaluateGraphOutput, shouldFailBuild } from './graph-verdict';

/**
 * The exact caveat `run-bench-graph.ts` prints on every run. Copied verbatim
 * because it is the string that broke the old detector — a paraphrase would
 * not prove anything.
 */
const CAVEAT =
  'Caveat: headless Edge normally rasterizes via SwiftShader (software), not the on-screen WebView2 compositor,\n' +
  'so a PASS above is strong evidence but a FAIL is not necessarily a real-world fail. This is also still not\n' +
  'the Tauri webview — Phase 11 bench remains authoritative.';

const ALL_PASS =
  'nodes=1000 (visible after auto-collapse=13)  constructLayout=96.9ms  firstPaint=124.1ms [budget 1500ms: PASS]  panP95=16.8ms [budget 22ms: PASS]\n' +
  'nodes=5000 (visible after auto-collapse=13)  constructLayout=70.0ms  firstPaint=83.6ms [budget 1500ms: PASS]  panP95=16.8ms [budget 33ms: PASS]';

const ONE_FAIL =
  'nodes=1000 (visible after auto-collapse=13)  firstPaint=161.1ms [budget 1500ms: PASS]  panP95=16.8ms [budget 22ms: PASS]\n' +
  'nodes=5000 (visible after auto-collapse=13)  firstPaint=180.6ms [budget 1500ms: PASS]  panP95=33.5ms [budget 33ms: FAIL]';

describe('graph budget verdict detection', () => {
  /**
   * The regression. This is the real captured output of a run in which every
   * measured budget passed; the old `/FAIL/` detector called it a failure
   * because of the caveat sentence, and — once wired to process.exitCode —
   * failed the build on a fully green bench.
   */
  test('an all-PASS run plus the caveat is not a failure', () => {
    const verdict = evaluateGraphOutput(`${ALL_PASS}\n${CAVEAT}`);
    expect(verdict.hasFail).toBe(false);
    expect(verdict.hasAnyVerdict).toBe(true);
    expect(shouldFailBuild(verdict)).toBe(false);
  });

  test('a real budget FAIL is a failure even surrounded by the same caveat', () => {
    const verdict = evaluateGraphOutput(`${ONE_FAIL}\n${CAVEAT}`);
    expect(verdict.hasFail).toBe(true);
    expect(shouldFailBuild(verdict)).toBe(true);
  });

  /** The caveat alone must be inert — this is the exact false positive. */
  test('the caveat prose on its own produces no verdict at all', () => {
    const verdict = evaluateGraphOutput(CAVEAT);
    expect(verdict.hasFail).toBe(false);
    expect(verdict.hasAnyVerdict).toBe(false);
  });

  /**
   * A harness that dies before measuring must NOT pass. "No FAIL found" and
   * "nothing was measured" are different states and only one of them is green.
   */
  test('output with no verdicts fails the build rather than passing silently', () => {
    const verdict = evaluateGraphOutput('Error: could not launch Edge\n[stderr]\nENOENT');
    expect(verdict.hasFail).toBe(false);
    expect(verdict.hasAnyVerdict).toBe(false);
    expect(shouldFailBuild(verdict)).toBe(true);
  });

  /** The word FAIL in ordinary prose, outside the verdict grammar, is not a verdict. */
  test('prose mentioning failure does not create a verdict', () => {
    const verdict = evaluateGraphOutput('This run did not FAIL anything, and failure is unlikely.');
    expect(verdict.hasFail).toBe(false);
    expect(verdict.hasAnyVerdict).toBe(false);
  });
});
