import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExpandedTerms } from './ExpandedTerms';

describe('ExpandedTerms', () => {
  test('renders the expanded terms so ranking is explainable', () => {
    render(<ExpandedTerms expandedTerms={['jwt', 'session', 'token']} droppedTerms={[]} />);
    expect(screen.getByText('Also matching:')).toBeInTheDocument();
    expect(screen.getByText('jwt, session, token')).toBeInTheDocument();
  });

  test('renders the exact Section 10 copy for a dropped short term', () => {
    render(<ExpandedTerms expandedTerms={[]} droppedTerms={['db']} />);
    expect(screen.getByText("Ignored: 'db' (min 3 characters)")).toBeInTheDocument();
  });

  test('renders one dropped-term notice per term', () => {
    render(<ExpandedTerms expandedTerms={[]} droppedTerms={['db', 'ok']} />);
    expect(screen.getByText("Ignored: 'db' (min 3 characters)")).toBeInTheDocument();
    expect(screen.getByText("Ignored: 'ok' (min 3 characters)")).toBeInTheDocument();
  });

  test('renders nothing when there is nothing to explain', () => {
    const { container } = render(<ExpandedTerms expandedTerms={[]} droppedTerms={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
