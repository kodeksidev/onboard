/**
 * Every user-facing string in Onboard's UI lives here, and only here
 * (Section 9 Phase 7). Components import from this module and never inline a
 * literal string a user can see — that is what lets a single test file
 * assert every empty/error state's copy against one source of truth
 * (Section 13 criterion 19).
 *
 * Strings quoted in Section 10 of the build spec are transcribed
 * character-for-character, including em dashes (—, U+2014) and curly
 * apostrophes where the spec uses them. `ModeIndicator`'s two strings (A6)
 * are byte-exact and use the middle dot U+00B7 (`·`), never a hyphen or a
 * bullet (•) — a test asserts this literally.
 */

export interface TitledCopy {
  readonly title: string;
  readonly description: string;
}

export interface ActionableCopy extends TitledCopy {
  readonly actionLabel: string;
}

/** A6 — frozen verbatim. Do not reformat, retranslate, or re-punctuate. */
export const MODE_INDICATOR = {
  static: '🔒 Static mode · no network · nothing leaves this machine',
  ai: (provider: string, model: string): string =>
    `☁️ AI mode · ${provider}/${model} · snippets sent to ${provider}`,
} as const;

export const EMPTY_STATE_NO_REPO: ActionableCopy = {
  title: 'No repository open',
  description:
    'Choose a folder to map. Nothing is uploaded — analysis runs entirely on this machine.',
  actionLabel: 'Choose folder',
};

export const LABELS = {
  skippedFiles: 'Skipped files',
  diagnostics: 'Diagnostics',
  retry: 'Retry',
  openLog: 'Open log',
  useSessionOnlyKey: 'Use session-only key',
  chooseAnotherFolder: 'Choose another folder',
  chooseASubfolder: 'Choose a subfolder',
  details: 'Details',
} as const;

export const ERRORS = {
  pathNotFound: (name: string): ActionableCopy => ({
    title: 'That folder no longer exists',
    description: `Onboard could not find ${name}. It may have been moved, renamed, or deleted.`,
    actionLabel: LABELS.chooseAnotherFolder,
  }),
  permissionDenied: (name: string): TitledCopy => ({
    title: "Onboard can't read this folder",
    description: `The operating system denied read access to ${name}. Grant read permission, or pick a folder you own.`,
  }),
  noSupportedFiles: (): TitledCopy => ({
    title: 'No supported source files found',
    description:
      'Onboard v1 reads JavaScript, TypeScript, and Python. This folder has none outside ignored paths. Go and Rust support is planned.',
  }),
  repoTooLarge: (fileCount: number): ActionableCopy => ({
    title: 'This repository is too large to map in one pass',
    description: `${fileCount} source files exceed the 25,000-file limit. Pick a subdirectory such as src/ to map a slice of it.`,
    actionLabel: LABELS.chooseASubfolder,
  }),
  engineCrashed: (logPath: string): TitledCopy => ({
    title: 'Analysis stopped unexpectedly',
    description: `The analysis engine exited before finishing. The log is at ${logPath}. Retrying usually works — the cache keeps completed files.`,
  }),
  /**
   * Gap: Section 10's "Sidecar hangs" row names E_ENGINE_TIMEOUT and the
   * 600s/30s budgets but gives no literal copy. Filled with the most
   * conventional phrasing consistent with the other AppError strings; see
   * docs/DECISIONS.md.
   */
  engineTimeout: (): TitledCopy => ({
    title: 'Analysis is taking too long',
    description:
      'Onboard stopped the analysis engine because it stopped responding. Retry, or pick a smaller folder.',
  }),
  /**
   * Gap: Section 10's "Second analysis started while one runs" row specifies
   * behavior (disable the picker) but no literal copy. See docs/DECISIONS.md.
   */
  analysisInProgress: (): TitledCopy => ({
    title: 'Analysis already running',
    description:
      'Onboard is still mapping this repository. Wait for it to finish before starting another.',
  }),
  fileTooLarge: (name: string, size: string): TitledCopy => ({
    title: 'File too large to display',
    description: `${name} is ${size}. Onboard displays files up to 2 MB. Open it in your editor instead.`,
  }),
  /**
   * Gap: Section 10 doesn't give literal copy for E_PATH_ESCAPES_REPO (the
   * `read_repo_file` guard against '..' and escaping symlinks). Filled with
   * the most conventional phrasing consistent with the other AppError
   * strings; see docs/DECISIONS.md.
   */
  pathEscapesRepo: (): TitledCopy => ({
    title: "That path isn't part of this repository",
    description:
      'Onboard only opens files inside the folder it analyzed. Re-run analysis if this looks wrong.',
  }),
  /**
   * Gap: Section 10 doesn't give literal copy for E_NO_ANALYSIS
   * (`search_repo` called with no completed analysis for the repo).
   * Filled with the most conventional phrasing consistent with the other
   * AppError strings; see docs/DECISIONS.md.
   */
  noAnalysisForSearch: (): TitledCopy => ({
    title: 'Search is not ready yet',
    description: 'This repository has not finished analysing, so there is nothing to search yet.',
  }),
  aiKeyInvalid: (provider: string): TitledCopy => ({
    title: 'That key was rejected',
    description: `${provider} returned 401. Check the key, then test again. AI stays off until a key passes.`,
  }),
  aiOllamaUnreachable: (model: string): TitledCopy => ({
    title: "Ollama isn't answering on 127.0.0.1:11434",
    description: `Start Ollama and pull ${model}, then test again. Static mode is unaffected — everything below still works.`,
  }),
  aiRateLimited: (provider: string, seconds: number): TitledCopy => ({
    title: `${provider} is rate-limiting Onboard`,
    description: `Wait ${seconds}s and try again. Nothing was sent twice.`,
  }),
  aiCitationRejected: (path: string): TitledCopy => ({
    title: "Answer withheld — it cited files that aren't in this repo",
    description: `The model referenced ${path}, which is not in the index. Onboard never shows paths it can't verify. Try a narrower question.`,
  }),
  /**
   * Gap: Section 10's "A secret survives redaction" row states the effect
   * (E_AI_PAYLOAD_UNSAFE, nothing sent) but gives no literal copy. See
   * docs/DECISIONS.md.
   */
  aiPayloadUnsafe: (): TitledCopy => ({
    title: 'Nothing was sent',
    description:
      'A secret-like value survived redaction, so Onboard aborted the request before anything left this machine.',
  }),
  keychainUnavailable: (): ActionableCopy => ({
    title: 'No system keyring available',
    description:
      "Onboard won't write API keys to disk. Install gnome-keyring or KWallet, or use a session-only key that is forgotten when you quit.",
    actionLabel: LABELS.useSessionOnlyKey,
  }),
} as const;

