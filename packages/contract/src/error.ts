/**
 * @onboard/contract — Error envelope (end of Section 7, FROZEN at Phase 1).
 *
 * `AppError` is transcribed verbatim from the spec's closing zod block.
 * `AppErrorCode` is the full enumerated union of every `E_*` code that
 * appears in Section 7.4's error-codes column (the Tauri command table),
 * plus `E_ENGINE_VERSION_MISMATCH` from Section 7.3 (the sidecar RPC table)
 * since it is carried in the same `AppError` envelope end-to-end. This is
 * additive to the frozen `AppError` shape, not a change to it: `code`
 * remains `z.string()` per the literal source of truth, and `AppErrorCode`
 * is offered as the closed set implementers should draw from.
 */
import { z } from 'zod';

export const AppError = z.object({
  code: z.string(), // one of the enumerated E_* codes above
  message: z.string(), // user-facing, from the copy table in Section 10 — never raw
  detail: z.string().nullable(), // developer detail; logged locally, shown behind "Details"
  path: z.string().nullable(),
});
export type AppError = z.infer<typeof AppError>;

/**
 * Full closed set of `E_*` codes drawn from Section 7.3's `engine.version`
 * mismatch case and Section 7.4's per-command error-codes column.
 */
export const AppErrorCode = z.enum([
  // Section 7.3 — sidecar JSON-RPC
  'E_ENGINE_VERSION_MISMATCH',
  // Section 7.4 — analyze_repo
  'E_PATH_NOT_FOUND',
  'E_NOT_A_DIRECTORY',
  'E_PERMISSION_DENIED',
  'E_NO_SUPPORTED_FILES',
  'E_REPO_TOO_LARGE',
  'E_ENGINE_CRASHED',
  'E_ENGINE_TIMEOUT',
  'E_ANALYSIS_IN_PROGRESS',
  // Section 7.4 — search_repo
  'E_NO_ANALYSIS',
  // Section 7.4 — read_repo_file
  'E_FILE_TOO_LARGE',
  'E_PATH_ESCAPES_REPO',
  // Section 7.4 — update_settings
  'E_INVALID_SETTINGS',
  // Section 7.4 — store_ai_key
  'E_KEYCHAIN_UNAVAILABLE',
  // Section 7.4 — test_ai_key
  'E_AI_KEY_INVALID',
  'E_AI_NETWORK',
  'E_AI_OLLAMA_UNREACHABLE',
  'E_AI_MODEL_NOT_FOUND',
  'E_AI_RATE_LIMITED',
  // Section 7.4 — ai_project_summary / ai_explain_module / ai_ask ("E_AI_*")
  'E_AI_DISABLED',
  'E_AI_CITATION_REJECTED',
  'E_AI_PAYLOAD_UNSAFE',
]);
export type AppErrorCode = z.infer<typeof AppErrorCode>;
