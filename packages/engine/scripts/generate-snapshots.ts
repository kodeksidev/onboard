/**
 * @onboard/engine — (re)generates `test/__snapshots__/<fixture>.snap.json`
 * from a cold `analyze()` run over each of the 5 vendored fixtures (Section
 * 11: "Snapshots store the full AnalysisResult, never the AnalysisEnvelope").
 *
 * Run with: bun run scripts/generate-snapshots.ts
 * Re-run this deliberately when a Phase 4+ change legitimately changes a
 * fixture's expected output — never hand-edit a snapshot file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stableStringify } from '@onboard/contract';
import { analyze } from '../src/analyze';
import { normalizeForSnapshot } from '../test/snapshot-identity';

const ROOT = join(import.meta.dir, '..');
const GRAMMARS_DIR = join(ROOT, 'grammars');
const FIXTURES_DIR = join(ROOT, 'fixtures');
const SNAPSHOTS_DIR = join(ROOT, 'test', '__snapshots__');

const FIXTURES = ['node-express', 'react-app', 'python-flask', 'mixed-monorepo', 'kitchen-sink'] as const;

async function main(): Promise<void> {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  for (const fixture of FIXTURES) {
    const result = await analyze({
      repoRootAbs: join(FIXTURES_DIR, fixture),
      grammarsDir: GRAMMARS_DIR,
      engineVersion: '0.0.0-snapshot',
    });
    const outPath = join(SNAPSHOTS_DIR, `${fixture}.snap.json`);
    // stableStringify (not JSON.stringify) so the committed file itself uses
    // the same canonical, sorted-key form the fingerprint is computed over.
    // normalizeForSnapshot so it carries no trace of THIS machine's checkout
    // path — otherwise the file only ever matches here.
    writeFileSync(outPath, `${stableStringify(normalizeForSnapshot(result))}\n`);
    console.log(`wrote ${outPath}`);
  }
}

await main();
