/**
 * Drift guard for `MODULE_MIN_FILES`.
 *
 * The UI needs the engine's module threshold to explain WHY the Module map is
 * empty ("modules are directories with at least N analysed files"). It cannot
 * import it: `packages/engine` is the sidecar's own package and is not a
 * dependency of `apps/desktop` — only `@onboard/contract` is shared, and the
 * threshold is not part of the frozen contract.
 *
 * So the value is transcribed, and a transcribed constant is a lie waiting to
 * happen: change it to 4 in the engine and the UI keeps telling users "at
 * least 3", confidently and wrongly, with every test still green.
 *
 * This test reads the engine's own source and asserts the two agree. It fails
 * loudly the moment they diverge, which is the whole point — the copy is only
 * trustworthy if something enforces that it matches the rule it describes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MODULE_MIN_FILES } from './module-empty-state';

// Vitest runs with cwd = apps/desktop. `import.meta.url` is not a file: URL
// under the jsdom environment, so resolve from cwd instead.
const ENGINE_CONSTANTS = resolve(process.cwd(), '..', '..', 'packages', 'engine', 'src', 'constants.ts');

describe('MODULE_MIN_FILES drift guard', () => {
  test('the UI copy threshold still matches the engine constant it describes', () => {
    // Arrange — a wrong path must fail the test, never silently skip it.
    expect(
      existsSync(ENGINE_CONSTANTS),
      `engine constants not found at ${ENGINE_CONSTANTS} — this guard would otherwise pass without checking anything`,
    ).toBe(true);
    const source = readFileSync(ENGINE_CONSTANTS, 'utf8');

    // Act
    const match = /export const MODULE_MIN_FILES\s*=\s*(\d+)/.exec(source);

    // Assert — fail loudly if the constant was renamed or removed, rather than
    // silently skipping and leaving the UI copy unverified.
    expect(
      match,
      'MODULE_MIN_FILES not found in packages/engine/src/constants.ts — was it renamed? ' +
        'This guard must be updated, not deleted: without it the UI can claim a threshold the engine no longer uses.',
    ).not.toBeNull();

    const engineValue = Number(match?.[1]);
    expect(engineValue).toBeGreaterThan(0);
    expect(
      MODULE_MIN_FILES,
      `UI says modules need ${String(MODULE_MIN_FILES)} files, engine uses ${String(engineValue)}. ` +
        'The Module map empty state would state a threshold the engine does not apply.',
    ).toBe(engineValue);
  });
});
