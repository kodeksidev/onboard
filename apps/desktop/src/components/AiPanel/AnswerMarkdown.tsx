import { useMemo } from 'react';
import type { JSX } from 'react';
import { CitationLink } from './CitationLink';
import { parseAnswerBlocks } from './answer-tokens';
import type { AnswerBlock, AnswerSegment } from './answer-tokens';

export interface AnswerMarkdownProps {
  readonly markdown: string;
  /**
   * `AiActionResult.citedPaths` — the paths the backend verified against the
   * index (Section 8.10) for THIS answer. Nothing else may become a link.
   */
  readonly citedPaths: readonly string[];
  readonly onOpenFile: (path: string, line?: number) => void;
}

interface SegmentContext {
  readonly verifiedPaths: ReadonlySet<string>;
  readonly onOpenFile: (path: string, line?: number) => void;
}

/**
 * The two gates that stand between model output and a clickable path, both
 * required, neither sufficient:
 *
 *   1. Only a `[[path:line]]` token parses as a citation at all — the token
 *      form only exists because the backend's verifier wrote it (Section 8.10
 *      step 4). Prose paths and backticked paths are inert by construction,
 *      in `answer-tokens.ts`.
 *   2. Even a token is only linked if its path is in `citedPaths` from the
 *      same response. A token whose path the backend did not cite renders as
 *      plain text — visible, so nothing is silently swallowed, but not
 *      actionable.
 */
function SegmentView({
  segment,
  context,
}: {
  readonly segment: AnswerSegment;
  readonly context: SegmentContext;
}): JSX.Element {
  if (segment.kind === 'code') {
    return <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800">{segment.text}</code>;
  }
  if (segment.kind === 'strong') {
    return <strong>{segment.text}</strong>;
  }
  if (segment.kind === 'citation') {
    if (!context.verifiedPaths.has(segment.path)) {
      return <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{segment.path}:{segment.line}</span>;
    }
    return <CitationLink path={segment.path} line={segment.line} onOpenFile={context.onOpenFile} />;
  }
  return <>{segment.text}</>;
}

function Segments({
  segments,
  context,
}: {
  readonly segments: readonly AnswerSegment[];
  readonly context: SegmentContext;
}): JSX.Element {
  return (
    <>
      {segments.map((segment, index) => (
        <SegmentView key={index} segment={segment} context={context} />
      ))}
    </>
  );
}

function ListItems({
  items,
  context,
}: {
  readonly items: readonly (readonly AnswerSegment[])[];
  readonly context: SegmentContext;
}): JSX.Element {
  return (
    <>
      {items.map((item, index) => (
        <li key={index}>
          <Segments segments={item} context={context} />
        </li>
      ))}
    </>
  );
}

/**
 * `h4` because an answer always renders inside a panel that already owns an
 * `h3` (which sits under the tab's `h2`), keeping heading order unbroken for
 * screen readers and axe-core.
 */
function BlockView({
  block,
  context,
}: {
  readonly block: AnswerBlock;
  readonly context: SegmentContext;
}): JSX.Element {
  if (block.kind === 'heading') {
    return (
      <h4 className="mt-3 text-sm font-semibold">
        <Segments segments={block.segments} context={context} />
      </h4>
    );
  }
  if (block.kind === 'bullets') {
    return (
      <ul className="list-disc space-y-1 pl-5">
        <ListItems items={block.items} context={context} />
      </ul>
    );
  }
  if (block.kind === 'ordered') {
    return (
      <ol className="list-decimal space-y-1 pl-5">
        <ListItems items={block.items} context={context} />
      </ol>
    );
  }
  if (block.kind === 'codeBlock') {
    return (
      <pre className="overflow-x-auto rounded-md bg-slate-100 p-3 dark:bg-slate-800">
        <code className="font-mono text-xs">{block.text}</code>
      </pre>
    );
  }
  return (
    <p>
      <Segments segments={block.segments} context={context} />
    </p>
  );
}

/**
 * Renders one AI answer. No HTML from the model is ever interpreted: every
 * leaf below is a React text node, and the grammar is the small one defined
 * in `answer-tokens.ts` — there is no `dangerouslySetInnerHTML` anywhere on
 * this path.
 */
export function AnswerMarkdown({ markdown, citedPaths, onOpenFile }: AnswerMarkdownProps): JSX.Element {
  const blocks = useMemo(() => parseAnswerBlocks(markdown), [markdown]);
  const context = useMemo<SegmentContext>(
    () => ({ verifiedPaths: new Set(citedPaths), onOpenFile }),
    [citedPaths, onOpenFile],
  );

  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} context={context} />
      ))}
    </div>
  );
}
