/**
 * Regression for a privacy-audit finding: `verify:no-network`'s static scan
 * matched only the DYNAMIC `import("net")` form, so a live static
 * `import { connect } from 'node:net'` sat in the emitted bundle while the
 * gate reported PASS.
 *
 * These tests build REAL bundles with Bun and scan the actual emitted text.
 * They deliberately do not assert on the gate's exit code — the original bug
 * was precisely that the exit code said PASS while the bundle said otherwise.
 *
 * The first version of this test was itself invalid: the probe exported an
 * unused function, Bun tree-shook the whole module away, and the scan passed
 * without ever being challenged. Every probe below therefore has a top-level
 * side effect and is asserted to be PRESENT in the bundle before the scan
 * result is trusted.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { findNetworkSpecifiers } from '../../src/guard/scan-bundle';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'scan-bundle-test-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** Bundles `source` as an entrypoint and returns the emitted text. */
async function bundle(source: string): Promise<string> {
  const entry = join(workDir, 'entry.ts');
  writeFileSync(entry, source, 'utf8');
  const result = await Bun.build({ entrypoints: [entry], target: 'bun', outdir: join(workDir, 'out') });
  expect(result.success).toBe(true);
  const output = result.outputs[0];
  if (output === undefined) throw new Error('Bun.build produced no output');
  return await output.text();
}

describe('findNetworkSpecifiers', () => {
  test('catches a static named import — the form the audit proved was missed', async () => {
    // Arrange: a live call at module scope, so the bundler cannot tree-shake it.
    const emitted = await bundle(
      `import { connect } from 'node:net';\nexport const probe = connect(443, 'evil.example.com');\n`,
    );

    // Assert the probe genuinely survived into the bundle BEFORE trusting the
    // scan — a tree-shaken probe would make a "no findings" result meaningless.
    expect(emitted).toContain('evil.example.com');

    // Act
    const findings = findNetworkSpecifiers(emitted);

    // Assert
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.specifier === 'net')).toBe(true);
  });

  test('catches a static default import', async () => {
    const emitted = await bundle(
      `import net from 'node:net';\nexport const probe = net.connect(443, 'evil.example.com');\n`,
    );
    expect(emitted).toContain('evil.example.com');
    expect(findNetworkSpecifiers(emitted).some((f) => f.specifier === 'net')).toBe(true);
  });

  test('catches a dynamic import (the form the original scan already handled)', async () => {
    const emitted = await bundle(
      `export const probe = import('node:dns').then((m) => m.resolve('evil.example.com'));\n`,
    );
    expect(emitted).toContain('evil.example.com');
    expect(findNetworkSpecifiers(emitted).some((f) => f.specifier === 'dns')).toBe(true);
  });

  test.each([
    ['import("net")', 'const a = import("net");'],
    ["import('https')", "const b = import('https');"],
    ['from "tls"', 'import x from "tls"; export { x };'],
    ["from'dgram'", "import y from'dgram'; export { y };"],
    ['require("http")', 'const z = require("http"); export { z };'],
    ["require( 'dns' )", "const w = require( 'dns' ); export { w };"],
  ])('matches the emitted form %s', (_label, snippet) => {
    expect(findNetworkSpecifiers(snippet).length).toBeGreaterThan(0);
  });

  test('reports nothing for a bundle with no network reference', async () => {
    const emitted = await bundle(`export const sum = (a: number, b: number): number => a + b;\n`);
    expect(findNetworkSpecifiers(emitted)).toEqual([]);
  });

  test('does not false-positive on identifiers that merely contain a specifier name', () => {
    const benign = `
      const cabinet = "net-like";
      import { networkless } from './networkless';
      export const httpsLikeName = networkless(cabinet);
      const fromNetwork = 1;
    `;
    expect(findNetworkSpecifiers(benign)).toEqual([]);
  });

  test('covers every specifier in the banned list', () => {
    for (const specifier of ['net', 'http', 'https', 'tls', 'dgram', 'dns'] as const) {
      const findings = findNetworkSpecifiers(`import x from "${specifier}";`);
      expect(findings.some((f) => f.specifier === specifier)).toBe(true);
    }
  });
});
