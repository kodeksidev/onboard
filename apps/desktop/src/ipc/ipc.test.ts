import { describe, expect, test } from 'vitest';
import { createIpc, parseIpcError, resolveIpcMode } from './ipc';

describe('resolveIpcMode', () => {
  test('resolves to mock under the test environment (VITE_IPC=mock, vitest.config.ts)', () => {
    expect(resolveIpcMode()).toBe('mock');
  });
});

describe('createIpc', () => {
  test('an explicit mode overrides the environment-derived default', async () => {
    // Phase 11 wired `createTauriIpc()` to real `@tauri-apps/api` `invoke()`
    // calls. Under jsdom (no `window.__TAURI_INTERNALS__`, no real Tauri
    // runtime) that call itself fails, and `tauri-ipc.ts`'s `toAppError`
    // normalizes anything that isn't already a well-formed `AppError` into
    // `E_UNEXPECTED` (Section 12: never let a raw error escape unnormalized)
    // — this is what proves `createIpc('tauri')` really did select the
    // Tauri implementation rather than the mock one, which always resolves.
    const tauri = createIpc('tauri');
    await expect(tauri.pickRepoFolder()).rejects.toMatchObject({ code: 'E_UNEXPECTED' });
  });
});

describe('parseIpcError', () => {
  test('passes a well-formed AppError through unchanged', () => {
    const appError = { code: 'E_PATH_NOT_FOUND', message: 'not found', detail: null, path: 'x' };
    expect(parseIpcError(appError)).toEqual(appError);
  });

  test('normalizes a non-AppError rejection instead of letting it render raw', () => {
    const result = parseIpcError(new TypeError('boom'));
    expect(result.code).toBe('E_UNEXPECTED');
    expect(result.detail).toBe('boom');
  });

  test('normalizes a thrown non-Error value', () => {
    const result = parseIpcError('a plain string rejection');
    expect(result.code).toBe('E_UNEXPECTED');
    expect(result.detail).toBe('a plain string rejection');
  });
});
