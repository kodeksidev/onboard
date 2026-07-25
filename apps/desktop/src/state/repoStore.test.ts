import { afterEach, describe, expect, test, vi } from 'vitest';
import { ipc } from '@/ipc/ipc';
import { useRepoStore } from './repoStore';

function resetStore(): void {
  useRepoStore.setState({
    status: 'empty',
    repoPath: null,
    envelope: null,
    progress: null,
    error: null,
  });
}

afterEach(() => {
  resetStore();
});

describe('repoStore', () => {
  test('starts in the empty state', () => {
    expect(useRepoStore.getState().status).toBe('empty');
  });

  test('pickFolder walks empty -> picking -> analyzing -> ready and stores the parsed envelope', async () => {
    const analyzePromise = useRepoStore.getState().pickFolder();

    expect(useRepoStore.getState().status).toBe('picking');

    await analyzePromise;

    const state = useRepoStore.getState();
    expect(state.status).toBe('ready');
    expect(state.envelope?.result.repo.name).toBe('acme-billing-api');
    expect(state.progress).toBeNull();
  });

  test('progress updates while analysis runs', async () => {
    const seenPhases: string[] = [];
    const unsubscribe = ipc.onAnalysisProgress((event) => {
      seenPhases.push(event.phase);
    });

    await useRepoStore.getState().pickFolder();
    unsubscribe();

    expect(seenPhases.length).toBeGreaterThan(0);
  });

  test('a second concurrent pickFolder call is a no-op (Section 10: disable, never queue)', async () => {
    const pickSpy = vi.spyOn(ipc, 'pickRepoFolder');
    const first = useRepoStore.getState().pickFolder();
    const second = useRepoStore.getState().pickFolder(); // short-circuits: status is already 'picking'

    await Promise.all([first, second]);

    expect(pickSpy).toHaveBeenCalledTimes(1);
  });

  test('a rejected analyzeRepo call moves the store to the error state with an AppError', async () => {
    vi.spyOn(ipc, 'analyzeRepo').mockRejectedValueOnce({
      code: 'E_PATH_NOT_FOUND',
      message: 'Onboard could not find acme-api. It may have been moved, renamed, or deleted.',
      detail: null,
      path: 'acme-api',
    });

    await useRepoStore.getState().pickFolder();

    const state = useRepoStore.getState();
    expect(state.status).toBe('error');
    expect(state.error?.code).toBe('E_PATH_NOT_FOUND');
  });

  test('retry re-runs analysis for the same repo path after an error', async () => {
    vi.spyOn(ipc, 'analyzeRepo').mockRejectedValueOnce({
      code: 'E_ENGINE_CRASHED',
      message: 'The analysis engine exited before finishing.',
      detail: null,
      path: null,
    });
    await useRepoStore.getState().pickFolder();
    expect(useRepoStore.getState().status).toBe('error');

    await useRepoStore.getState().retry();

    expect(useRepoStore.getState().status).toBe('ready');
  });

  test('reset clears back to the empty state', async () => {
    await useRepoStore.getState().pickFolder();
    expect(useRepoStore.getState().status).toBe('ready');

    useRepoStore.getState().reset();

    expect(useRepoStore.getState()).toMatchObject({ status: 'empty', envelope: null, error: null });
  });
});
