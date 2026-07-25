import { describe, expect, test } from 'bun:test';
import { CONTRACT_STUB_VERSION, describeContractStub } from '../src/index';

describe('contract package scaffold', () => {
  test('exposes a stub version marker equal to zero', () => {
    expect(CONTRACT_STUB_VERSION).toBe(0);
  });

  test('describes itself as a pre-Phase-1 scaffold', () => {
    expect(describeContractStub()).toContain('Phase 1');
  });
});
