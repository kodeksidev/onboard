import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  test('renders the title and description as an ordinary (non-alert) section', () => {
    render(<EmptyState title="No repository open" description="Choose a folder to map." />);
    expect(screen.getByRole('heading', { name: 'No repository open' })).toBeInTheDocument();
    expect(screen.getByText('Choose a folder to map.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('omits the action button when no action is supplied', () => {
    render(<EmptyState title="Nothing" description="Nothing here." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('invokes onAction when the button is clicked, and respects isActionDisabled', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <EmptyState
        title="No repository open"
        description="Choose a folder to map."
        actionLabel="Choose folder"
        onAction={onAction}
        isActionDisabled
      />,
    );

    const button = screen.getByRole('button', { name: 'Choose folder' });
    expect(button).toBeDisabled();

    render(
      <EmptyState
        title="No repository open"
        description="Choose a folder to map."
        actionLabel="Choose folder"
        onAction={onAction}
      />,
    );
    await user.click(screen.getAllByRole('button', { name: 'Choose folder' })[1]!);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
