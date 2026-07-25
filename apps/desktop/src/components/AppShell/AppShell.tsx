import type { JSX, ReactNode } from 'react';
import { useSettingsStore } from '@/state/settingsStore';
import { ModeIndicator } from './ModeIndicator';

export interface AppShellProps {
  readonly children: ReactNode;
}

/**
 * The single-window application frame (A17, Section 14). Owns the header
 * landmark (product name + the persistent mode indicator) and a `<main>`
 * landmark for whichever panel `App.tsx` currently renders.
 */
export function AppShell({ children }: AppShellProps): JSX.Element {
  const ai = useSettingsStore((state) => state.settings.ai);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <span className="text-sm font-semibold tracking-tight">Onboard</span>
        <ModeIndicator
          isEnabled={ai.isEnabled}
          provider={ai.provider}
          model={ai.model}
          hasStoredKey={ai.hasStoredKey}
        />
      </header>
      <main className="flex flex-1 flex-col overflow-auto">{children}</main>
    </div>
  );
}
