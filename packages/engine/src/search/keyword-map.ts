/**
 * @onboard/engine — `KEYWORD_MAP` (Section 8.7): a frozen concept -> related
 * terms table used to expand a search query (e.g. "auth" also searches
 * "session", "jwt", "oauth", ...).
 *
 * Users extend it via `<appConfigDir>/onboard/keywords.json` (same shape),
 * merged at query time with user entries taking precedence on key collision
 * (`mergeKeywordMaps`). The engine never reads that file path itself — the
 * Rust shell resolves the OS-specific `appConfigDir` and hands the engine an
 * already-resolved file path (the same pattern as `--grammars-dir`, Section
 * 14's known-hard-part 1), which `rpc/methods.ts` reads via `loadUserKeywordMap`.
 */

export type KeywordMap = Readonly<Record<string, readonly string[]>>;

/** The 15 concept sets Section 8.7 names "at minimum." */
export const KEYWORD_MAP: KeywordMap = Object.freeze({
  auth: ['auth', 'login', 'logout', 'session', 'token', 'jwt', 'oauth', 'credential', 'signin', 'authenticate', 'authorize', 'permission'],
  payment: ['payment', 'pay', 'stripe', 'checkout', 'invoice', 'billing', 'charge', 'subscription', 'refund'],
  database: ['db', 'database', 'sql', 'query', 'orm', 'prisma', 'sequelize', 'sqlalchemy', 'migration', 'schema', 'repository'],
  routing: ['route', 'router', 'endpoint', 'path', 'url', 'handler', 'controller', 'view'],
  config: ['config', 'settings', 'env', 'environment', 'options', 'dotenv'],
  logging: ['log', 'logger', 'logging', 'winston', 'pino', 'tracing', 'telemetry'],
  cache: ['cache', 'redis', 'memcached', 'ttl', 'invalidate'],
  email: ['email', 'mail', 'smtp', 'sendgrid', 'ses', 'mailer', 'template'],
  upload: ['upload', 'file', 'multipart', 's3', 'storage', 'blob', 'attachment'],
  i18n: ['i18n', 'locale', 'translation', 'intl', 'language', 'translate'],
  permissions: ['permission', 'role', 'rbac', 'acl', 'policy', 'scope', 'grant'],
  queue: ['queue', 'job', 'worker', 'task', 'celery', 'bull', 'cron', 'schedule'],
  websocket: ['websocket', 'ws', 'socket', 'realtime', 'subscribe', 'publish'],
  testing: ['test', 'spec', 'mock', 'fixture', 'stub', 'assert'],
  error: ['error', 'exception', 'throw', 'catch', 'handler', 'fallback', 'retry'],
});

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Parses a `keywords.json`-shaped blob defensively; anything malformed is dropped, never thrown. */
export function parseUserKeywordMap(content: string): KeywordMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const result: Record<string, readonly string[]> = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
    if (isStringArray(value)) {
      result[key] = value;
    }
  });
  return result;
}

/** Reads and parses a user's `keywords.json`, returning `{}` when absent or unreadable. */
export function loadUserKeywordMap(path: string | null, readFile: (p: string) => string | null): KeywordMap {
  if (path === null) {
    return {};
  }
  const content = readFile(path);
  return content === null ? {} : parseUserKeywordMap(content);
}

/** Merges a user's keyword map over the base map — user entries win on key collision (whole-array replace). */
export function mergeKeywordMaps(base: KeywordMap, userOverrides: KeywordMap): KeywordMap {
  return Object.freeze({ ...base, ...userOverrides });
}
