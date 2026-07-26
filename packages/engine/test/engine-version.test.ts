import { describe, expect, test } from 'bun:test';
import { resolveEngineVersion } from '../src/engine-version';

describe('resolveEngineVersion — the poisoned-cache fix (Section 6.1 schema_meta.engineVersion)', () => {
  test('appends the build hash when present (a compiled binary)', () => {
    expect(resolveEngineVersion('0.1.0', 'abc123def456')).toBe('0.1.0+abc123def456');
  });

  test('falls back to the bare package version when the build hash is undefined (running from source)', () => {
    expect(resolveEngineVersion('0.1.0', undefined)).toBe('0.1.0');
  });

  test('falls back to the bare package version when the build hash is an empty string', () => {
    expect(resolveEngineVersion('0.1.0', '')).toBe('0.1.0');
  });

  test('two different build hashes for the same package version produce two different engine versions', () => {
    const a = resolveEngineVersion('0.1.0', 'hash-a-111111');
    const b = resolveEngineVersion('0.1.0', 'hash-b-222222');
    expect(a).not.toBe(b);
  });
});
