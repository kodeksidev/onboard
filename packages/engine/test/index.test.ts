import { describe, expect, test } from 'bun:test';
import { ENGINE_STUB_VERSION, describeEngineStub } from '../src/index';

describe('engine package scaffold', () => {
  test('exposes a stub version marker equal to zero', () => {
    expect(ENGINE_STUB_VERSION).toBe(0);
  });

  test('describes itself and its no-network posture', () => {
    expect(describeEngineStub()).toContain('network');
  });
});
