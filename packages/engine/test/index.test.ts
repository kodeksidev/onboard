import { describe, expect, test } from 'bun:test';
import { CLASSIFICATION_RULE_ORDER, MAX_REPO_FILES, classifyFile, walk } from '../src/index';

describe('engine package barrel', () => {
  test('re-exports Phase 2 constants', () => {
    expect(MAX_REPO_FILES).toBe(25_000);
  });

  test('re-exports the classification rule order', () => {
    expect(CLASSIFICATION_RULE_ORDER[0]).toBe('entrypoint');
    expect(CLASSIFICATION_RULE_ORDER.at(-1)).toBe('unknown');
  });

  test('re-exports classifyFile and walk as callables', () => {
    expect(typeof classifyFile).toBe('function');
    expect(typeof walk).toBe('function');
  });
});
