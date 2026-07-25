/**
 * @onboard/engine — cache invalidation decision (Section 6.1's invalidation rule).
 *
 * "On open, read `schema_meta`. If `cacheSchemaVersion != 1`, or
 * `engineVersion` differs from the running binary's version, or
 * `grammarFingerprint` differs ..., or `contractSchemaVersion != SCHEMA_VERSION`,
 * then delete the database file and recreate it. Never migrate ... If the
 * file is unreadable or `PRAGMA integrity_check` fails, delete and recreate."
 *
 * This module is a pure function over that rule; `sqlite-cache-store.ts`
 * does the actual file IO (existence check, `PRAGMA integrity_check`,
 * reading `schema_meta`) and calls `decideCacheInvalidation` with what it
 * found, so the decision itself stays a trivially unit-testable value.
 */
import type { CacheSchemaMeta } from './cache-store';

export type CacheInvalidationReason =
  | 'missing-or-unreadable'
  | 'integrity-check-failed'
  | 'cacheSchemaVersion-mismatch'
  | 'engineVersion-mismatch'
  | 'grammarFingerprint-mismatch'
  | 'contractSchemaVersion-mismatch';

export interface CacheInvalidationDecision {
  readonly action: 'keep' | 'recreate';
  readonly reason: CacheInvalidationReason | null;
}

const KEEP: CacheInvalidationDecision = { action: 'keep', reason: null };

function recreate(reason: CacheInvalidationReason): CacheInvalidationDecision {
  return { action: 'recreate', reason };
}

/**
 * Decides whether an existing cache database may be reused as-is.
 *
 * @param storedMeta   The four `schema_meta` values actually found in the
 *                     database, or `null` when the database is missing, its
 *                     file could not be read, or `schema_meta` itself could
 *                     not be queried (a corrupt/foreign file).
 * @param expected     The four values the currently running engine expects.
 * @param integrityOk  Result of `PRAGMA integrity_check` (`true` only when
 *                     it returned exactly `'ok'`).
 */
export function decideCacheInvalidation(
  storedMeta: Readonly<CacheSchemaMeta> | null,
  expected: Readonly<CacheSchemaMeta>,
  integrityOk: boolean,
): CacheInvalidationDecision {
  if (!integrityOk) {
    return recreate('integrity-check-failed');
  }
  if (storedMeta === null) {
    return recreate('missing-or-unreadable');
  }
  if (storedMeta.cacheSchemaVersion !== expected.cacheSchemaVersion) {
    return recreate('cacheSchemaVersion-mismatch');
  }
  if (storedMeta.engineVersion !== expected.engineVersion) {
    return recreate('engineVersion-mismatch');
  }
  if (storedMeta.grammarFingerprint !== expected.grammarFingerprint) {
    return recreate('grammarFingerprint-mismatch');
  }
  if (storedMeta.contractSchemaVersion !== expected.contractSchemaVersion) {
    return recreate('contractSchemaVersion-mismatch');
  }
  return KEEP;
}
