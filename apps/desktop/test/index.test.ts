import { describe, expect, test } from 'bun:test';
import { DESKTOP_STUB_VERSION, describeDesktopStub } from '../src/index';

describe('desktop app scaffold', () => {
  test('exposes a stub version marker equal to zero', () => {
    expect(DESKTOP_STUB_VERSION).toBe(0);
  });

  test('describes itself as a pre-Phase-6 scaffold', () => {
    expect(describeDesktopStub()).toContain('Phase 6');
  });
});
