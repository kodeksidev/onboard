import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { DEFAULT_SETTINGS } from '@/ipc/settings-schema';
import { useSettingsStore } from '@/state/settingsStore';
import { SettingsDialog } from './SettingsDialog';

beforeEach(async () => {
  await useSettingsStore.getState().updateSettings({ ai: DEFAULT_SETTINGS.ai });
});

describe('SettingsDialog', () => {
  test('renders nothing when closed', () => {
    render(<SettingsDialog isOpen={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('renders as a labelled, modal dialog when open, with the AI section inside', () => {
    render(<SettingsDialog isOpen onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'AI (optional)' })).toBeInTheDocument();
  });

  test('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsDialog isOpen onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  test('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsDialog isOpen onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
  });

  test('calls onClose on a backdrop click, but not on a click inside the dialog content', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<SettingsDialog isOpen onClose={onClose} />);

    await user.click(screen.getByRole('heading', { name: 'AI (optional)' }));
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = container.firstElementChild;
    if (backdrop === null) {
      throw new Error('expected a backdrop element');
    }
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('has zero axe-core violations while open', async () => {
    const { container } = render(<SettingsDialog isOpen onClose={() => {}} />);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
