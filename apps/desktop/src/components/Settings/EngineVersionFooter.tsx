import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { EngineInfo } from '@/ipc/ipc';
import { ipc } from '@/ipc/ipc';

/**
 * Read-only diagnostic line at the bottom of Settings: the app version
 * plus whatever `engine.version` the running sidecar last actually
 * answered with. `engineVersion`/`grammarFingerprint` are `null` until
 * that handshake has happened at least once (before any analysis, or if
 * the sidecar was never found) — shown as "not yet known" rather than
 * blank, so it reads as a real state, not a loading flicker.
 *
 * This exists because nothing else in the UI ever showed which engine was
 * actually running, and the one time that mattered (docs/DECISIONS.md,
 * "engine.version was answered and discarded") only a diff against a
 * checked-out git history caught it — not the running app.
 */
export function EngineVersionFooter(): JSX.Element | null {
  const [info, setInfo] = useState<EngineInfo | null>(null);

  useEffect(() => {
    let isCancelled = false;
    void ipc.getEngineInfo().then((result) => {
      if (!isCancelled) {
        setInfo(result);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  if (info === null) {
    return null;
  }

  return (
    <p className="border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
      Onboard {info.appVersion} · engine {info.engineVersion ?? 'not yet known'}
      {info.contractSchemaVersion !== null ? ` · schema ${String(info.contractSchemaVersion)}` : ''}
    </p>
  );
}
