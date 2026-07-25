import { afterEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRepoStore } from '@/state/repoStore';
import { RepoPicker } from './RepoPicker';

afterEach(() => {
  useRepoStore.setState({
    status: 'empty',
    repoPath: null,
    envelope: null,
    progress: null,
    error: null,
  });
});

describe('RepoPicker', () => {
  test('renders the exact "No repository open" copy from Section 10', () => {
    render(<RepoPicker />);
    expect(screen.getByRole('heading', { name: 'No repository open' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Choose a folder to map. Nothing is uploaded — analysis runs entirely on this machine.',
      ),
    ).toBeInTheDocument();
  });

  test('clicking "Choose folder" starts analysis via the store', async () => {
    const user = userEvent.setup();
    render(<RepoPicker />);

    await user.click(screen.getByRole('button', { name: 'Choose folder' }));

    await waitFor(() => {
      expect(useRepoStore.getState().status).toBe('ready');
    });
  });

  test('is disabled whenever the store status is analyzing or picking', () => {
    useRepoStore.setState({ status: 'analyzing' });
    const { rerender } = render(<RepoPicker />);
    expect(screen.getByRole('button', { name: 'Choose folder' })).toBeDisabled();

    useRepoStore.setState({ status: 'picking' });
    rerender(<RepoPicker />);
    expect(screen.getByRole('button', { name: 'Choose folder' })).toBeDisabled();
  });
});
