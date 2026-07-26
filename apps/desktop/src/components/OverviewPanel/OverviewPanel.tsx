import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { LABELS } from '@/copy/messages';
import { StackCard } from './StackCard';
import { EntryPointList } from './EntryPointList';
import { TopFilesList } from './TopFilesList';

export interface OverviewPanelProps {
  readonly result: AnalysisResult;
  /** Optional until the file viewer lands (Phase 10) — defaults to a no-op. */
  readonly onOpenFile?: (path: string, line?: number) => void;
}

const NOOP_OPEN_FILE = (): void => undefined;

interface StatEntry {
  readonly label: string;
  readonly value: number;
}

function buildStatEntries(stats: AnalysisResult['stats']): readonly StatEntry[] {
  return [
    { label: 'Files scanned', value: stats.filesScanned },
    { label: 'Files parsed', value: stats.filesParsed },
    { label: 'Symbols', value: stats.symbolCount },
    { label: 'Import edges', value: stats.edgeCount },
    { label: 'Cycles', value: stats.cycleCount },
    { label: 'Orphan files', value: stats.orphanCount },
  ];
}

function StatsGrid({ stats }: { readonly stats: AnalysisResult['stats'] }): JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {buildStatEntries(stats).map((entry) => (
        <div key={entry.label} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <dt className="text-xs text-slate-500 dark:text-slate-500">{entry.label}</dt>
          <dd className="text-lg font-semibold">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SkippedFilesDisclosure({ files }: { readonly files: AnalysisResult['files'] }): JSX.Element | null {
  const skipped = files.filter((file) => !file.isParsed);
  if (skipped.length === 0) {
    return null;
  }
  return (
    <details className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800">
      <summary className="cursor-pointer font-semibold">{LABELS.skippedFiles}</summary>
      <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
        {skipped.map((file) => (
          <li key={file.path}>
            {file.path} — {file.skipReason}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The landing view after analysis completes (Section 9 Phase 7): repo
 * identity, at-a-glance stats, stack, entry points, and the most important
 * files. The graph, roadmap, module map, and search arrive in Phases 8-10.
 */
export function OverviewPanel({ result, onOpenFile = NOOP_OPEN_FILE }: OverviewPanelProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{result.repo.name}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{result.repo.detectedType}</p>
      </div>
      <StatsGrid stats={result.stats} />
      <div className="grid gap-4 lg:grid-cols-2">
        <StackCard stack={result.stack} />
        <EntryPointList entryPoints={result.entryPoints} onOpenFile={onOpenFile} />
      </div>
      <TopFilesList
        importantFilePaths={result.importantFilePaths}
        files={result.files}
        onOpenFile={onOpenFile}
      />
      <SkippedFilesDisclosure files={result.files} />
    </div>
  );
}
