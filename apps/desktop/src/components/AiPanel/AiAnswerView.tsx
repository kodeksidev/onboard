import type { JSX } from 'react';
import type { AppError } from '@onboard/contract';
import { AI_PANEL_COPY, resolveAiErrorCopy } from '@/copy/messages';
import { ErrorState } from '@/components/ErrorState/ErrorState';
import type { AiRequestState } from '@/state/aiStore';
import { AnswerMarkdown } from './AnswerMarkdown';
import { SentPayloadDisclosure } from './SentPayloadDisclosure';

export interface AiAnswerViewProps {
  readonly state: AiRequestState;
  /** The configured provider — needed for the two error titles that interpolate it, and for the payload line. */
  readonly provider: string;
  /** What this particular panel has not been asked to do yet, in its own words. */
  readonly idleDescription: string;
  readonly onOpenFile: (path: string, line?: number) => void;
}

/**
 * `E_AI_CITATION_REJECTED` renders here like any other failure, and that is
 * the point: the state carries no result, so there is no code path on which a
 * withheld answer's body — or any fragment of it — can appear. The offending
 * path is named (Section 10) so the user knows what was wrong with it.
 */
function AiErrorView({
  error,
  provider,
}: {
  readonly error: AppError;
  readonly provider: string;
}): JSX.Element {
  const copy = resolveAiErrorCopy(error, provider);
  return <ErrorState title={copy.title} description={copy.description} detail={error.detail} />;
}

/**
 * The four outcomes this codebase has already been bitten by conflating —
 * "nothing yet", "still running", "failed", and "succeeded but empty" — each
 * rendered as a visibly different thing:
 *
 *   idle     a sentence saying what will happen if you ask, and what gets sent
 *   loading  a live-region status line
 *   error    the specific Section 10 copy for that code, never a generic blank
 *   empty    a named "the answer itself was empty" state, WITH the payload
 *            line — bytes really did leave the machine, so it is still stated
 *   success  the answer plus the payload line
 */
export function AiAnswerView({ state, provider, idleDescription, onOpenFile }: AiAnswerViewProps): JSX.Element {
  if (state.status === 'idle') {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{idleDescription}</p>;
  }
  if (state.status === 'loading') {
    return (
      <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
        {AI_PANEL_COPY.loadingLabel}
      </p>
    );
  }
  if (state.status === 'error') {
    return <AiErrorView error={state.error} provider={provider} />;
  }

  const { markdown, citedPaths, sentFileCount, sentByteCount } = state.result;
  return (
    <div className="flex flex-col gap-2">
      {markdown.trim() === '' ? (
        <div>
          <p className="text-sm font-medium">{AI_PANEL_COPY.emptyAnswer.title}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {AI_PANEL_COPY.emptyAnswer.description}
          </p>
        </div>
      ) : (
        <AnswerMarkdown markdown={markdown} citedPaths={citedPaths} onOpenFile={onOpenFile} />
      )}
      <SentPayloadDisclosure
        provider={provider}
        sentFileCount={sentFileCount}
        sentByteCount={sentByteCount}
      />
    </div>
  );
}
