/**
 * @onboard/engine — reads container format and architecture out of an
 * executable's header bytes.
 *
 * Lives in its own module so it is testable: `build-sidecar.ts` runs a full
 * four-target compile at import time, so a test importing it would build ~320
 * MB of binaries to check a byte comparison.
 *
 * The point of reading the REAL header field rather than inferring from the
 * filename is that an inferred architecture agrees with whatever the target
 * table claims — which is exactly the vacuity the sidecar gate had for its
 * three non-host artefacts.
 */

export type ExecutableFormat = 'pe' | 'macho' | 'elf' | 'unknown';
export type ExecutableArch = 'x86_64' | 'arm64' | null;

export interface ExecutableHeader {
  readonly format: ExecutableFormat;
  readonly arch: ExecutableArch;
}

/** Enough bytes to reach a PE COFF header, which sits past the DOS stub. */
export const HEADER_BYTES_NEEDED = 1024;

const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];
const MACHO_64_LE_MAGIC = 0xfeedfacf;
const PE_SIGNATURE = 0x00004550; // 'PE\0\0'

function readElf(view: DataView): ExecutableHeader {
  // e_machine is a u16 at offset 18: 0x3E = x86-64, 0xB7 = aarch64.
  const machine = view.getUint16(18, true);
  return { format: 'elf', arch: machine === 0x3e ? 'x86_64' : machine === 0xb7 ? 'arm64' : null };
}

function readMachO(view: DataView): ExecutableHeader {
  // cputype is a u32 at offset 4.
  const cpu = view.getUint32(4, true);
  return { format: 'macho', arch: cpu === 0x01000007 ? 'x86_64' : cpu === 0x0100000c ? 'arm64' : null };
}

function readPe(view: DataView, byteLength: number): ExecutableHeader {
  const peOffset = view.getUint32(0x3c, true);
  if (peOffset + 6 > byteLength || view.getUint32(peOffset, true) !== PE_SIGNATURE) {
    return { format: 'pe', arch: null };
  }
  // Machine is a u16 immediately after the signature: 0x8664 = x86-64,
  // 0xAA64 = arm64.
  const machine = view.getUint16(peOffset + 4, true);
  return { format: 'pe', arch: machine === 0x8664 ? 'x86_64' : machine === 0xaa64 ? 'arm64' : null };
}

export function readExecutableHeader(head: Uint8Array): ExecutableHeader {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);

  if (ELF_MAGIC.every((byte, index) => head[index] === byte)) {
    return readElf(view);
  }
  if (head.byteLength >= 8 && view.getUint32(0, true) === MACHO_64_LE_MAGIC) {
    return readMachO(view);
  }
  if (head[0] === 0x4d && head[1] === 0x5a) {
    return readPe(view, head.byteLength);
  }
  return { format: 'unknown', arch: null };
}
