import { describe, expect, test } from 'bun:test';
import { readExecutableHeader } from '../../scripts/lib/executable-header';

/**
 * Non-vacuity for the sidecar build gate. `build:sidecar` emits four artefacts
 * and executes exactly one — the host's. For the other three the gate used to
 * assert only that a file existed at the expected path, which is the "reports
 * without holding" shape: three names, zero verification.
 *
 * It now reads each artefact's real container format and architecture. These
 * tests prove that reader distinguishes what it claims to, on synthetic headers
 * rather than 90 MB binaries, so a cross-compile that silently produced the
 * host's format cannot pass as the target's.
 */
function elf(machine: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46]);
  new DataView(bytes.buffer).setUint16(18, machine, true);
  return bytes;
}

function machO(cputype: number): Uint8Array {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0xfeedfacf, true);
  view.setUint32(4, cputype, true);
  return bytes;
}

function pe(machine: number, peOffset = 0x80): Uint8Array {
  const bytes = new Uint8Array(1024);
  bytes.set([0x4d, 0x5a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x3c, peOffset, true);
  // A real DOS stub can declare an offset past the bytes a reader sampled.
  // Writing there would throw here, so the truncated case simply leaves the
  // COFF header absent — which is exactly the state the reader must survive.
  if (peOffset + 6 <= bytes.byteLength) {
    view.setUint32(peOffset, 0x00004550, true);
    view.setUint16(peOffset + 4, machine, true);
  }
  return bytes;
}

describe('the sidecar gate can tell the four target artefacts apart', () => {
  test.each([
    ['elf/x86_64', elf(0x3e), 'elf', 'x86_64'],
    ['elf/arm64', elf(0xb7), 'elf', 'arm64'],
    ['macho/x86_64', machO(0x01000007), 'macho', 'x86_64'],
    ['macho/arm64', machO(0x0100000c), 'macho', 'arm64'],
    ['pe/x86_64', pe(0x8664), 'pe', 'x86_64'],
    ['pe/arm64', pe(0xaa64), 'pe', 'arm64'],
  ] as const)('reads %s from the header', (_label, bytes, format, arch) => {
    expect(readExecutableHeader(bytes)).toEqual({ format, arch });
  });

  test('a Linux binary is not mistaken for the darwin artefact it sits next to', () => {
    // The exact confusion the gate exists to catch: `build:sidecar` cross-
    // compiling on the wrong host and emitting the host's format under a
    // darwin filename.
    const linux = readExecutableHeader(elf(0x3e));

    expect(linux.format).not.toBe('macho');
  });

  test('the two darwin targets are distinguished from each other', () => {
    // Both are Mach-O; only cputype separates them. A reader that stopped at
    // the magic number would pass every test above and still let an x86_64
    // build ship as aarch64.
    expect(readExecutableHeader(machO(0x0100000c)).arch).toBe('arm64');
    expect(readExecutableHeader(machO(0x01000007)).arch).toBe('x86_64');
  });

  test('a truncated PE reports an unknown architecture rather than guessing', () => {
    // peOffset points past the bytes actually read.
    expect(readExecutableHeader(pe(0x8664, 4000))).toEqual({ format: 'pe', arch: null });
  });

  test('random bytes are not identified as any known format', () => {
    expect(readExecutableHeader(new Uint8Array(64).fill(0x41))).toEqual({
      format: 'unknown',
      arch: null,
    });
  });
});
