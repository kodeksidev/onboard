import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnswerMarkdown } from './AnswerMarkdown';

const CITED = ['src/index.ts', 'src/db/client.ts'];

describe('AnswerMarkdown', () => {
  test('renders every verified [[path:line]] token as a jump link', () => {
    render(
      <AnswerMarkdown
        markdown="Start at [[src/index.ts:12]], then read [[src/db/client.ts:3]]."
        citedPaths={CITED}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Open src/index.ts, line 12' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open src/db/client.ts, line 3' })).toBeInTheDocument();
  });

  test('clicking a citation opens that path at that line', async () => {
    const onOpenFile = vi.fn();
    const user = userEvent.setup();
    render(
      <AnswerMarkdown
        markdown="Start at [[src/index.ts:12]]."
        citedPaths={CITED}
        onOpenFile={onOpenFile}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open src/index.ts, line 12' }));

    expect(onOpenFile).toHaveBeenCalledWith('src/index.ts', 12);
  });

  /**
   * The load-bearing rule (Section 8.10): the UI must never manufacture a
   * link the backend did not verify. A path that appears as prose or as
   * inline code is exactly the kind of unverified path verification exists
   * to keep out.
   */
  test('never linkifies a bare path in the prose', () => {
    render(
      <AnswerMarkdown
        markdown="Look at src/secrets/keys.ts and `../../etc/passwd`."
        citedPaths={CITED}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/Look at src\/secrets\/keys\.ts and/)).toBeInTheDocument();
  });

  test('renders a token whose path the backend did not cite as inert text, not a link', () => {
    render(
      <AnswerMarkdown
        markdown="See [[src/not-verified.ts:4]]."
        citedPaths={CITED}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/src\/not-verified\.ts:4/)).toBeInTheDocument();
  });

  test('renders headings, bullets and code blocks from the answer markdown', () => {
    render(
      <AnswerMarkdown
        markdown={'## Overview\n\n- first point\n- second point\n\n```ts\nconst a = 1;\n```'}
        citedPaths={CITED}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
  });
});
