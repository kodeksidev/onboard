import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { ROADMAP_COPY } from '@/copy/messages';
import { cn } from '@/lib/cn';

export type RoadmapStep = AnalysisResult['roadmap']['steps'][number];
type RoadmapSection = RoadmapStep['section'];

export interface RoadmapStepCardProps {
  readonly step: RoadmapStep;
  readonly isFocused: boolean;
  readonly onFocus: () => void;
  readonly onOpenFile?: (path: string) => void;
}

const NOOP_OPEN_FILE = (): void => undefined;

/** Every section renders with a distinct color AND a distinct text label — never color alone (Section 9 Phase 9). */
const SECTION_BADGE_CLASSES: Readonly<Record<RoadmapSection, string>> = {
  entry: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  core: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  supporting: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  'leaf-utility': 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
  unreached: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

function SectionBadge({ section }: { readonly section: RoadmapSection }): JSX.Element {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', SECTION_BADGE_CLASSES[section])}>
      {ROADMAP_COPY.sectionLabels[section]}
    </span>
  );
}

function PathPill({ path }: { readonly path: string }): JSX.Element {
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-800">{path}</span>;
}

function CompanionsSection({ paths }: { readonly paths: readonly string[] }): JSX.Element | null {
  if (paths.length === 0) {
    return null;
  }
  return (
    <div role="region" aria-label={ROADMAP_COPY.companionsLabel} className="text-xs">
      <span className="font-medium">{ROADMAP_COPY.companionsLabel}</span>{' '}
      <span className="inline-flex flex-wrap gap-1">
        {paths.map((path) => (
          <PathPill key={path} path={path} />
        ))}
      </span>
    </div>
  );
}

function DependsOnSection({ paths }: { readonly paths: readonly string[] }): JSX.Element | null {
  if (paths.length === 0) {
    return null;
  }
  return (
    <div className="text-xs">
      <span className="font-medium">{ROADMAP_COPY.dependsOnLabel}</span>{' '}
      <span className="inline-flex flex-wrap gap-1">
        {paths.map((path) => (
          <PathPill key={path} path={path} />
        ))}
      </span>
    </div>
  );
}

/**
 * One roadmap step: order, distinguishable section badge, the file it
 * points at (clicking it focuses + centers that node in the graph via
 * `RoadmapPanel`'s `onFocus` -> `graphStore.focusPath`), the engine's own
 * `why` explanation, its cycle companions (if any — the fixture's step 6
 * has 2), what it depends on, and how many files depend on it.
 */
export function RoadmapStepCard({
  step,
  isFocused,
  onFocus,
  onOpenFile = NOOP_OPEN_FILE,
}: RoadmapStepCardProps): JSX.Element {
  return (
    <li
      aria-current={isFocused ? 'step' : undefined}
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        isFocused ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-800',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
          {step.order}
        </span>
        <SectionBadge section={step.section} />
        <button
          type="button"
          onClick={onFocus}
          aria-label={`Focus ${step.path} in the dependency graph, step ${step.order}`}
          className="truncate text-left font-mono text-sm underline-offset-2 hover:underline"
        >
          {step.path}
        </button>
        <button
          type="button"
          onClick={() => onOpenFile(step.path)}
          aria-label={`Open file: ${step.path}`}
          className="ml-auto shrink-0 text-xs text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
        >
          {ROADMAP_COPY.openFileLabel}
        </button>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{step.why}</p>
      <CompanionsSection paths={step.companionPaths} />
      <DependsOnSection paths={step.dependsOnPaths} />
      <p className="text-xs text-slate-500 dark:text-slate-500">
        {ROADMAP_COPY.dependedOnByLabel(step.dependedOnByCount)}
      </p>
    </li>
  );
}
