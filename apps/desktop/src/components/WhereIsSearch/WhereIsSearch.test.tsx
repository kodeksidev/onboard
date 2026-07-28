import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SearchResponse } from '@onboard/contract';
import { ipc } from '@/ipc/ipc';
import { WhereIsSearch } from './WhereIsSearch';
import { SLOW_MOUNT_TIMEOUT_MS } from '@/test/timeouts';

const REPO_ID = '9f3c1a7b2e5d4086';

/**
 * `@tanstack/react-virtual` measures its scroll container via
 * `element.offsetHeight` (see `@tanstack/virtual-core`'s `getRect`), which
 * jsdom always reports as 0 (no layout engine) — unlike CodeMirror 6, which
 * falls back to an internal viewport estimate when real measurement is
 * unavailable (see `FileViewer`'s performance test). Stubbing `offsetHeight`
 * to the value the component itself renders as its viewport height is the
 * standard, documented way to exercise `react-virtual` under jsdom; it is a
 * measurement stub, not a behavior fake — the virtualizer's own windowing
 * logic still runs for real against this value.
 */
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 384,
  });
});

describe('WhereIsSearch', { timeout: SLOW_MOUNT_TIMEOUT_MS }, () => {
  test('typing a real query renders genuinely ranked results with expanded terms shown', async () => {
    const user = userEvent.setup();
    render(<WhereIsSearch repoId={REPO_ID} />);

    await user.type(screen.getByRole('combobox', { name: 'Where is X?' }), 'auth');

    await waitFor(() => {
      expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Also matching:')).toBeInTheDocument();
  });

  test('a result click opens the file AT the hit line (Section 9 Phase 10 gate)', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(<WhereIsSearch repoId={REPO_ID} onOpenFile={onOpenFile} />);

    await user.type(screen.getByRole('combobox', { name: 'Where is X?' }), 'authenticate');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: /open src\/services\/auth\.service\.ts, line 22/i }));

    expect(onOpenFile).toHaveBeenCalledWith('src/services/auth.service.ts', 22);
  });

  test('ArrowDown/ArrowUp move selection and Enter opens the selected result at its line', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(<WhereIsSearch repoId={REPO_ID} onOpenFile={onOpenFile} />);
    const input = screen.getByRole('combobox', { name: 'Where is X?' });

    await user.type(input, 'service');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));

    await user.keyboard('{ArrowDown}{ArrowDown}');
    const options = screen.getAllByRole('option');
    const selected = options.find((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected).toBeDefined();

    await user.keyboard('{Enter}');
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  test('a query that matches nothing shows the exact Section 10 zero-hit copy', async () => {
    const user = userEvent.setup();
    render(<WhereIsSearch repoId={REPO_ID} />);

    await user.type(screen.getByRole('combobox', { name: 'Where is X?' }), 'zzzznonexistentzzzz');

    await waitFor(() => {
      expect(screen.getByText("Nothing matched 'zzzznonexistentzzzz'")).toBeInTheDocument();
    });
    expect(
      screen.getByText('Try a concept like auth, payment, or routing — Onboard expands those into related terms.'),
    ).toBeInTheDocument();
  });

  test('a dropped short term is surfaced with the exact Section 10 copy', async () => {
    const user = userEvent.setup();
    render(<WhereIsSearch repoId={REPO_ID} />);

    await user.type(screen.getByRole('combobox', { name: 'Where is X?' }), 'db');

    await waitFor(() => {
      expect(screen.getByText("Ignored: 'db' (min 3 characters)")).toBeInTheDocument();
    });
  });

  /**
   * Section 9's audit: `useSearch` already carried an `error` field, but
   * `WhereIsSearch` never rendered it — a failed search looked identical to
   * "still typing" or briefly like "no results". Confirmed and fixed here.
   */
  test('a failed search shows an error state, distinct from "no results" and from loading', async () => {
    const appError = {
      code: 'E_NO_ANALYSIS',
      message: 'This repository has not finished analysing, so there is nothing to search yet.',
      detail: null,
      path: null,
    };
    vi.spyOn(ipc, 'searchRepo').mockRejectedValueOnce(appError);
    const user = userEvent.setup();
    render(<WhereIsSearch repoId={REPO_ID} />);

    await user.type(screen.getByRole('combobox', { name: 'Where is X?' }), 'authenticate');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Search is not ready yet' })).toBeInTheDocument();
    expect(
      screen.getByText('This repository has not finished analysing, so there is nothing to search yet.'),
    ).toBeInTheDocument();
    // Not the zero-hit copy, and not still showing the (now stale) loading text.
    expect(screen.queryByText(/^Nothing matched/)).not.toBeInTheDocument();
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument();
  });

  test('the loading label is shown while a query is in flight', async () => {
    let resolveSearch!: (value: SearchResponse) => void;
    vi.spyOn(ipc, 'searchRepo').mockReturnValueOnce(
      new Promise<SearchResponse>((resolve) => {
        resolveSearch = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<WhereIsSearch repoId={REPO_ID} />);

    await user.type(screen.getByRole('combobox', { name: 'Where is X?' }), 'authenticate');

    expect(await screen.findByText('Searching…')).toBeInTheDocument();

    resolveSearch({ query: 'authenticate', hits: [], expandedTerms: [], droppedTerms: [], totalCandidateCount: 0 });
    await waitFor(() => expect(screen.queryByText('Searching…')).not.toBeInTheDocument());
  });
});
