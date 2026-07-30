/**
 * Runs every stage of a `&&` chain from package.json, then aggregates the verdict.
 *
 * `verify` is a `&&` chain, so it stops at the first failure. That is right
 * locally: a developer wants the first error, fast. It is wrong in CI. A single
 * ESLint bug produced a run that reported nothing about typecheck, contract
 * drift, determinism, coverage or the test suite on ANY platform — three OSes
 * of compute spent to re-learn one fact the first job had already given us.
 *
 * This runs the same stages, in the same order, without stopping, and exits
 * non-zero if any of them failed. Nothing is weakened: a failing stage still
 * fails the job. The difference is that the other stages get to report first.
 *
 * The stage list is DERIVED by splitting the named chain out of `package.json`,
 * never restated here — a hand-copied list is one edit away from a CI job that
 * silently checks less than `verify` does while still being called `verify`.
 *
 * The chain is named on the command line rather than hardcoded so the
 * dependency stays visible to static readers: `scripts/ci-python-check.py`
 * derives which jobs need an interpreter by reading `bun run` invocations out
 * of `package.json`, and a chain resolved only at runtime would be invisible
 * to it — the job would quietly stop being covered.
 *
 * Run: `bun run verify:report`
 */
import { join } from 'node:path';

import { $ } from 'bun';

// `import.meta.dir`, not a `file://` URL pathname: on Windows the latter yields
// `/C:/...` with this repository's space percent-encoded, which no syscall
// accepts. Section 10's space-in-path requirement applies to this script too.
const REPO_ROOT = join(import.meta.dir, '..');
const PACKAGE_JSON = Bun.file(join(REPO_ROOT, 'package.json'));

/** A chain shorter than this cannot be a verify chain; treat it as a parse failure. */
const MIN_STAGES = 2;

const RULE = '-'.repeat(60);

interface StageOutcome {
  readonly stage: string;
  readonly exitCode: number;
}

/** Thrown when the chain cannot be derived; the message is the operator-facing reason. */
class DerivationError extends Error {}

async function stagesOf(chainName: string): Promise<string[]> {
  const manifest = (await PACKAGE_JSON.json()) as { scripts?: Record<string, string> };
  const chain = manifest.scripts?.[chainName];

  if (!chain) {
    throw new DerivationError(`package.json has no \`${chainName}\` script to derive stages from`);
  }

  const stages = chain
    .split('&&')
    .map((stage) => stage.trim())
    .filter((stage) => stage.length > 0);

  if (stages.length < MIN_STAGES) {
    throw new DerivationError(
      `derived ${stages.length} stage(s) from \`${chainName}\` — the split is broken`,
    );
  }

  return stages;
}

async function runStages(stages: readonly string[]): Promise<StageOutcome[]> {
  const outcomes: StageOutcome[] = [];

  for (const stage of stages) {
    console.log(`\n=== ${stage} ===`);
    const { exitCode } = await $`${{ raw: stage }}`.cwd(REPO_ROOT).nothrow();
    outcomes.push({ stage, exitCode });
    console.log(`=== ${stage} -> ${exitCode === 0 ? 'PASS' : `FAIL (${exitCode})`} ===`);
  }

  return outcomes;
}

function report(outcomes: readonly StageOutcome[]): number {
  console.log(`\n${RULE}\nverify:report summary`);
  for (const { stage, exitCode } of outcomes) {
    console.log(`  ${exitCode === 0 ? 'PASS' : 'FAIL'}  ${stage}`);
  }
  console.log(RULE);

  const failed = outcomes.filter((outcome) => outcome.exitCode !== 0);
  if (failed.length === 0) {
    console.log('\nall stages passed');
    return 0;
  }

  console.error(
    `\n${failed.length} of ${outcomes.length} stage(s) failed: ` +
      failed.map((outcome) => outcome.stage).join(', '),
  );
  return 1;
}

async function main(): Promise<number> {
  const chainName = process.argv[2];
  if (!chainName) {
    console.error('REFUSING: no chain named — usage: run-verify-stages.ts <script-name>');
    return 1;
  }

  let stages: string[];
  try {
    stages = await stagesOf(chainName);
  } catch (error: unknown) {
    if (error instanceof DerivationError) {
      console.error(`REFUSING: ${error.message}`);
      return 1;
    }
    throw error;
  }

  console.log(`verify:report — ${stages.length} stage(s) derived from \`${chainName}\``);
  return report(await runStages(stages));
}

process.exit(await main());
