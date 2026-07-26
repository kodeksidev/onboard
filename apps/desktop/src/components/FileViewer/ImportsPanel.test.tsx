import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportsPanel } from './ImportsPanel';

describe('ImportsPanel', () => {
  test('renders imports and importers as working jump links', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(
      <ImportsPanel
        imports={['src/config/env.ts', 'src/utils/format.ts']}
        importedBy={['src/routes/auth.routes.ts']}
        onOpenFile={onOpenFile}
      />,
    );

    const importsRegion = within(screen.getByRole('region', { name: 'Imports' }));
    await user.click(importsRegion.getByRole('button', { name: 'src/config/env.ts' }));
    expect(onOpenFile).toHaveBeenCalledWith('src/config/env.ts');

    const importedByRegion = within(screen.getByRole('region', { name: 'Imported by' }));
    await user.click(importedByRegion.getByRole('button', { name: 'src/routes/auth.routes.ts' }));
    expect(onOpenFile).toHaveBeenCalledWith('src/routes/auth.routes.ts');
  });

  test('renders "None" for a side with nothing', () => {
    render(<ImportsPanel imports={[]} importedBy={[]} onOpenFile={vi.fn()} />);
    expect(screen.getAllByText('None')).toHaveLength(2);
  });
});
