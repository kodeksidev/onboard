/**
 * Decides whether a `bench:graph` run actually failed a budget.
 *
 * ## Why this is not a substring search
 *
 * It was one: `hasFail: /FAIL/.test(output)`. That matched the word "FAIL"
 * anywhere in the child process's output — including its own explanatory
 * caveat, which reads "a PASS above is strong evidence but a FAIL is not
 * necessarily a real-world fail". That sentence is printed on EVERY run, so
 * the detector returned `true` unconditionally.
 *
 * For as long as the result was computed and discarded, this was invisible.
 * The moment it was wired to `process.exitCode`, it turned a gate that never
 * fired into a gate that always fires — observed directly: a run where both
 * `panP95` rows and both `firstPaint` rows printed PASS still reported
 * "bench:graph budgets: AT LEAST ONE FAIL" and exited 1.
 *
 * A gate that always fails carries exactly as much information as one that
 * never fails, and it is worse in practice, because it teaches everyone to
 * ignore a red bench. So the detector matches only the verdict grammar the
 * graph bench actually emits — `[budget <n>ms: FAIL]` — and
 * `graph-verdict.test.ts` proves it distinguishes that from the caveat prose
 * in both directions.
 */

/**
 * A real verdict, as printed by `run-bench-graph.ts`'s `printBrowserResult`:
 * `panP95=33.5ms [budget 33ms: FAIL]`. The bracket and the `budget` keyword
 * are what separate a measured verdict from the word appearing in a sentence.
 */
const VERDICT_FAIL = /\[budget [^\]]*:\s*FAIL\]/;

/** A verdict of either polarity — used to prove the run produced verdicts at all. */
const VERDICT_ANY = /\[budget [^\]]*:\s*(?:PASS|FAIL)\]/;

export interface GraphVerdict {
  /** True only when at least one measured budget row reported FAIL. */
  readonly hasFail: boolean;
  /**
   * True when the output contained at least one budget verdict of either
   * polarity. `false` means the graph bench produced no measurements — a
   * crashed browser, a missing Edge, a thrown harness — which must never be
   * read as "nothing failed".
   */
  readonly hasAnyVerdict: boolean;
}

export function evaluateGraphOutput(output: string): GraphVerdict {
  return {
    hasFail: VERDICT_FAIL.test(output),
    hasAnyVerdict: VERDICT_ANY.test(output),
  };
}

/**
 * The gate's own question: should this fail the build?
 *
 * A measured FAIL fails. So does a run that produced NO verdicts — otherwise
 * a harness that dies before measuring anything would pass silently, which is
 * the same vacuity in a different costume.
 */
export function shouldFailBuild(verdict: GraphVerdict): boolean {
  return verdict.hasFail || !verdict.hasAnyVerdict;
}
