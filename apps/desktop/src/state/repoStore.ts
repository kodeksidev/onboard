import { create } from 'zustand';
import { AnalysisEnvelope } from '@onboard/contract';
import type { AppError, EngineProgress } from '@onboard/contract';
import { ipc, parseIpcError } from '@/ipc/ipc';

export type RepoStatus = 'empty' | 'picking' | 'analyzing' | 'ready' | 'error';

export interface RepoState {
  readonly status: RepoStatus;
  readonly repoPath: string | null;
  readonly envelope: AnalysisEnvelope | null;
  readonly progress: EngineProgress | null;
  readonly error: AppError | null;
  pickFolder: () => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
}

/**
 * Section 12: "the frontend re-parses AnalysisEnvelope with zod so contract
 * drift fails loudly instead of rendering garbage." This is the one place
 * that re-parse happens, regardless of which `OnboardIpc` implementation
 * supplied the raw response.
 */
function toAppError(error: unknown): AppError {
  if (error instanceof Error && error.name === 'ZodError') {
    return {
      code: 'E_CONTRACT_DRIFT',
      message: 'Onboard received analysis data it does not understand.',
      detail: error.message,
      path: null,
    };
  }
  return parseIpcError(error);
}

export const useRepoStore = create<RepoState>((set, get) => ({
  status: 'empty',
  repoPath: null,
  envelope: null,
  progress: null,
  error: null,

  pickFolder: async () => {
    // Section 10: a second analysis while one runs disables the picker
    // rather than queueing. Guarding synchronously here (before the folder
    // dialog's await) closes the window a rapid double-invocation would
    // otherwise slip through.
    if (get().status === 'picking' || get().status === 'analyzing') {
      return;
    }
    set({ status: 'picking' });
    const { path } = await ipc.pickRepoFolder();
    if (path === null) {
      set({ status: 'empty' });
      return;
    }
    await runAnalysis(path, set);
  },

  retry: async () => {
    const { repoPath, status } = get();
    if (repoPath === null || status === 'analyzing' || status === 'picking') {
      return;
    }
    await runAnalysis(repoPath, set);
  },

  reset: () => {
    set({ status: 'empty', repoPath: null, envelope: null, progress: null, error: null });
  },
}));

async function runAnalysis(
  path: string,
  set: (partial: Partial<RepoState>) => void,
): Promise<void> {
  set({ status: 'analyzing', repoPath: path, error: null, progress: null });
  const unsubscribe = ipc.onAnalysisProgress((progress) => set({ progress }));
  try {
    const rawEnvelope = await ipc.analyzeRepo({ path, isForceRefresh: false });
    const envelope = AnalysisEnvelope.parse(rawEnvelope);
    set({ status: 'ready', envelope, progress: null });
  } catch (error: unknown) {
    set({ status: 'error', error: toAppError(error) });
  } finally {
    unsubscribe();
  }
}
