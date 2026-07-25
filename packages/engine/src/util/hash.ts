/**
 * @onboard/engine — hashing (Section 6.1, Section 8.1 step 3/skip rules).
 *
 * `node:crypto` is used (not `Bun.CryptoHasher`) so this module behaves
 * identically under the Bun-compiled sidecar (A9) and a future `node:sqlite`
 * npm-CLI adapter (A10) without a runtime-specific code path.
 */
import { createHash } from 'node:crypto';
import { REPO_ID_HEX_LENGTH } from '../constants';

/** Lowercase hex sha256 digest of raw bytes (or a UTF-8 string). */
export function sha256Hex(input: Uint8Array | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Lowercase hex sha1 digest. Used ONLY for `symbol.id` (Section 6.1:
 * `sha1(path + '#' + name + '#' + startLine)[:16]`) — every other hash in
 * the engine (content, repoId, fingerprint) is sha256; this is the one
 * literal exception the schema names explicitly.
 */
export function sha1Hex(input: Uint8Array | string): string {
  return createHash('sha1').update(input).digest('hex');
}

/**
 * `repoId = sha256(canonicalAbsoluteRepoPath).slice(0, 16)` (Section 6.1).
 * The caller is responsible for canonicalizing the path (realpath) before
 * calling this — this function only hashes and truncates.
 */
export function computeRepoId(canonicalAbsoluteRepoPath: string): string {
  return sha256Hex(canonicalAbsoluteRepoPath).slice(0, REPO_ID_HEX_LENGTH);
}

/**
 * Line count convention: lines are delimited by `\n` (Section 8.8's CRLF
 * rule keeps `\r` as part of the preceding line's content, not a separate
 * delimiter). An empty file has zero lines; a file whose content does not
 * end in `\n` still counts its final partial line.
 */
export function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const newlineCount = (text.match(/\n/g) ?? []).length;
  return text.endsWith('\n') ? newlineCount : newlineCount + 1;
}