export const INFO = {
  cacheRebuilding: (repoName: string): TitledCopy => ({
    title: 'Rebuilding the local cache',
    description: `The cache for ${repoName} was unreadable and has been reset. Re-analysing from scratch.`,
  }),
} as const;

export const SEARCH_COPY = {
  droppedTerm: (term: string): string => `Ignored: '${term}' (min 3 characters)`,
  noResults: (query: string): TitledCopy => ({
    title: `Nothing matched '${query}'`,
    description:
      'Try a concept like auth, payment, or routing — Onboard expands those into related terms.',
  }),
} as const;

/**
 * Empty states for the Overview tab's four sub-lists (Section 9's "analysed
 * fine, nothing qualified" bucket — `OverviewPanel` only ever mounts once a
 * real `AnalysisResult` exists, so "no analysis"/"analysis failed" cannot
 * reach these). Each names the actual rule that produced zero results
 * rather than showing a blank heading.
 */
export const OVERVIEW_COPY = {
  noEntryPoints: {
    title: 'No entry points detected',
    description:
      "Onboard looks for package.json's main, bin, or scripts.start; a conventional index file; or Python's __main__.py file or module guard. None of those were found in this repo.",
  },
  noImportantFiles: {
    title: 'No files to rank',
    description:
      'Onboard ranks files by importance once they are parsed. No files in this repo were parsed successfully.',
  },
  noLanguages: {
    title: 'No languages detected',
    description:
      'Onboard detects languages from parsed files. No files in this repo were parsed successfully.',
  },
  noManifests: {
    title: 'No package manifest found',
    description:
      'Onboard looks for files such as package.json, pyproject.toml, or requirements.txt. None were found in this repo.',
  },
  noRuntimeDependencies: {
    title: 'No runtime dependencies declared',
    description: 'The manifest(s) Onboard found in this repo declare no runtime dependencies.',
  },
} as const;

export const ANALYSIS_PROGRESS_COPY = {
  title: 'Mapping the repository',
  phaseLabels: {
    walk: 'Scanning files',
    parse: 'Parsing symbols',
    resolve: 'Resolving imports',
    graph: 'Building the dependency graph',
    rank: 'Ranking importance',
    persist: 'Saving results',
  },
} as const;

