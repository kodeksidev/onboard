import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '@/ipc/settings-schema';
import type { AiSettings } from '@/ipc/settings-schema';
import { resolveAiAvailability } from './ai-availability';

function aiSettings(patch: Partial<AiSettings>): AiSettings {
  return { ...DEFAULT_SETTINGS.ai, ...patch };
}

/**
 * Mirrors the Rust gate (Section 10's "AI toggle on, no key stored" row and
 * `ai::permit`): a provider that needs a credential and has none is as
 * unusable as a master toggle that is off — but for a different reason, so
 * the UI must be able to say which.
 */
describe('resolveAiAvailability', () => {
  test('is disabled by default (A5: AI is off until the user turns it on)', () => {
    expect(resolveAiAvailability(DEFAULT_SETTINGS.ai)).toBe('disabled');
  });

  test('stays disabled when the toggle is off even with a stored key', () => {
    expect(resolveAiAvailability(aiSettings({ isEnabled: false, hasStoredKey: true }))).toBe(
      'disabled',
    );
  });

  test('reports a missing key when a credentialed provider is enabled without one', () => {
    expect(
      resolveAiAvailability(aiSettings({ isEnabled: true, provider: 'anthropic' })),
    ).toBe('missing-key');
  });

  test('is ready for Ollama with no key at all — it needs no credential', () => {
    expect(resolveAiAvailability(aiSettings({ isEnabled: true, provider: 'ollama' }))).toBe(
      'ready',
    );
  });

  test('is ready once an enabled credentialed provider has a stored key', () => {
    expect(
      resolveAiAvailability(aiSettings({ isEnabled: true, hasStoredKey: true })),
    ).toBe('ready');
  });
});
