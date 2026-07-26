import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SearchHit } from '@onboard/contract';
import { SearchResultRow } from './SearchResultRow';

const HIT_WITH_SYMBOL: SearchHit = {
  path: 'src/services/auth.service.ts',
  score: 108.5,
  matchKinds: ['symbol-exact', 'filename-substring'],
  symbol: {
    id: 'a1b2c3d4e5f60020',
    name: 'authenticate',
    kind: 'method',
    path: 'src/services/auth.service.ts',
    startLine: 22,
    endLine: 68,
    isExported: false,
    containerName: 'AuthService',
    signature: 'async authenticate(email: string, password: string): Promise<Session>',
  },
  lineHits: [
    { line: 22, preview: 'async authenticate(email: string, password: string): Promise<Session>' },
    { line: 12, preview: 'const MAX_LOGIN_ATTEMPTS = 5' },
  ],
  importance: 0.692272,
};

const HIT_NO_SYMBOL: SearchHit = {
  path: 'src/utils/logger.ts',
  score: 45,
  matchKinds: ['filename-exact'],
  symbol: null,
  lineHits: [],
  importance: 0.626938,
};

describe('SearchResultRow', () => {
  test('renders the path, symbol kind/name, and match-kind badges', () => {
    render(<SearchResultRow hit={HIT_WITH_SYMBOL} isSelected={false} onOpenFile={vi.fn()} />);
    expect(screen.getByText('src/services/auth.service.ts')).toBeInTheDocument();
    expect(screen.getByText('method')).toBeInTheDocument();
    expect(screen.getByText('authenticate')).toBeInTheDocument();
    expect(screen.getByText('symbol-exact')).toBeInTheDocument();
  });

  test('clicking the row opens the file AT the symbol\'s line, not just the file', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(<SearchResultRow hit={HIT_WITH_SYMBOL} isSelected={false} onOpenFile={onOpenFile} />);

    await user.click(screen.getByRole('button', { name: /open src\/services\/auth\.service\.ts, line 22/i }));

    expect(onOpenFile).toHaveBeenCalledWith('src/services/auth.service.ts', 22);
  });

  test('clicking a specific line-hit preview opens the file at THAT line', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(<SearchResultRow hit={HIT_WITH_SYMBOL} isSelected={false} onOpenFile={onOpenFile} />);

    await user.click(screen.getByRole('button', { name: /jump to line 12/i }));

    expect(onOpenFile).toHaveBeenCalledWith('src/services/auth.service.ts', 12);
  });

  test('a hit with no symbol and no lineHits opens the file with no line', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(<SearchResultRow hit={HIT_NO_SYMBOL} isSelected={false} onOpenFile={onOpenFile} />);

    await user.click(screen.getByRole('button', { name: /open src\/utils\/logger\.ts/i }));

    expect(onOpenFile).toHaveBeenCalledWith('src/utils/logger.ts', undefined);
  });

  test('marks the keyboard-selected row distinctly', () => {
    render(<SearchResultRow hit={HIT_WITH_SYMBOL} isSelected onOpenFile={vi.fn()} />);
    expect(screen.getByRole('option', { selected: true })).toBeInTheDocument();
  });
});