/** Section 9 Phase 9: the roadmap's five `RoadmapStep.section` values must render distinguishably. */
export const ROADMAP_COPY = {
  title: 'Start here',
  sectionLabels: {
    entry: 'Entry point',
    core: 'Core',
    supporting: 'Supporting',
    'leaf-utility': 'Leaf utility',
    unreached: 'Unreached',
  },
  companionsLabel: 'Part of this step:',
  dependsOnLabel: 'Depends on:',
  dependedOnByLabel: (count: number): string =>
    `Imported by ${count} file${count === 1 ? '' : 's'}`,
  focusInGraphLabel: 'Focus in graph',
  openFileLabel: 'Open file',
  /**
   * "Analysed fine, nothing qualified": every parsed file becomes at least
   * one roadmap step (Section 8.5), so zero steps only happens when nothing
   * was parsed at all (`RoadmapPanel` only ever mounts once a real
   * `AnalysisResult` exists, so "no analysis"/"analysis failed" cannot
   * reach it either).
   */
  empty: {
    title: 'No roadmap yet',
    description:
      'Onboard builds a reading order from parsed files. No files in this repo were parsed successfully.',
  },
} as const;

export const MODULE_MAP_COPY = {
  title: 'Module map',
  keyFilesLabel: 'Key files',
  dependsOnModulesLabel: 'Depends on',
  dependedOnByModulesLabel: 'Used by',
  fileCountLabel: (count: number): string => `${count} file${count === 1 ? '' : 's'}`,
  /**
   * "Analysed fine, nothing qualified" (never "no analysis"/"analysis
   * failed" — `ModuleMap` only ever mounts once a real `AnalysisResult`
   * exists). Names the actual rule (Section 8.6's `MODULE_MIN_FILES`) and
   * the actual largest candidate directory, derived from real file data by
   * `findLargestCandidateDirectory` — never a hardcoded "3" or a generic
   * "nothing here".
   */
  emptyWithCandidate: (minFiles: number, dirPath: string, fileCount: number): TitledCopy => ({
    title: 'No modules found',
    description: `Modules are directories with at least ${minFiles} analysed files. This repo's largest is ${dirPath} with ${fileCount}.`,
  }),
  /** No directory below any source root has even one analysed file to count. */
  emptyNoCandidate: (minFiles: number): TitledCopy => ({
    title: 'No modules found',
    description: `Modules are directories with at least ${minFiles} analysed files. No directory in this repo has any analysed files yet.`,
  }),
} as const;

/**
 * "Analysed fine, nothing qualified": `DependencyGraph` only ever mounts
 * once a real `AnalysisResult` exists with at least one parsed file in
 * practice (Section 10's `E_NO_SUPPORTED_FILES` gates that above it), but
 * the component itself does not assume that invariant — an empty `files`
 * array gets a real explanation instead of an empty toolbar and canvas.
 */
export const GRAPH_COPY = {
  empty: {
    title: 'Nothing to graph',
    description: 'This repo has no parsed files to show a dependency graph for.',
  },
} as const;

/** Section 9 Phase 10: "the everyday feature" — make it fast and keyboard-first. */
export const WHERE_IS_SEARCH_COPY = {
  label: 'Where is X?',
  placeholder: 'Where is X handled? Try auth, payment, routing…',
  expandedTermsLabel: 'Also matching:',
  loadingLabel: 'Searching…',
} as const;

export const FILE_VIEWER_COPY = {
  noFileOpen: {
    title: 'No file open',
    description: 'Choose a search result, or click a path anywhere in Onboard, to view it here.',
  },
  loadingLabel: 'Loading file…',
  symbolsLabel: 'Symbols',
  noSymbols: 'No symbols found in this file.',
  importsLabel: 'Imports',
  importedByLabel: 'Imported by',
  noneLabel: 'None',
} as const;

/**
 * Section 9 Phase 12 step 5: the Settings dialog's "AI (optional)" section
 * (Section 6.2). A20/A5: AI stays off by default; nothing here changes
 * that — the master toggle still defaults to `false` (`DEFAULT_SETTINGS`
 * in `ipc/settings-schema.ts`).
 */
