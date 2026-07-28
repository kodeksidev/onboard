import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { AI_PANEL_COPY, SETTINGS_COPY } from '@/copy/messages';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useSettingsStore } from '@/state/settingsStore';
import { resolveAiAvailability } from './ai-availability';
import type { AiAvailability } from './ai-availability';
import { ProjectSummary } from './ProjectSummary';
import { ModuleExplanation } from './ModuleExplanation';
import { AskPanel } from './AskPanel';

export interface AiPanelProps {
  readonly result: AnalysisResult;
  readonly onOpenFile: (path: string, line?: number) => void;
}

/**
 * A5: with AI off (the default) the three action panels are never mounted, so
 * no `ai_*` command can be issued from this screen — the app makes zero calls
 * and the network is never touched.
 *
 * What replaces them is not a greyed-out copy of the same UI: it is a state
 * that says which of the two reasons applies (master toggle off vs. a
 * credentialed provider with no stored key) and offers the one control that
 * fixes it. The button opens the real Settings dialog — it does exactly what
 * its label says.
 */
function AiUnavailable({
  availability,
  provider,
}: {
  readonly availability: Exclude<AiAvailability, 'ready'>;
  readonly provider: string;
}): JSX.Element {
  const openSettings = useSettingsStore((store) => store.openSettings);
  const copy =
    availability === 'disabled'
      ? AI_PANEL_COPY.unavailableDisabled()
      : AI_PANEL_COPY.unavailableMissingKey(provider);

  return (
    <EmptyState
      title={copy.title}
      description={copy.description}
      actionLabel={SETTINGS_COPY.dialogTitle}
      onAction={openSettings}
    />
  );
}

/** The "Ask AI" tab: the three Section 7.4 `ai_*` actions, gated by the same rule the Rust side enforces. */
export function AiPanel({ result, onOpenFile }: AiPanelProps): JSX.Element {
  const ai = useSettingsStore((store) => store.settings.ai);
  const availability = resolveAiAvailability(ai);
  const repoId = result.repo.id;

  return (
    <section aria-labelledby="ai-panel-title" className="flex flex-col gap-6 p-4">
      <div className="flex flex-col gap-1">
        <h2 id="ai-panel-title" className="text-lg font-semibold">
          {AI_PANEL_COPY.title}
        </h2>
        <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          {AI_PANEL_COPY.description}
        </p>
      </div>
      {availability === 'ready' ? (
        <>
          <ProjectSummary repoId={repoId} onOpenFile={onOpenFile} />
          <ModuleExplanation repoId={repoId} modules={result.modules} onOpenFile={onOpenFile} />
          <AskPanel repoId={repoId} onOpenFile={onOpenFile} />
        </>
      ) : (
        <AiUnavailable availability={availability} provider={ai.provider} />
      )}
    </section>
  );
}
