/**
 * @onboard/engine — RPC domain-error convention.
 *
 * Per `docs/DECISIONS.md`'s "Phase 6 — JSON-RPC domain-error convention"
 * (rust-tauri's already-committed choice, confirmed for sign-off): on a
 * domain failure the engine returns a JSON-RPC error object whose
 * `error.data` is a fully serialized `AppError`. `DomainError` is the one
 * exception type every RPC method throws for a *recognized* domain failure;
 * `src/rpc/server.ts` is the only place that catches it and builds the wire
 * format — nothing here talks JSON-RPC.
 */
import type { AppError, AppErrorCode } from '@onboard/contract';

export class DomainError extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.name = 'DomainError';
    this.appError = appError;
  }
}

/** Builds a `DomainError` from the closed `AppErrorCode` set (Section 7.4/10). */
export function domainError(code: AppErrorCode, message: string, detail: string | null, path: string | null): DomainError {
  return new DomainError({ code, message, detail, path });
}
