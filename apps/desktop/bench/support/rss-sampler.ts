/**
 * Section 11: "Sidecar peak RSS at 10,000 files | <= 1,536 MB | sampled
 * every 250 ms by the bench harness." Windows-only (this bench environment,
 * A19) — samples a PID's working-set size via PowerShell every 250 ms and
 * tracks the maximum observed while the caller's async work is in flight.
 */

const SAMPLE_INTERVAL_MS = 250;
const BYTES_PER_MB = 1024 * 1024;

async function sampleWorkingSetMb(pid: number): Promise<number | null> {
  const proc = Bun.spawn(
    ['powershell', '-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${String(pid)}).WorkingSet64`],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  const output = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  const bytes = Number(output);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  return bytes / BYTES_PER_MB;
}

export interface RssMonitor {
  /** Stops sampling and returns the peak working-set size observed, in MB (or `null` if the process never sampled successfully — e.g. it exited before the first sample). */
  stop(): Promise<number | null>;
}

/** Starts polling `pid`'s working-set size until `stop()` is called. */
export function startRssMonitor(pid: number): RssMonitor {
  let peakMb: number | null = null;
  let isStopped = false;

  const loop = (async (): Promise<void> => {
    while (!isStopped) {
      const sampleMb = await sampleWorkingSetMb(pid).catch(() => null);
      if (sampleMb !== null && (peakMb === null || sampleMb > peakMb)) {
        peakMb = sampleMb;
      }
      await Bun.sleep(SAMPLE_INTERVAL_MS);
    }
  })();

  return {
    stop: async (): Promise<number | null> => {
      isStopped = true;
      await loop;
      return peakMb;
    },
  };
}
