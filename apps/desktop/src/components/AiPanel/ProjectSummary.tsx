import type { JSX } from 'react';
import { AI_PANEL_COPY } from '@/copy/messages';
import { Button } from '@/components/ui/button';
import { useAiStore } from '@/state/aiStore';
import { useSettingsStore } from '@/state/settingsStore';
import { AiAnswerView } from './AiAnswerView';

export interface ProjectSummaryProps {
  readonly repoId: string;
  readonly onOpenFile: (path: string, line?: number) => void;
}

/**
 * `ai_project_summary { repoId }` (Section 7.4). Only ever mounted by
 * `AiPanel` once `resolveAiAvailability` says `ready`, so the button is a
 * live control the moment it is visible — the "AI is off" case is a
 * different, explained screen, not a greyed-out button here.
 */
export function ProjectSummary({ repoId, onOpenFile }: ProjectSummaryProps): JSX.Element {
  const state = useAiStore((store) => store.slots.summary);
  const requestProjectSummary = useAiStore((store) => store.requestProjectSummary);
  const provider = useSettingsStore((store) => store.settings.ai.provider);
  const isLoading = state.status === 'loading';

  return (
    <section aria-labelledby="ai-project-summary-title" className="flex flex-col gap-3">
      <h3 id="ai-project-summary-title" className="text-sm font-semibold">
        {AI_PANEL_COPY.summaryTitle}
      </h3>
      <div>
        <Button
          type="button"
          size="sm"
          disabled={isLoading}
          onClick={() => {
            void requestProjectSummary(repoId);
          }}
        >
          {isLoading ? AI_PANEL_COPY.loadingLabel : AI_PANEL_COPY.summaryAction}
        </Button>
      </div>
      <AiAnswerView
        state={state}
        provider={provider}
        idleDescription={AI_PANEL_COPY.summaryIdle}
        onOpenFile={onOpenFile}
      />
    </section>
  );
}
