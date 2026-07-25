import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  test('announces itself as an alert with the title and description', () => {
    render(
      <ErrorState title="That folder no longer exists" description="Onboard could not find acme-api." />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('That folder no longer exists');
    expect(alert).toHaveTextContent('Onboard could not find acme-api.');
  });

  test('renders primary and secondary actions and wires their callbacks', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onChooseAnother = vi.fn();
    render(
      <ErrorState
        title="Analysis stopped unexpectedly"
        description="The analysis engine exited before finishing."
        primaryAction={{ label: 'Retry', onAction: onRetry }}
        secondaryAction={{ label: 'Open log', onAction: onChooseAnother }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await user.click(screen.getByRole('button', { name: 'Open log' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onChooseAnother).toHaveBeenCalledTimes(1);
  });

  test('developer detail is hidden behind a "Details" disclosure', () => {
    render(
      <ErrorState
        title="Analysis stopped unexpectedly"
        description="The analysis engine exited before finishing."
        detail="stack trace: boom at line 42"
      />,
    );
    const details = screen.getByText('Details').closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('stack trace: boom at line 42')).toBeInTheDocument();
  });

  test('omits the details disclosure when there is no detail', () => {
    render(<ErrorState title="Analysis stopped unexpectedly" description="No detail available." />);
    expect(screen.queryByText('Details')).not.toBeInTheDocument();
  });
});
