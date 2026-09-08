import { createRef } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GRAPH_COPY } from '@/copy/messages';
import { GraphToolbar } from './GraphToolbar';

type Overrides = Partial<Parameters<typeof GraphToolbar>[0]>;

function renderToolbar(overrides: Overrides = {}) {
  const props = {
    searchInputRef: createRef<HTMLInputElement>(),
    searchQuery: '',
    onSearchQueryChange: vi.fn(),
    onExpandAll: vi.fn(),
    onResetView: vi.fn(),
    onClearSelection: vi.fn(),
    hasSelection: true,
    ...overrides,
  };
  render(<GraphToolbar {...props} />);
  return props;
}

describe('GraphToolbar', () => {
  test('typing in the search box reports the new value', async () => {
    const user = userEvent.setup();
    const { onSearchQueryChange } = renderToolbar();

    await user.type(screen.getByRole('searchbox', { name: /search the dependency graph/i }), 'auth');

    expect(onSearchQueryChange).toHaveBeenCalledTimes(4);
    expect(onSearchQueryChange).toHaveBeenLastCalledWith('auth'[3]);
  });

  test('each view action calls its own handler', async () => {
    const user = userEvent.setup();
    const props = renderToolbar();

    await user.click(screen.getByRole('button', { name: GRAPH_COPY.toolbar.expandAll }));
    await user.click(screen.getByRole('button', { name: GRAPH_COPY.toolbar.resetView }));
    await user.click(screen.getByRole('button', { name: GRAPH_COPY.toolbar.clearSelection }));

    expect(props.onExpandAll).toHaveBeenCalledTimes(1);
    expect(props.onResetView).toHaveBeenCalledTimes(1);
    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
  });

  /**
   * The defect this control exists for: clicking a node dimmed the whole graph
   * with no way back — background tap was never wired, and Escape could not
   * reach its handler after a mouse click. This is the only escape route a
   * first-time user can SEE.
   */
  test('offers a visible way out of a selection', () => {
    renderToolbar({ hasSelection: true });

    expect(screen.getByRole('button', { name: GRAPH_COPY.toolbar.clearSelection })).toBeEnabled();
  });

  test('disables clearing when there is nothing selected, rather than offering a dead control', () => {
    renderToolbar({ hasSelection: false });

    expect(screen.getByRole('button', { name: GRAPH_COPY.toolbar.clearSelection })).toBeDisabled();
  });

  test('names its actions for the outcome, and never reuses a tab name', () => {
    renderToolbar();

    // "Overview" is the name of a tab one row above; two adjacent controls
    // meaning different things under one word is worse than a plain name.
    expect(screen.queryByRole('button', { name: /overview/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeInTheDocument();
  });

  test('the search input is reachable via the forwarded ref, for the "/" shortcut to focus', () => {
    const ref = createRef<HTMLInputElement>();
    renderToolbar({ searchInputRef: ref });

    expect(ref.current).not.toBeNull();
    ref.current?.focus();
    expect(ref.current).toHaveFocus();
  });
});
