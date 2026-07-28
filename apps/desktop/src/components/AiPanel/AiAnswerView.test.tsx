import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiAnswerView } from './AiAnswerView';
import type { AiRequestState } from '@/state/aiStore';

const IDLE_COPY = 'Nothing requested yet.';

function renderState(state: AiRequestState, provider = 'anthropic') {
  return render(
    <AiAnswerView
      state={state}
      provider={provider}
      idleDescription={IDLE_COPY}
      onOpenFile={vi.fn()}
    />,
  );
}

/**
 * The defect this file exists to prevent: a panel where "nothing yet",
 * "still running", "failed" and "succeeded but empty" all look like the same
 * blank rectangle. Each assertion below is that two of those four are
 * distinguishable to a user.
 */
describe('AiAnswerView states', () => {
  test('idle says what will happen if you ask, and never looks like a result', () => {
    renderState({ status: 'idle' });

    expect(screen.getByText(IDLE_COPY)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sent /)).not.toBeInTheDocument();
  });

  test('loading announces itself in a live region', () => {
    renderState({ status: 'loading' });

    expect(screen.getByRole('status')).toHaveTextContent('Asking the model…');
  });

  test('a successful answer renders its citations and its real payload counts', () => {
    renderState({
      status: 'success',
      result: {
        markdown: 'Start at [[src/index.ts:12]].',
        citedPaths: ['src/index.ts'],
        sentFileCount: 4,
        sentByteCount: 8_192,
      },
    });

    expect(screen.getByRole('button', { name: 'Open src/index.ts, line 12' })).toBeInTheDocument();
    expect(screen.getByText(/4 files/)).toHaveTextContent('8192 bytes');
  });

  test('an empty answer is named as empty, and still states what was sent', () => {
    renderState({
      status: 'success',
      result: { markdown: '   \n  ', citedPaths: [], sentFileCount: 2, sentByteCount: 4_096 },
    });

    expect(screen.getByText('The model returned an empty answer')).toBeInTheDocument();
    expect(screen.getByText(/2 files/)).toHaveTextContent('4096 bytes');
  });

  test('E_AI_RATE_LIMITED names the provider that is throttling, not a generic failure', () => {
    renderState(
      {
        status: 'error',
        error: {
          code: 'E_AI_RATE_LIMITED',
          message: 'Wait 30s and try again. Nothing was sent twice.',
          detail: null,
          path: null,
        },
      },
      'anthropic',
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('anthropic is rate-limiting Onboard');
    expect(alert).toHaveTextContent('Wait 30s and try again. Nothing was sent twice.');
    expect(alert).not.toHaveTextContent('Something went wrong');
  });

  test('E_AI_DISABLED explains that AI is off rather than showing a generic error', () => {
    renderState({
      status: 'error',
      error: {
        code: 'E_AI_DISABLED',
        message: 'Onboard did not send anything. Turn on AI in Settings.',
        detail: null,
        path: null,
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('AI is off');
  });
});

/**
 * Criterion 18 / Section 8.10 step 3: a citation that fails verification
 * suppresses the WHOLE answer. The store's error state carries no result, so
 * there is nothing for this view to leak — these assertions pin that the view
 * agrees, and that the offending path from `AppError.path` is named.
 */
describe('AiAnswerView on E_AI_CITATION_REJECTED', () => {
  const REJECTED: AiRequestState = {
    status: 'error',
    error: {
      code: 'E_AI_CITATION_REJECTED',
      message: 'The model referenced src/does-not-exist.ts, which is not in the index.',
      detail: null,
      path: 'src/does-not-exist.ts',
    },
  };

  test('renders the Section 10 copy with the real offending path interpolated', () => {
    renderState(REJECTED);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Answer withheld — it cited files that aren't in this repo");
    expect(alert).toHaveTextContent(
      "The model referenced src/does-not-exist.ts, which is not in the index. Onboard never shows paths it can't verify. Try a narrower question.",
    );
  });

  test('renders no answer body and no citation link at all', () => {
    const { container } = renderState(REJECTED);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.textContent).not.toContain('[[');
    expect(screen.queryByText(/Sent /)).not.toBeInTheDocument();
  });
});
