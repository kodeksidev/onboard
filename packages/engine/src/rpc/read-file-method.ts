/**
 * @onboard/engine — `engine.readFile` RPC method (Section 7.3).
 */
import { readFileSync, statSync } from 'node:fs';
import type { EngineReadFileParams, EngineReadFileResult } from '@onboard/contract';
import { languageForPath } from '../analyze-support';
import { MAX_VIEWER_FILE_BYTES } from '../constants';
import { countLines } from '../util/hash';
import { posixBasename } from '../util/posix-path';
import { domainError } from './domain-error';
import {
  fileTooLargeMessage,
  formatByteSizeLabel,
  noAnalysisMessage,
  pathEscapesRepoMessage,
  pathNotFoundMessage,
  permissionDeniedMessage,
} from './error-copy';
import { resolveRepoRelativePath, type ResolvedRepoPath } from './repo-path-guard';
import type { SessionStore } from './session-store';

function mapResolveFailure(reason: Exclude<ResolvedRepoPath, { ok: true }>['reason'], path: string): Error {
  if (reason === 'not-found') {
    const { message, detail } = pathNotFoundMessage(posixBasename(path));
    return domainError('E_PATH_NOT_FOUND', message, detail, path);
  }
  if (reason === 'permission-denied') {
    const { message, detail } = permissionDeniedMessage(posixBasename(path));
    return domainError('E_PERMISSION_DENIED', message, detail, path);
  }
  const { message, detail } = pathEscapesRepoMessage();
  return domainError('E_PATH_ESCAPES_REPO', message, detail, path);
}

function mapStatFailure(error: unknown, path: string): Error {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'EACCES' || code === 'EPERM') {
    const { message, detail } = permissionDeniedMessage(posixBasename(path));
    return domainError('E_PERMISSION_DENIED', message, detail, path);
  }
  const { message, detail } = pathNotFoundMessage(posixBasename(path));
  return domainError('E_PATH_NOT_FOUND', message, detail, path);
}

export function runReadFileMethod(params: EngineReadFileParams, sessions: SessionStore): EngineReadFileResult {
  const session = sessions.get(params.repoId);
  if (session === undefined) {
    const { message, detail } = noAnalysisMessage();
    throw domainError('E_NO_ANALYSIS', message, detail, null);
  }

  const resolved = resolveRepoRelativePath(session.canonicalRoot, params.path);
  if (!resolved.ok) {
    throw mapResolveFailure(resolved.reason, params.path);
  }

  let sizeBytes: number;
  try {
    sizeBytes = statSync(resolved.absPath).size;
  } catch (error) {
    throw mapStatFailure(error, params.path);
  }
  if (sizeBytes > MAX_VIEWER_FILE_BYTES) {
    const { message, detail } = fileTooLargeMessage(posixBasename(params.path), formatByteSizeLabel(sizeBytes));
    throw domainError('E_FILE_TOO_LARGE', message, detail, params.path);
  }

  const bytes = readFileSync(resolved.absPath);
  const isTruncated = bytes.length > params.maxBytes;
  const content = new TextDecoder('utf-8', { fatal: false }).decode(isTruncated ? bytes.subarray(0, params.maxBytes) : bytes);
  return {
    path: params.path,
    language: languageForPath(params.path),
    lineCount: countLines(content),
    isTruncated,
    content,
  };
}
