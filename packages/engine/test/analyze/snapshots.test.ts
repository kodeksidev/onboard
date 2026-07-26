import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnalysisResult, stableStringify } from '@onboard/contract';
import { findCycleOrderViolations, findSortOrderViolations } from '@onboard/contract/test/sort-order';
import { analyze } from '../../src/analyze';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');
const FIXTURES_DIR = join(import.meta.dir, '..', '..', 'fixtures');
const SNAPSHOTS_DIR = join(import.meta.dir, '..', '__snapshots__');

const FIXTURES = ['node-express', 'react-app', 'python-flask', 'mixed-monorepo', 'kitchen-sink'] as const;

function loadSnapshot(fixture: string): unknown {
  const raw = readFileSync(join(SNAPSHOTS_DIR, `${fixture}.snap.json`), 'utf8');
  return JSON.parse(raw);
}

describe('snapshot files exist for all 5 fixtures under test/__snapshots__/', () => {
  test.each(FIXTURES.map((f) => [f] as const))('%s.snap.json exists and parses as a valid AnalysisResult', (fixture) => {
    const snapshot = loadSnapshot(fixture);
    expect(() => AnalysisResult.parse(snapshot)).not.toThrow();
  });
});

describe('analyze() reproduces each fixture\'s committed snapshot exactly', () => {
  test.each(FIXTURES.map((f) => [f] as const))('%s matches its stored snapshot (stableStringify-equal)', async (fixture) => {
    const result = await analyze({
      repoRootAbs: join(FIXTURES_DIR, fixture),
      grammarsDir: GRAMMARS_DIR,
      engineVersion: '0.0.0-snapshot',
    });
    const snapshot = loadSnapshot(fixture);
    expect(stableStringify(result)).toBe(stableStringify(snapshot));
  });
});

describe('every fixture result honors the contract\'s documented array sort order', () => {
  test.each(FIXTURES.map((f) => [f] as const))('%s has zero sort-order violations', async (fixture) => {
    const result = await analyze({
      repoRootAbs: join(FIXTURES_DIR, fixture),
      grammarsDir: GRAMMARS_DIR,
      engineVersion: '0.0.0-snapshot',
    });
    expect(findSortOrderViolations(result)).toEqual([]);
    expect(findCycleOrderViolations(result)).toEqual([]);
  });
});
