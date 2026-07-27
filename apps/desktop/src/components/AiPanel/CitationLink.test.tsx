import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CitationLink } from './CitationLink';

describe('CitationLink', () => {
  test('shows the cited path and line, and names itself as an open action', () => {
    render(<CitationLink path="src/services/auth.service.ts" line={22} onOpenFile={vi.fn()} />);

    const link = screen.getByRole('button', {
      name: 'Open src/services/auth.service.ts, line 22',
    });
    expect(link).toHaveTextContent('src/services/auth.service.ts:22');
  });

  test('clicking it opens that exact path at that exact line', async () => {
    const onOpenFile = vi.fn();
    const user = userEvent.setup();
    render(<CitationLink path="src/db/client.ts" line={7} onOpenFile={onOpenFile} />);

    await user.click(screen.getByRole('button', { name: 'Open src/db/client.ts, line 7' }));

    expect(onOpenFile).toHaveBeenCalledWith('src/db/client.ts', 7);
  });

  test('is reachable and activatable from the keyboard alone', async () => {
    const onOpenFile = vi.fn();
    const user = userEvent.setup();
    render(<CitationLink path="src/index.ts" line={1} onOpenFile={onOpenFile} />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Open src/index.ts, line 1' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onOpenFile).toHaveBeenCalledWith('src/index.ts', 1);
  });
});
