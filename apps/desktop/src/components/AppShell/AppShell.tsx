import type { JSX, ReactNode } from 'react';
import { useSettingsStore } from '@/state/settingsStore';
import { SETTINGS_COPY } from '@/copy/messages';
import { Button } from '@/components/ui/button';
import { SettingsDialog } from '@/components/Settings/SettingsDialog';
import { ModeIndicator } from './ModeIndicator';

export interface AppShellProps {
  readonly children: ReactNode;
}

/**
 * The single-window application frame (A17, Section 14). Owns the header
 * landmark (product name + the persistent mode indicator + the Settings
 * trigger, Phase 12 step 5) and a `<main>` landmark for whichever panel
 * `App.tsx` currently renders.
 */
export function AppShell({ children }: AppShellProps): JSX.Element {
  const ai = useSettingsStore((state) => state.settings.ai);
  // In `settingsStore` rather than local state so any panel that diagnoses a
  // settings problem (the AI panel's "AI is off" screen) can open the one
  // dialog instead of describing where to find it.
  const isSettingsOpen = useSettingsStore((state) => state.isSettingsOpen);
  const openSettings = useSettingsStore((state) => state.openSettings);
  const closeSettings = useSettingsStore((state) => state.closeSettings);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <span className="text-sm font-semibold tracking-tight">Onboard</span>
        <div className="flex items-center gap-3">
          <ModeIndicator
            isEnabled={ai.isEnabled}
            provider={ai.provider}
            model={ai.model}
            hasStoredKey={ai.hasStoredKey}
          />
          <Button type="button" variant="ghost" size="sm" onClick={openSettings}>
            {SETTINGS_COPY.dialogTitle}
          </Button>
        </div>
      </header>
      <main className="flex flex-1 flex-col overflow-auto">{children}</main>
      <SettingsDialog isOpen={isSettingsOpen} onClose={closeSettings} />
    </div>
  );
}
