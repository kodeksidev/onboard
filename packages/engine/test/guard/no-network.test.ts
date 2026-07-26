import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const FIXTURE = join(import.meta.dir, 'fixtures', 'try-network.ts');

interface FixtureRun {
  readonly stdout: string;
  readonly exitCode: number;
}

async function runFixture(): Promise<FixtureRun> {
  const proc = Bun.spawn([process.execPath, 'run', FIXTURE], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

describe('installNoNetworkGuard — runs at import time, in a subprocess so it never poisons the shared test process', () => {
  test('blocks fetch()', async () => {
    const { stdout, exitCode } = await runFixture();
    expect(exitCode).toBe(0);
    expect(stdout).toContain('PASS:fetch');
  });

  test('blocks every net/http/https/tls/dgram/dns entry point exercised', async () => {
    const { stdout } = await runFixture();
    expect(stdout).toContain('PASS:net.connect');
    expect(stdout).toContain('PASS:http.get');
    expect(stdout).toContain('PASS:https.get');
    expect(stdout).toContain('PASS:tls.connect');
    expect(stdout).toContain('PASS:dgram.createSocket');
    expect(stdout).toContain('PASS:dns.lookup');
  });

  test('reports zero FAIL lines', async () => {
    const { stdout } = await runFixture();
    expect(stdout).not.toContain('FAIL:');
  });
});
