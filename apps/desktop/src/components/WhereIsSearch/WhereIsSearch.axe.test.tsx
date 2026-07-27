import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ipc } from '@/ipc/ipc';
import { WhereIsSearch } from './WhereIsSearch';
import { SLOW_MOUNT_TIMEOUT_MS } from '@/test/timeouts';

const REPO_ID = '9f3c1a7b2e5d4086';

/** `@tanstack/react-virtual` measurement stub — see `WhereIsSearch.test.tsx` for the full rationale. */
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 384,
  });
});

/** Section 9 Phase 10's quality gate: keyboard-navigable + axe-clean, matching Phase 8/9's precedent. */
describe('WhereIsSearch accessibility', { timeout: SLOW_MOUNT_TIMEOUT_MS }, () => {
  test('has zero axe-core violations with results rendered', async () => {
    const user = userEvent.setup();
    const { container } = render(<WhereIsSearch repoId={REPO_ID} />);

    await user.type(screen.getByRole('combobox', { name: 'Where is X?' }), 'auth');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });

  test('has zero axe-core violations in the error state', async () => {
    vi.spyOn(ipc, 'searchRepo').mockRejectedValueOnce({
      code: 'E_NO_ANALYSIS',
      message: 'This repository has not finished analysing, so there is nothing to search yet.',
      detail: null,
      path: null,
    });
    const user = userEvent.setup();
    const { container } = render(<WhereIsSearch repoId={REPO_ID} />);

    await user.type(screen.getByRole('combobox', { name: 'Where is X?' }), 'authenticate');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });
});
