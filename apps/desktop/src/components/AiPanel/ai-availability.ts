import type { AiProvider, AiSettings } from '@/ipc/settings-schema';

/**
 * The UI mirror of the Rust gate (`ai::permit`, and Section 10's "AI toggle
 * on, no key stored" row). Three outcomes, not two, because "off" and
 * "on but unusable" are different situations and the user can only fix the
 * one they are actually in.
 *
 * `missing-key` is provider-aware rather than an Ollama exemption: the rule
 * is "a provider that needs a credential must have one", and Ollama is READY
 * with no key because it needs none (it is a local, unauthenticated server) —
 * the same single rule that makes Anthropic and openai-compatible blocked.
 * Written as one predicate so this side can never drift into believing
 * Ollama is a special case the backend also has to remember.
 */
export type AiAvailability = 'disabled' | 'missing-key' | 'ready';

/** Matches `AiProvider::requires_stored_key` on the Rust side. */
export function requiresStoredKey(provider: AiProvider): boolean {
  return provider !== 'ollama';
}

/**
 * A5: AI is off until the user turns it on, so `disabled` is the answer for
 * the default settings and stays the answer while the master toggle is off,
 * whatever else is configured — a stored key never activates AI by itself.
 */
export function resolveAiAvailability(ai: AiSettings): AiAvailability {
  if (!ai.isEnabled) {
    return 'disabled';
  }
  if (requiresStoredKey(ai.provider) && !ai.hasStoredKey) {
    return 'missing-key';
  }
  return 'ready';
}
