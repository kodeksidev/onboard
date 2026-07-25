import { createRef } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphToolbar } from './GraphToolbar';

describe('GraphToolbar', () => {
  test('typing in the search box reports the new value', async () => {
    const user = userEvent.setup();
    const onSearchQueryChange = vi.fn();
    render(
      <GraphToolbar
        searchInputRef={createRef<HTMLInputElement>()}
        searchQuery=""
        onSearchQueryChange={onSearchQueryChange}
        onExpandAll={vi.fn()}
        onCollapseAll={vi.fn()}
      />,
    );

    await user.type(screen.getByRole('searchbox', { name: /search the dependency graph/i }), 'auth');

    expect(onSearchQueryChange).toHaveBeenCalledTimes(4);
    expect(onSearchQueryChange).toHaveBeenLastCalledWith('auth'[3]);
  });

  test('Expand all / Collapse all buttons call their handlers', async () => {
    const user = userEvent.setup();
    const onExpandAll = vi.fn();
    const onCollapseAll = vi.fn();
    render(
      <GraphToolbar
        searchInputRef={createRef<HTMLInputElement>()}
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        onExpandAll={onExpandAll}
        onCollapseAll={onCollapseAll}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));

    expect(onExpandAll).toHaveBeenCalledTimes(1);
    expect(onCollapseAll).toHaveBeenCalledTimes(1);
  });

  test('the search input is reachable via the forwarded ref, for the "/" shortcut to focus', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <GraphToolbar
        searchInputRef={ref}
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        onExpandAll={vi.fn()}
        onCollapseAll={vi.fn()}
      />,
    );
    expect(ref.current).not.toBeNull();
    ref.current?.focus();
    expect(ref.current).toHaveFocus();
  });
});
