/**
 * @onboard/engine — `engine.snippets` RPC method (Section 7.3): "the only
 * source of text the AI path may use." Best-effort per path: an escaping,
 * missing, or unreadable path is silently omitted from `snippets` rather
 * than failing the whole batch — the caller passes paths drawn from its own
 * index, so a single stale entry should not block every other snippet. This
 * is a documented interpretive choice (Section 7.3 does not specify partial-
 * failure behavior for this method).
 */
import { readFileSync } from 'node:fs';
import type { EngineSnippetsParams, EngineSnippetsResult } from '@onboard/contract';
import { domainError } from './domain-error';
import { noAnalysisMessage } from './error-copy';
import { resolveRepoRelativePath } from './repo-path-guard';
import type { SessionStore } from './session-store';

type Snippet = EngineSnippetsResult['snippets'][number];

function buildSnippetOrNull(canonicalRoot: string, path: string, maxLinesPerFile: number, maxBytesPerFile: number): Snippet | null {
  const resolved = resolveRepoRelativePath(canonicalRoot, path);
  if (!resolved.ok) {
    return null;
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(resolved.absPath);
  } catch {
    return null;
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
  const snippets = params.paths
    .map((p) => buildSnippetOrNull(session.canonicalRoot, p, params.maxLinesPerFile, params.maxBytesPerFile))
    .filter((snippet): snippet is Snippet => snippet !== null);
  return { snippets };
}
