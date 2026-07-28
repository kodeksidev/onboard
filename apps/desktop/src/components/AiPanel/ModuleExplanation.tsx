import { useState } from 'react';
import type { JSX } from 'react';
import type { ModuleCard } from '@/components/ModuleMap/ModuleCardView';
import { AI_PANEL_COPY } from '@/copy/messages';
import { Button } from '@/components/ui/button';
import { useAiStore } from '@/state/aiStore';
import { useSettingsStore } from '@/state/settingsStore';
import { AiAnswerView } from './AiAnswerView';

export interface ModuleExplanationProps {
  readonly repoId: string;
  /** `AnalysisResult.modules` — the same cards the Module map tab renders. */
  readonly modules: readonly ModuleCard[];
  readonly onOpenFile: (path: string, line?: number) => void;
}

const FIELD_CLASS =
  'rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900';

/**
 * `ai_explain_module { repoId, moduleId }` (Section 7.4). The `moduleId` comes
 * from the analysis itself — a picker over `result.modules`, never a free-text
 * field — so the command can only ever be called with an id the engine
 * produced.
 *
 * A repo with no modules gets a sentence explaining that, and no button: a
 * disabled "Explain this module" with nothing to explain would be a control
 * that cannot do what its label says.
 */
function ModulePicker({
  modules,
  moduleId,
  onSelect,
}: {
  readonly modules: readonly ModuleCard[];
  readonly moduleId: string;
  readonly onSelect: (moduleId: string) => void;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor="ai-module-select">
      {AI_PANEL_COPY.moduleSelectLabel}
      <select
        id="ai-module-select"
        value={moduleId}
        onChange={(event) => onSelect(event.target.value)}
        className={FIELD_CLASS}
      >
        {modules.map((module) => (
          <option key={module.id} value={module.id}>
            {module.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ModuleExplanation({ repoId, modules, onOpenFile }: ModuleExplanationProps): JSX.Element {
  const state = useAiStore((store) => store.slots.module);
  const requestModuleExplanation = useAiStore((store) => store.requestModuleExplanation);
  const provider = useSettingsStore((store) => store.settings.ai.provider);
  const [moduleId, setModuleId] = useState(modules[0]?.id ?? '');
  const isLoading = state.status === 'loading';

  return (
    <section aria-labelledby="ai-module-explanation-title" className="flex flex-col gap-3">
      <h3 id="ai-module-explanation-title" className="text-sm font-semibold">
        {AI_PANEL_COPY.moduleTitle}
      </h3>
      {modules.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{AI_PANEL_COPY.moduleNone}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <ModulePicker modules={modules} moduleId={moduleId} onSelect={setModuleId} />
            <Button
              type="button"
              size="sm"
              disabled={isLoading || moduleId === ''}
              onClick={() => {
                void requestModuleExplanation(repoId, moduleId);
              }}
            >
              {isLoading ? AI_PANEL_COPY.loadingLabel : AI_PANEL_COPY.moduleAction}
            </Button>
          </div>
          <AiAnswerView
            state={state}
            provider={provider}
            idleDescription={AI_PANEL_COPY.moduleIdle}
            onOpenFile={onOpenFile}
          />
        </>
      )}
    </section>
  );
}
