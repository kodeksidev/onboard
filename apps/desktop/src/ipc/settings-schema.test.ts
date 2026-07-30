import { describe, expect, test } from 'vitest';
import { AiProvider, AiSettings, DEFAULT_SETTINGS, Settings } from './settings-schema';

/**
 * The TS half of the `AiProvider` wire-format pin. Its Rust twin is
 * `ai_provider_serializes_to_exactly_these_bytes` in
 * `src-tauri/src/commands/settings.rs`.
 *
 * Why both halves exist, stated plainly because their absence is what let a
 * real defect through: `AiProvider` is declared twice — once as a Rust enum
 * with a `#[serde(rename_all = ...)]` attribute, once as a zod enum here —
 * and the two are connected by nothing but these literals matching. During
 * Phase 12 the Rust attribute was switched from `"lowercase"` to
 * `"kebab-case"` solely to spell an out-of-scope third variant, and no test
 * on either side asserted what bytes actually crossed the boundary. A
 * round-trip test cannot catch that class of change (both directions move
 * together); only asserting the literal text can.
 */
describe('AiProvider wire format', () => {
  test('accepts exactly the two v1 provider literals', () => {
    expect(AiProvider.parse('anthropic')).toBe('anthropic');
    expect(AiProvider.parse('ollama')).toBe('ollama');
    expect(AiProvider.options).toEqual(['anthropic', 'ollama']);
  });

  /**
   * A4 / §3 non-goal 2. `openai-compatible` is listed first because it was
   * genuinely shipped and had to be removed; the rest are named in the
   * non-goal itself.
   */
  test('rejects every out-of-scope adapter name', () => {
    for (const banned of [
      'openai-compatible',
      'openai',
      'deepseek',
      'azure',
      'bedrock',
      'groq',
      'openrouter',
    ]) {
      expect(AiProvider.safeParse(banned).success).toBe(false);
    }
  });

  /**
   * The exact bytes the Rust side emits must parse here. These string
   * literals are the contract; if the Rust `rename_all` changes, this fails.
   */
  test('parses the exact bytes the Rust enum serializes to', () => {
    for (const wire of ['"anthropic"', '"ollama"']) {
      expect(AiProvider.safeParse(JSON.parse(wire)).success).toBe(true);
    }
    expect(AiProvider.safeParse(JSON.parse('"openai-compatible"')).success).toBe(false);
  });
});

describe('AiSettings shape', () => {
  /**
   * The removed adapter's field must not come back by accident. zod strips
   * unknown keys rather than failing, so this asserts the parsed OUTPUT has
   * no such property — which is also the migration guarantee: a settings
   * file written by the version that shipped the adapter still loads.
   */
  test('drops a stale openaiCompatibleBaseUrl instead of failing', () => {
    const parsed = AiSettings.parse({
      isEnabled: false,
      provider: 'ollama',
      model: 'x',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      openaiCompatibleBaseUrl: 'https://api.deepseek.com',
      hasStoredKey: false,
    });
    expect(parsed).not.toHaveProperty('openaiCompatibleBaseUrl');
    expect(parsed.provider).toBe('ollama');
  });

  test('rejects settings pinned to the removed provider', () => {
    const result = AiSettings.safeParse({
      isEnabled: true,
      provider: 'openai-compatible',
      model: 'x',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      hasStoredKey: true,
    });
    expect(result.success).toBe(false);
  });

  /** AI off by default is a Section 12 privacy guarantee, not a preference. */
  test('defaults have AI disabled and name a v1 provider', () => {
    expect(DEFAULT_SETTINGS.ai.isEnabled).toBe(false);
    expect(AiProvider.options).toContain(DEFAULT_SETTINGS.ai.provider);
    expect(Settings.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});
