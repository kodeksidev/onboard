import { afterEach, describe, expect, test, vi } from 'vitest';
import { ipc } from '@/ipc/ipc';
import { useAiStore } from './aiStore';

const ANSWER = {
  markdown: 'Start at [[src/index.ts:1]].',
  citedPaths: ['src/index.ts'],
  sentFileCount: 1,
  sentByteCount: 2_048,
};

afterEach(() => {
  useAiStore.getState().reset();
});

describe('aiStore', () => {
  test('a successful request holds the answer so it survives a trip to the file viewer', async () => {
    vi.spyOn(ipc, 'aiProjectSummary').mockResolvedValue(ANSWER);

    await useAiStore.getState().requestProjectSummary('repo-1');

    expect(useAiStore.getState().slots.summary).toEqual({ status: 'success', result: ANSWER });
  });

  /**
   * Section 8.10 step 3: a rejected answer is rejected WHOLESALE. The failure
   * must therefore replace whatever the slot held, or a later citation
   * rejection could leave an earlier answer on screen underneath the error and
   * imply the model's latest claim was verified.
   */
  test('a failure replaces the previous answer entirely — no body survives alongside an error', async () => {
    vi.spyOn(ipc, 'aiProjectSummary').mockResolvedValueOnce(ANSWER);
    await useAiStore.getState().requestProjectSummary('repo-1');

    vi.spyOn(ipc, 'aiProjectSummary').mockRejectedValueOnce({
      code: 'E_AI_CITATION_REJECTED',
      message: 'The model referenced src/nope.ts, which is not in the index.',
      detail: null,
      path: 'src/nope.ts',
    });
    await useAiStore.getState().requestProjectSummary('repo-1');

    const slot = useAiStore.getState().slots.summary;
    expect(slot.status).toBe('error');
    expect(JSON.stringify(slot)).not.toContain('src/index.ts');
  });

  test('a non-AppError rejection is normalized rather than reaching the UI raw', async () => {
    vi.spyOn(ipc, 'aiAsk').mockRejectedValueOnce(new TypeError('window is not defined'));

    await useAiStore.getState().requestAnswer('repo-1', 'where is auth?');

    const slot = useAiStore.getState().slots.ask;
    expect(slot.status === 'error' ? slot.error.code : null).toBe('E_UNEXPECTED');
  });

  test('the three slots are independent — one failure does not blank the others', async () => {
    vi.spyOn(ipc, 'aiProjectSummary').mockResolvedValue(ANSWER);
    vi.spyOn(ipc, 'aiAsk').mockRejectedValueOnce({
      code: 'E_AI_RATE_LIMITED',
      message: 'Wait 30s and try again. Nothing was sent twice.',
      detail: null,
      path: null,
    });

    await useAiStore.getState().requestProjectSummary('repo-1');
    await useAiStore.getState().requestAnswer('repo-1', 'where is auth?');

    expect(useAiStore.getState().slots.summary.status).toBe('success');
    expect(useAiStore.getState().slots.ask.status).toBe('error');
    expect(useAiStore.getState().slots.module.status).toBe('idle');
  });
});
