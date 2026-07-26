/**
 * @onboard/engine — `engine.analyze` RPC method (Section 7.3, Section 8.1).
 */
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EngineAnalyzeParams, EngineAnalyzeResult, EngineProgress } from '@onboard/contract';
import { analyzeWithTimings, type PhaseTimingSink } from '../analyze';
import type { CacheStore } from '../cache/cache-store';
import { MAX_REPO_FILES } from '../constants';
import { KEYWORD_MAP, loadUserKeywordMap, mergeKeywordMaps } from '../search/keyword-map';
import { computeRepoId } from '../util/hash';
import { posixBasename, toPosixPath } from '../util/posix-path';
import { RepoTooLargeError } from '../walk/walk';
import { domainError } from './domain-error';
import {
  notADirectoryMessage,
  noSupportedFilesMessage,
  permissionDeniedMessage,
  pathNotFoundMessage,
  repoTooLargeMessage,
} from './error-copy';
import type { RepoSession, SessionStore } from './session-store';

const SUPPORTED_LANGUAGES: ReadonlySet<string> = new Set(['ts', 'tsx', 'js', 'jsx', 'py']);

function repoDisplayName(repoPath: string): string {
  return posixBasename(toPosixPath(repoPath));
}

function mapFsError(error: unknown, repoPath: string): Error {
  const name = repoDisplayName(repoPath);
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ENOENT') {
    const { message, detail } = pathNotFoundMessage(name);
    return domainError('E_PATH_NOT_FOUND', message, detail, repoPath);
  }
  if (code === 'EACCES' || code === 'EPERM') {
    const { message, detail } = permissionDeniedMessage(name);
    return domainError('E_PERMISSION_DENIED', message, detail, repoPath);
  }
  if (code === 'ENOTDIR') {
    const { message, detail } = notADirectoryMessage(name);
    return domainError('E_NOT_A_DIRECTORY', message, detail, repoPath);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Resolves and validates `repoPath` up front, so analyze-pipeline crashes are distinguishable from input errors. */
function validateRepoRoot(repoPath: string): string {
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(repoPath);
  } catch (error) {
    throw mapFsError(error, repoPath);
  }
  let isDirectory: boolean;
  try {
    isDirectory = statSync(canonicalRoot).isDirectory();
  } catch (error) {
    throw mapFsError(error, repoPath);
  }
  if (!isDirectory) {
    const { message, detail } = notADirectoryMessage(repoDisplayName(repoPath));
    throw domainError('E_NOT_A_DIRECTORY', message, detail, repoPath);
  }
  return canonicalRoot;
}

function cacheDbFilePath(appDataDir: string, repoId: string): string {
  return join(appDataDir, 'onboard', 'cache', `${repoId}.sqlite`);
}

/**
 * `<appConfigDir>/onboard/keywords.json` (Section 8.7's user keyword-map
 * extension point). The frozen `EngineAnalyzeParams` schema only carries
 * `appDataDir`, not a separate app-config-dir — this resolves the keywords
 * file relative to the same directory as a documented simplification (see
 * `docs/DECISIONS.md`), flagged for rust-tauri to confirm or override with
 * a real config-dir path if their OS convention keeps the two separate.
 */
function resolveKeywordMap(appDataDir: string): ReturnType<typeof mergeKeywordMaps> {
  const keywordsPath = join(appDataDir, 'onboard', 'keywords.json');
  const readFile = (p: string): string | null => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  };
  return mergeKeywordMaps(KEYWORD_MAP, loadUserKeywordMap(keywordsPath, readFile));
}

function deleteCacheFilesForForceRefresh(dbFilePath: string): void {
  ['', '-wal', '-shm'].forEach((suffix) => {
    rmSync(`${dbFilePath}${suffix}`, { force: true });
  });
}

function hasSupportedFiles(files: readonly { readonly language: string }[]): boolean {
  return files.some((f) => SUPPORTED_LANGUAGES.has(f.language));
}

export interface AnalyzeMethodDeps {
  readonly grammarsDir: string;
  readonly engineVersion: string;
  readonly createCacheStore: (dbFilePath: string) => CacheStore;
  readonly onProgress: (progress: EngineProgress) => void;
  readonly sessions: SessionStore;
  /** Section 11 bench investigation's diagnostic timing sink — see `analyze.ts`'s doc comment. */
  readonly onPhaseTiming?: PhaseTimingSink;
}

export async function runAnalyzeMethod(params: EngineAnalyzeParams, deps: AnalyzeMethodDeps): Promise<EngineAnalyzeResult> {
  const canonicalRoot = validateRepoRoot(params.repoPath);
  const repoId = computeRepoId(canonicalRoot);
  const dbFilePath = cacheDbFilePath(params.appDataDir, repoId);
  mkdirSync(dirname(dbFilePath), { recursive: true });
  if (params.isForceRefresh) {
    deleteCacheFilesForForceRefresh(dbFilePath);
  }
  const cacheStore = deps.createCacheStore(dbFilePath);

  const envelope = await runAnalyzePipeline(params, deps, cacheStore);
  if (!hasSupportedFiles(envelope.result.files)) {
    cacheStore.close();
    const { message, detail } = noSupportedFilesMessage();
    throw domainError('E_NO_SUPPORTED_FILES', message, detail, params.repoPath);
  }

  // `analyze()` itself now writes `analysis_result` (see `analyze.ts`'s
  // `persistAnalysisResultIfChanged` doc comment) — moved there from this
  // method specifically so `scripts/verify-determinism.ts` and any other
  // direct `analyze()` caller can exercise Section 11's warm fast path
  // too, not just the RPC sidecar. Nothing left to do here.
  const session: RepoSession = {
    canonicalRoot,
    cacheStore,
    analysisResult: envelope.result,
    keywordMap: resolveKeywordMap(params.appDataDir),
  };
  deps.sessions.set(repoId, session);

  return { result: envelope.result, engineVersion: deps.engineVersion, timings: envelope.timings };
}

async function runAnalyzePipeline(
  params: EngineAnalyzeParams,
  deps: AnalyzeMethodDeps,
  cacheStore: CacheStore,
): ReturnType<typeof analyzeWithTimings> {
  try {
    return await analyzeWithTimings({
      repoRootAbs: params.repoPath,
      grammarsDir: deps.grammarsDir,
      engineVersion: deps.engineVersion,
      cacheStore,
      excludeGlobs: params.excludeGlobs,
      onProgress: deps.onProgress,
      ...(deps.onPhaseTiming === undefined ? {} : { onPhaseTiming: deps.onPhaseTiming }),
    });
  } catch (error) {
    cacheStore.close();
    if (error instanceof RepoTooLargeError) {
      const { message, detail } = repoTooLargeMessage(error.fileCount, MAX_REPO_FILES);
      throw domainError('E_REPO_TOO_LARGE', message, detail, params.repoPath);
    }
    throw mapFsError(error, params.repoPath);
  }
}
