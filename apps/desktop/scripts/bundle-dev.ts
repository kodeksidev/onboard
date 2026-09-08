/**
 * `bun run bundle:dev` — build a LOCAL test installer that cannot be confused
 * with a published release.
 *
 * Three times a stale artefact has cost a review round: the July sidecar, the
 * v0.1.3-vs-v0.1.4 confusion, and a local build of `0.1.4` tested against the
 * published `0.1.4` from the release page. The version string was identical in
 * both, so there was nothing to check AFTER installing — the mistake was
 * invisible by construction, and "verify the hash first" only helps someone
 * who already suspects a problem.
 *
 * So a local build stamps the commit into the version: `0.1.4-dev.<sha>`.
 * That changes the installer FILENAME and the version the app reports in
 * Settings, which makes "which build is this?" answerable at a glance, before
 * and after installation. `bun run bundle` is untouched and still produces the
 * release artefact.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function git(...args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

const sha = git('rev-parse', '--short=7', 'HEAD');
if (sha === '') {
  console.error('REFUSING: could not read HEAD. A dev build must be able to name the commit it came from.');
  process.exit(1);
}

const isDirty = git('status', '--porcelain') !== '';
// A dirty tree is not a commit. Saying `-dev.<sha>` when the build contains
// uncommitted changes would be a more convincing lie than saying nothing.
const version = `0.1.4-dev.${sha}${isDirty ? '.dirty' : ''}`;

console.log(`bundle:dev — version ${version}${isDirty ? '  (WORKING TREE IS DIRTY)' : ''}`);

const bundles = process.argv.includes('--bundles')
  ? process.argv[process.argv.indexOf('--bundles') + 1]
  : 'nsis';

// `--config` is given a FILE, never an inline JSON string: through a Windows
// shell the quotes are stripped and tauri receives `{version:0.1.4-dev.abc}`,
// which is not JSON. A file has no quoting to lose.
const configDir = mkdtempSync(join(tmpdir(), 'onboard-bundle-dev-'));
const configPath = join(configDir, 'version.json');
writeFileSync(configPath, JSON.stringify({ version }), 'utf8');

try {
  const build = spawnSync(
    'bun',
    ['run', 'tauri', 'build', '--bundles', bundles ?? 'nsis', '--config', configPath],
    { stdio: 'inherit', shell: true },
  );
  process.exit(build.status ?? 1);
} finally {
  rmSync(configDir, { recursive: true, force: true });
}
