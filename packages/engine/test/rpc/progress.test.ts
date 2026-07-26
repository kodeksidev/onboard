import { describe, expect, test } from 'bun:test';
import { createProgressReporter } from '../../src/rpc/progress';

function progressAt(processed: number): { phase: 'walk'; processed: number; total: number; currentPath: null } {
  return { phase: 'walk', processed, total: 100, currentPath: null };
}

describe('createProgressReporter — throttling (Section 7.3: "at most every 100 ms")', () => {
  test('emits the first report immediately', () => {
    const emitted: number[] = [];
    const clock = 0;
    const reporter = createProgressReporter((p) => emitted.push(p.processed), 100, () => clock);
    reporter.report(progressAt(1));
    expect(emitted).toEqual([1]);
  });

  test('suppresses a second report within the throttle window', () => {
    const emitted: number[] = [];
    let clock = 0;
    const reporter = createProgressReporter((p) => emitted.push(p.processed), 100, () => clock);
    reporter.report(progressAt(1));
    clock = 50;
    reporter.report(progressAt(2));
    expect(emitted).toEqual([1]);
  });

  test('emits again once the throttle window has elapsed', () => {
    const emitted: number[] = [];
    let clock = 0;
    const reporter = createProgressReporter((p) => emitted.push(p.processed), 100, () => clock);
    reporter.report(progressAt(1));
    clock = 150;
    reporter.report(progressAt(2));
    expect(emitted).toEqual([1, 2]);
  });

  test('force bypasses the throttle window', () => {
    const emitted: number[] = [];
    let clock = 0;
    const reporter = createProgressReporter((p) => emitted.push(p.processed), 100, () => clock);
    reporter.report(progressAt(1));
    clock = 10;
    reporter.report(progressAt(2), true);
    expect(emitted).toEqual([1, 2]);
  });

  test('a forced emission resets the throttle window for subsequent non-forced calls', () => {
    const emitted: number[] = [];
    let clock = 0;
    const reporter = createProgressReporter((p) => emitted.push(p.processed), 100, () => clock);
    reporter.report(progressAt(1));
    clock = 10;
    reporter.report(progressAt(2), true);
    clock = 50;
    reporter.report(progressAt(3));
    expect(emitted).toEqual([1, 2]);
  });
});
