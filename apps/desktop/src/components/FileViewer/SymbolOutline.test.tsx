import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SymbolEntry } from './SymbolOutline';
import { SymbolOutline } from './SymbolOutline';

const SYMBOLS: SymbolEntry[] = [
  {
    id: 'a1', name: 'AuthController', kind: 'class', path: 'src/controllers/auth.controller.ts',
    startLine: 12, endLine: 88, isExported: true, containerName: null, signature: 'class AuthController',
  },
  {
    id: 'a2', name: 'login', kind: 'method', path: 'src/controllers/auth.controller.ts',
    startLine: 19, endLine: 44, isExported: false, containerName: 'AuthController', signature: 'async login(...)',
  },
];

describe('SymbolOutline', () => {
  test('renders every symbol with its kind and line', () => {
    render(<SymbolOutline symbols={SYMBOLS} onSelectSymbol={vi.fn()} />);
    expect(screen.getByText('AuthController')).toBeInTheDocument();
    expect(screen.getByText('login')).toBeInTheDocument();
    expect(screen.getByText('class')).toBeInTheDocument();
    expect(screen.getByText('method')).toBeInTheDocument();
  });

  test('clicking a symbol calls onSelectSymbol with its startLine', async () => {
    const user = userEvent.setup();
    const onSelectSymbol = vi.fn();
    render(<SymbolOutline symbols={SYMBOLS} onSelectSymbol={onSelectSymbol} />);

    await user.click(screen.getByRole('button', { name: /AuthController/i }));

    expect(onSelectSymbol).toHaveBeenCalledWith(12);
  });

  test('renders the exact "no symbols" copy for an empty file', () => {
    render(<SymbolOutline symbols={[]} onSelectSymbol={vi.fn()} />);
    expect(screen.getByText('No symbols found in this file.')).toBeInTheDocument();
  });
});