export const SETTINGS_COPY = {
  dialogTitle: 'Settings',
  closeLabel: 'Close',
  aiSectionTitle: 'AI (optional)',
  aiSectionDescription:
    'Off by default. Nothing leaves this machine unless you turn this on and a working provider is configured.',
  enableToggleLabel: 'Enable AI features',
  providerLabel: 'Provider',
  providerOptionLabels: {
    anthropic: 'Anthropic',
    ollama: 'Ollama (local)',
    'openai-compatible': 'OpenAI-compatible',
  },
  modelLabel: 'Model',
  modelPlaceholder: 'e.g. claude-sonnet-4-5',
  apiKeyLabel: 'API key',
  apiKeyPlaceholder: 'Paste your API key',
  /** Shown instead of a blank field when a key is already stored — the key
   * itself is NEVER sent back to the webview (Section 12), only this
   * boolean-derived hint. */
  apiKeyAlreadyStoredHint: 'A key is already stored for this provider.',
  ollamaBaseUrlLabel: 'Ollama address',
  openaiCompatibleBaseUrlLabel: 'Base URL',
  openaiCompatibleBaseUrlPlaceholder: 'e.g. https://api.deepseek.com',
  saveKeyLabel: 'Save key',
  clearKeyLabel: 'Clear key',
  /**
   * For Ollama specifically "Test key" is a reachability test, not a
   * credential test (Ollama needs no key) — a distinct label rather than
   * silently reusing "Test key" for a provider that has none.
   */
  testKeyButtonLabel: 'Test key',
  testConnectionButtonLabel: 'Test connection',
  testingLabel: 'Testing…',
  testSucceeded: (latencyMs: number): string => `Connected — responded in ${latencyMs}ms.`,
} as const;

/**
 * Every literal title in Section 10 is static — none of them interpolate a
 * value, only the descriptions do. `AppError.message` (Section 7's error
 * envelope) is itself the fully-interpolated description string the
 * producer (Rust in production, the mock/store in development) already
 * built from this same table, so the UI only needs to look up the matching
 * static title by `code` and render `error.message` underneath it.
 */
export const ERROR_TITLES: Readonly<Record<string, string>> = {
  E_PATH_NOT_FOUND: ERRORS.pathNotFound('').title,
  E_PERMISSION_DENIED: ERRORS.permissionDenied('').title,
  E_NO_SUPPORTED_FILES: ERRORS.noSupportedFiles().title,
  E_REPO_TOO_LARGE: ERRORS.repoTooLarge(0).title,
  E_ENGINE_CRASHED: ERRORS.engineCrashed('').title,
  E_ENGINE_TIMEOUT: ERRORS.engineTimeout().title,
  E_ANALYSIS_IN_PROGRESS: ERRORS.analysisInProgress().title,
  E_FILE_TOO_LARGE: ERRORS.fileTooLarge('', '').title,
  E_PATH_ESCAPES_REPO: ERRORS.pathEscapesRepo().title,
  E_NO_ANALYSIS: ERRORS.noAnalysisForSearch().title,
  // Both static (no interpolation in the title itself — only the
  // description takes parameters), so — unlike E_AI_RATE_LIMITED, whose
  // title needs the provider name and therefore has no entry here — these
  // two resolve correctly through the same code-keyed lookup every other
  // row uses. Phase 12 step 5 is the first consumer of these two codes'
  // copy (Settings' Test key button).
  E_AI_KEY_INVALID: ERRORS.aiKeyInvalid('').title,
  E_AI_OLLAMA_UNREACHABLE: ERRORS.aiOllamaUnreachable('').title,
};

const DEFAULT_ERROR_TITLE = 'Something went wrong';

export interface ResolvedErrorCopy extends TitledCopy {
  readonly actionLabel: string | null;
}

/** Section 10's per-row action label, where a row specifies one. */
export const ERROR_ACTION_LABELS: Readonly<Record<string, string>> = {
  E_PATH_NOT_FOUND: LABELS.chooseAnotherFolder,
  E_REPO_TOO_LARGE: LABELS.chooseASubfolder,
};

/**
 * Resolves an `AppError` to display copy. `error.message` IS the
 * description (Section 12: "AppError.message is always drawn from
 * src/copy/messages.ts"); only the static title needs a code lookup.
 */
export function resolveErrorCopy(error: {
  readonly code: string;
  readonly message: string;
}): ResolvedErrorCopy {
  return {
    title: ERROR_TITLES[error.code] ?? DEFAULT_ERROR_TITLE,
    description: error.message,
    actionLabel: ERROR_ACTION_LABELS[error.code] ?? null,
  };
}
