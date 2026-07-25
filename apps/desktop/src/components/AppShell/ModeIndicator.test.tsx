import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModeIndicator } from './ModeIndicator';

/**
 * Phase 7 gate: "A test asserts ModeIndicator renders exactly
 * '🔒 Static mode · no network · nothing leaves this machine' when
 * ai.isEnabled === false, for every combination of hasStoredKey."
 */
describe('ModeIndicator', () => {
  test.each([true, false])(
    'renders the exact static-mode string when isEnabled is false and hasStoredKey is %s',
    (hasStoredKey) => {
      render(
        <ModeIndicator
          isEnabled={false}
          provider="anthropic"
          model="claude-sonnet-4-5"
          hasStoredKey={hasStoredKey}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        '🔒 Static mode · no network · nothing leaves this machine',
      );
    },
  );

  test('renders the exact AI-mode string, with the real provider and model interpolated, when isEnabled is true', () => {
    render(
      <ModeIndicator isEnabled provider="ollama" model="llama3.1:8b" hasStoredKey />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      '☁️ AI mode · ollama/llama3.1:8b · snippets sent to ollama',
    );
  });
});
