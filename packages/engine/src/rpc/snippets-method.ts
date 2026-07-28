/**
 * @onboard/engine — `engine.snippets` RPC method (Section 7.3): "the only
 * source of text the AI path may use."
 *
 * ## Why a bad path refuses the WHOLE request
 *
 * This method used to be best-effort per path: an escaping, missing, or
 * unreadable path was silently omitted from `snippets` rather than failing
 * the batch. That was a documented interpretive choice (Section 7.3 does not
 * specify partial-failure behaviour) and it was wrong in a specific,
 * traceable way.
 *
 * A dropped path produced a shorter array. Nothing anywhere compared the
 * number of paths requested against the number returned, so the shortfall
 * flowed into `redact()`, and `RedactedPayload::sent_file_count()` — which
 * counts what SURVIVED, not what was asked for — reported it as the honest
 * total. The UI then displayed "23 files sent", satisfying acceptance
 * criterion 17's "the UI displays the actual `sentFileCount`" while
 * concealing that a security refusal caused the number. The criterion was
 * met, and meeting it is what hid the refusal.
 *
 * The precedent for the fix is Section 8.9 R3: never send a partially
 * redacted payload, abort the entire request. A partially VALIDATED snippet
 * set is the same shape — a caller handed 23 of 24 snippets plus an error
 * for one will proceed with 23. So one bad path refuses the whole call, and
 * the failure is a JSON-RPC error rather than a shorter success.
 *
 * Do not "improve" this back into per-path recovery. `snippets::fetch` on
 * the Rust side additionally treats `returned.len() != requested.len()` as
 * an error, so a partial result cannot reach the AI pipeline even if this
 * method is later changed to allow one.
 *
 * No contract change: `EngineSnippetsResult` (Section 7.3) specifies only
 * the success shape, and JSON-RPC errors sit outside it in `error.data`,
 * exactly as this method's pre-existing `E_NO_ANALYSIS` already does.
 */
import { readFileSync } from 'node:fs';
import type { EngineSnippetsParams, EngineSnippetsResult } from '@onboard/contract';
import { domainError } from './domain-error';
import { noAnalysisMessage, pathEscapesRepoMessage, pathNotFoundMessage } from './error-copy';
import { resolveRepoRelativePath } from './repo-path-guard';
import type { SessionStore } from './session-store';

type Snippet = EngineSnippetsResult['snippets'][number];

function buildSnippet(
  canonicalRoot: string,
  path: string,
  maxLinesPerFile: number,
  maxBytesPerFile: number,
): Snippet {
  const resolved = resolveRepoRelativePath(canonicalRoot, path);
  if (!resolved.ok) {
    // The security refusal. Throwing rather than returning null is the whole
    // point of this change — see the module doc comment.
    const { message, detail } = pathEscapesRepoMessage();
    throw domainError('E_PATH_ESCAPES_REPO', message, detail, path);
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(resolved.absPath);
  } catch {
    // Not a security refusal — a stale index entry, or a file deleted
    // between `analyze` and now. It still refuses the whole request, so
    // `returned.len() === requested.len()` holds unconditionally on success
    // and the Rust-side invariant has no exceptions to carve out.
    const { message, detail } = pathNotFoundMessage(path);
    throw domainError('E_PATH_NOT_FOUND', message, detail, path);
  }
  const truncatedBytes = bytes.length > maxBytesPerFile ? bytes.subarray(0, maxBytesPerFile) : bytes;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(truncatedBytes);
  const lines = text.split('\n').slice(0, maxLinesPerFile);
  return { path, startLine: 1, endLine: Math.max(lines.length, 1), content: lines.join('\n') };
}

export function runSnippetsMethod(params: EngineSnippetsParams, sessions: SessionStore): EngineSnippetsResult {
  const session = sessions.get(params.repoId);
  if (session === undefined) {
    const { message, detail } = noAnalysisMessage();
    throw domainError('E_NO_ANALYSIS', message, detail, null);
  }
  // `map`, not `map`+`filter`: every requested path yields exactly one
  // snippet or throws, so the returned array length always equals the
  // requested length. That equality is what `snippets::fetch` asserts on the
  // Rust side.
  const snippets = params.paths.map((p) =>
    buildSnippet(session.canonicalRoot, p, params.maxLinesPerFile, params.maxBytesPerFile),
  );
  return { snippets };
}
