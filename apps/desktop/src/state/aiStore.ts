import { create } from 'zustand';
import type { AppError } from '@onboard/contract';
import { ipc, parseIpcError } from '@/ipc/ipc';
import type { AiActionResult } from '@/ipc/ipc';

/**
 * One small store for the optional AI surfaces (Section 4: one store per
 * domain), separate from `settingsStore` (which owns whether AI is on at all)
 * and from `repoStore` (analysis lifecycle).
 *
 * It exists rather than three `useState` hooks for one concrete reason:
 * clicking a citation switches `App.tsx` to the File viewer tab, which
 * unmounts the AI panel. Component-local state would throw the answer away at
 * the exact moment the user acted on it, so the user would come back to an
 * empty panel and no explanation. The answers live here and survive the trip.
 *
 * Note what the `error` state does NOT carry: a result. An `E_AI_CITATION_REJECTED`
 * answer is rejected wholesale by the backend (Section 8.10 step 3), so the
 * failure REPLACES any previous success in the slot — there is no shape in
 * which this store can hand a component a body to render alongside that error.
 */
export type AiSlotId = 'summary' | 'module' | 'ask';

export type AiRequestState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: AppError }
  | { readonly status: 'success'; readonly result: AiActionResult };

const IDLE: AiRequestState = { status: 'idle' };

export interface AiState {
  readonly slots: Readonly<Record<AiSlotId, AiRequestState>>;
  requestProjectSummary: (repoId: string) => Promise<void>;
  requestModuleExplanation: (repoId: string, moduleId: string) => Promise<void>;
  requestAnswer: (repoId: string, question: string) => Promise<void>;
  reset: () => void;
}

function initialSlots(): Record<AiSlotId, AiRequestState> {
  return { summary: IDLE, module: IDLE, ask: IDLE };
}

export const useAiStore = create<AiState>((set, get) => {
  const setSlot = (slot: AiSlotId, state: AiRequestState): void => {
    set({ slots: { ...get().slots, [slot]: state } });
  };

  /**
   * Every rejection is normalized through `parseIpcError`, so a malformed
   * rejection can never reach a component as a raw string or a stack trace
   * (Section 12) — it becomes an `AppError` with a code the copy layer knows
   * how to name.
   */
  const run = async (slot: AiSlotId, action: () => Promise<AiActionResult>): Promise<void> => {
    setSlot(slot, { status: 'loading' });
    try {
      setSlot(slot, { status: 'success', result: await action() });
    } catch (error: unknown) {
      setSlot(slot, { status: 'error', error: parseIpcError(error) });
    }
  };

  return {
    slots: initialSlots(),
    requestProjectSummary: (repoId) => run('summary', () => ipc.aiProjectSummary({ repoId })),
    requestModuleExplanation: (repoId, moduleId) =>
      run('module', () => ipc.aiExplainModule({ repoId, moduleId })),
    requestAnswer: (repoId, question) => run('ask', () => ipc.aiAsk({ repoId, question })),
    reset: () => set({ slots: initialSlots() }),
  };
});
