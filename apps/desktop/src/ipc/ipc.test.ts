import { describe, expect, test } from 'vitest';
import { createIpc, parseIpcError, resolveIpcMode } from './ipc';

describe('resolveIpcMode', () => {
  test('resolves to mock under the test environment (VITE_IPC=mock, vitest.config.ts)', () => {
    expect(resolveIpcMode()).toBe('mock');
  });
});

describe('createIpc', () => {
  test('an explicit mode overrides the environment-derived default', async () => {
    const tauri = createIpc('tauri');
    await expect(tauri.pickRepoFolder()).rejects.toMatchObject({ code: 'E_NOT_WIRED' });
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
