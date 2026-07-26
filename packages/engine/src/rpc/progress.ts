/**
 * @onboard/engine — throttled `engine.progress` notification emission
 * (Section 7.3: "emitted at most every 100 ms").
 */
import type { EngineProgress } from '@onboard/contract';

const DEFAULT_THROTTLE_MS = 100;

export interface ProgressReporter {
  /**
   * Reports progress. Suppressed if less than the throttle interval has
   * elapsed since the last *emitted* call, unless `force` is set — callers
   * should pass `force: true` for a phase's first and last notification so
   * a fast phase is never silently dropped entirely.
   */
  report(progress: EngineProgress, force?: boolean): void;
}

/** `now` is injectable so throttling is testable without real wall-clock waits. */
export function createProgressReporter(
  emit: (progress: EngineProgress) => void,
  throttleMs: number = DEFAULT_THROTTLE_MS,
  now: () => number = () => Date.now(),
): ProgressReporter {
  let lastEmitMs: number | null = null;
  return {
    report(progress: EngineProgress, force = false): void {
      const nowMs = now();
      if (!force && lastEmitMs !== null && nowMs - lastEmitMs < throttleMs) {
        return;
      }
      lastEmitMs = nowMs;
      emit(progress);
    },
  };
}
