import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModeIndicator } from './ModeIndicator';
import { MODE_INDICATOR } from '@/copy/messages';

/**
 * Phase 7 gate: "A test asserts ModeIndicator renders exactly
 * 'Static mode · no network · nothing leaves this machine' when
 * ai.isEnabled === false, for every combination of hasStoredKey."
 *
 * EXACT means `toBe` on `textContent`, not `toHaveTextContent`. This file used
 * `toHaveTextContent`, which is a SUBSTRING match — it passes on
 * "🔒 Static mode · …" just as happily as on "Static mode · …", so it could not
 * have detected the emoji removal in either direction. The gate said "exactly"
 * and the assertion did not, which is the same claim-stronger-than-the-check
 * shape recorded in the INVALIDATES entry in docs/DECISIONS.md.
 *
 * Asserted against the MODE_INDICATOR constant, and separately against a
 * literal, so the pair cannot drift silently: the literal catches a change to
 * the constant, and the constant catches the component composing its own text.
 */
describe('ModeIndicator', () => {
  test.each([true, false])(
    'renders exactly the static-mode string when isEnabled is false and hasStoredKey is %s',
    (hasStoredKey) => {
      render(
        <ModeIndicator
          isEnabled={false}
          provider="anthropic"
          model="claude-sonnet-4-5"
          hasStoredKey={hasStoredKey}
        />,
      );
      const status = screen.getByRole('status');
      expect(status.textContent).toBe(
        'Static mode · no network · nothing leaves this machine',
      );
      expect(status.textContent).toBe(MODE_INDICATOR.static);
    },
  );

  test('renders exactly the AI-mode string, with the real provider and model interpolated', () => {
    render(<ModeIndicator isEnabled provider="ollama" model="llama3.1:8b" hasStoredKey />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(
      'AI mode · ollama/llama3.1:8b · snippets sent to ollama',
    );
    expect(status.textContent).toBe(MODE_INDICATOR.ai('ollama', 'llama3.1:8b'));
  });

  /**
   * The emoji was replaced by an SVG glyph (2026-07-31, product owner). These
   * assert the replacement did not smuggle the old failure back in: no emoji
   * in the rendered text, and no leading whitespace from the glyph's markup.
   */
  test.each([
    ['static', false],
    ['ai', true],
  ] as const)('the %s string renders with no emoji and no leading space', (_label, isEnabled) => {
    render(<ModeIndicator isEnabled={isEnabled} provider="ollama" model="m" hasStoredKey />);
    const text = screen.getByRole('status').textContent ?? '';
    // Codepoint scan rather than a character class: `☁️` is `☁` + U+FE0F, and
    // putting a combining mark in a class alongside base characters is exactly
    // what `no-misleading-character-class` exists to reject. Iterating code
    // points also reports WHICH character offended, which a regex does not.
    const offenders = [...text].filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return (
        (cp >= 0x1f300 && cp <= 0x1faff) || // pictographs, incl. 🔒 U+1F512
        (cp >= 0x2600 && cp <= 0x27bf) || //  misc symbols, incl. ☁ U+2601
        cp === 0xfe0f //                      variation selector-16
      );
    });
    expect(offenders).toEqual([]);
    expect(text).toBe(text.trim());
  });

  /**
   * The glyph must be invisible to assistive technology, or the accessible
   * name becomes "lock Static mode …" and criteria 13/14 stop describing what
   * a screen-reader user actually hears. `textContent` alone cannot catch a
   * regression here — an <svg> with a <title> would still contribute nothing
   * to textContent in jsdom while changing the accessible name — so the
   * aria-hidden attribute is asserted directly.
   */
  test.each([
    ['lock', false],
    ['cloud', true],
  ] as const)('renders the %s glyph, hidden from assistive technology', (name, isEnabled) => {
    const { container } = render(
      <ModeIndicator isEnabled={isEnabled} provider="ollama" model="m" hasStoredKey />,
    );
    const glyph = container.querySelector(`[data-testid="mode-glyph-${name}"]`);
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveAttribute('focusable', 'false');
    expect(glyph?.textContent).toBe('');
    // The other mode's glyph must not also be present.
    const other = name === 'lock' ? 'cloud' : 'lock';
    expect(container.querySelector(`[data-testid="mode-glyph-${other}"]`)).toBeNull();
  });
});
