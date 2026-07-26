/**
 * @onboard/engine — compiles `src/main.ts` into the four `onboard-engine-*`
 * sidecar binaries Tauri's `resolve_sidecar_path` expects (Section 9 Phase
 * 5/6). Cross-compiles all four target triples from this one runner via
 * `Bun.build({ compile: { target } })` (`bun build --compile --target=`
 * under the hood) — no target-specific toolchain is required.
 *
 * Emits to `packages/engine/dist/` ONLY. This deliberately does NOT write
 * into `apps/desktop/**` — the coordinator copies these into
 * `apps/desktop/src-tauri/binaries/` themselves (Phase 5 instructions).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ENTRYPOINT = join(import.meta.dir, '..', 'src', 'main.ts');
const OUT_DIR = join(import.meta.dir, '..', 'dist');

interface SidecarTarget {
  readonly bunTarget: 'bun-windows-x64' | 'bun-darwin-arm64' | 'bun-darwin-x64' | 'bun-linux-x64';
  /** Tauri's `<name>-<target-triple>[.exe]` convention (Section 7/9). */
  readonly outfileName: string;
}

const SIDECAR_TARGETS: readonly SidecarTarget[] = [
  { bunTarget: 'bun-windows-x64', outfileName: 'onboard-engine-x86_64-pc-windows-msvc.exe' },
  { bunTarget: 'bun-darwin-arm64', outfileName: 'onboard-engine-aarch64-apple-darwin' },
  { bunTarget: 'bun-darwin-x64', outfileName: 'onboard-engine-x86_64-apple-darwin' },
  { bunTarget: 'bun-linux-x64', outfileName: 'onboard-engine-x86_64-unknown-linux-gnu' },
];

async function buildOne(target: SidecarTarget): Promise<void> {
  const outfile = join(OUT_DIR, target.outfileName);
  const result = await Bun.build({
    entrypoints: [ENTRYPOINT],
    compile: { target: target.bunTarget, outfile },
  });
  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join('\n');
    throw new Error(`build-sidecar: failed for ${target.bunTarget} (${outfile}):\n${messages}`);
  }
  console.log(`built ${target.outfileName}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  // Sequential by design: clear per-target progress output, one target at a time.
  for (const target of SIDECAR_TARGETS) {
    await buildOne(target);
  }
  console.log(`all ${String(SIDECAR_TARGETS.length)} sidecar binaries written to ${OUT_DIR}`);
}

await main();
