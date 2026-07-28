import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SentPayloadDisclosure } from './SentPayloadDisclosure';

describe('SentPayloadDisclosure', () => {
  test('states the real file and byte counts from the response', () => {
    render(<SentPayloadDisclosure provider="anthropic" sentFileCount={7} sentByteCount={12_288} />);

    const summary = screen.getByText(/7 files/);
    expect(summary).toHaveTextContent('12288 bytes');
    expect(summary).toHaveTextContent('anthropic');
  });

  test('singularizes a one-file payload', () => {
    render(<SentPayloadDisclosure provider="ollama" sentFileCount={1} sentByteCount={256} />);

    expect(screen.getByText(/1 file /)).toBeInTheDocument();
    expect(screen.queryByText(/1 files/)).not.toBeInTheDocument();
  });

  /**
   * This is a privacy claim, not decoration: it must be readable without
   * hovering, expanding, or focusing anything (Section 12's audit promise).
   */
  test('is visible without any interaction and is not tucked inside a disclosure widget', () => {
    const { container } = render(
      <SentPayloadDisclosure provider="anthropic" sentFileCount={3} sentByteCount={4096} />,
    );

    const summary = screen.getByText(/3 files/);
    expect(summary).toBeVisible();
    expect(summary.closest('details')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
  });

  test('reports a zero-file payload explicitly rather than rendering nothing', () => {
    render(<SentPayloadDisclosure provider="anthropic" sentFileCount={0} sentByteCount={0} />);

    expect(screen.getByText(/0 files/)).toHaveTextContent('0 bytes');
  });
});
