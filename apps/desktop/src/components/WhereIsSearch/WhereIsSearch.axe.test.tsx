import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { WhereIsSearch } from './WhereIsSearch';

const REPO_ID = '9f3c1a7b2e5d4086';

/** `@tanstack/react-virtual` measurement stub — see `WhereIsSearch.test.tsx` for the full rationale. */
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 384,
  });
});

/** Section 9 Phase 10's quality gate: keyboard-navigable + axe-clean, matching Phase 8/9's precedent. */
describe('WhereIsSearch accessibility', () => {
  test('has zero axe-core violations with results rendered', async () => {
    const user = userEvent.setup();
    const { container } = render(<WhereIsSearch repoId={REPO_ID} />);

    await user.type(screen.getByRole('combobox', { name: 'Where is X?' }), 'auth');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });
});
