import { useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { AI_PANEL_COPY } from '@/copy/messages';
import { Button } from '@/components/ui/button';
import { useAiStore } from '@/state/aiStore';
import { useSettingsStore } from '@/state/settingsStore';
import { AiAnswerView } from './AiAnswerView';

export interface AskPanelProps {
  readonly repoId: string;
  readonly onOpenFile: (path: string, line?: number) => void;
}

/**
 * `ai_ask { repoId, question }` (Section 7.4). A real `<form>`, so Enter
 * submits from the field and the browser's own submit semantics apply — one
 * keyboard path, no custom key handling to get wrong.
 *
 * The submit button is disabled only while a request is in flight or the
 * question is empty; both are states in which pressing it could not do what
 * its label says.
 */
export function AskPanel({ repoId, onOpenFile }: AskPanelProps): JSX.Element {
  const state = useAiStore((store) => store.slots.ask);
  const requestAnswer = useAiStore((store) => store.requestAnswer);
  const provider = useSettingsStore((store) => store.settings.ai.provider);
  const [question, setQuestion] = useState('');
  const isLoading = state.status === 'loading';
  const trimmedQuestion = question.trim();

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (trimmedQuestion === '' || isLoading) {
      return;
    }
    void requestAnswer(repoId, trimmedQuestion);
  };

  return (
    <section aria-labelledby="ai-ask-title" className="flex flex-col gap-3">
      <h3 id="ai-ask-title" className="text-sm font-semibold">
        {AI_PANEL_COPY.askTitle}
      </h3>
      <form className="flex flex-wrap items-end gap-2" onSubmit={handleSubmit}>
        <label className="flex flex-1 flex-col gap-1 text-sm" htmlFor="ai-ask-input">
          {AI_PANEL_COPY.askInputLabel}
          <input
            id="ai-ask-input"
            type="text"
            value={question}
            placeholder={AI_PANEL_COPY.askPlaceholder}
            onChange={(event) => setQuestion(event.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <Button type="submit" size="sm" disabled={isLoading || trimmedQuestion === ''}>
          {isLoading ? AI_PANEL_COPY.loadingLabel : AI_PANEL_COPY.askAction}
        </Button>
      </form>
      <AiAnswerView
        state={state}
        provider={provider}
        idleDescription={AI_PANEL_COPY.askIdle}
        onOpenFile={onOpenFile}
      />
    </section>
  );
}
