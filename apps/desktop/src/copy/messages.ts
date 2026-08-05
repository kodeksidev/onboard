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

/**
 * Frozen verbatim. Do not reformat, retranslate, or re-punctuate.
 *
 * DEPARTS FROM A6, which froze these strings WITH a leading emoji (`🔒` and
 * `☁️`). Authorised-by: product owner (chat), 2026-07-31. An emoji in a
 * production UI reads as unfinished, and this build is about to be public.
 *
 * The signal is not dropped, it moves: `ModeIndicator` renders a lock or cloud
 * glyph as inline SVG beside the text. That is deliberately NOT part of these
 * strings — the accessible name of the indicator is the text alone, so the
 * byte-exact assertions behind criteria 13 and 14 keep testing one thing.
 *
 * BOTH strings changed together. One indicator with an emoji and one without
 * would be worse than either, so a future edit that restores the emoji to only
 * one of them is a regression even though each string is individually "fine".
 *
 * See the AMENDMENT in docs/DECISIONS.md for the full departure record.
 */
export const MODE_INDICATOR = {
  static: 'Static mode · no network · nothing leaves this machine',
  ai: (provider: string, model: string): string =>
    `AI mode · ${provider}/${model} · snippets sent to ${provider}`,
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
   * Amendment to Section 10: the table had no row for "the engine was never
   * started". A packaged Windows build reported E_ENGINE_CRASHED for a
   * sidecar it had never spawned, which is not a wording problem — it points
   * the reader at a crash log for a process that never existed. Retrying
   * cannot help either, so this copy deliberately offers no Retry framing;
   * the install is broken, not the run. See docs/DECISIONS.md.
   */
  /**
   * The engine RESPONDED with an error it could not classify. It is alive
   * and it did not exit, so `engineCrashed`'s copy is wrong here in every
   * particular: it says the engine "exited before finishing" (it did not),
   * that "retrying usually works" (a deterministic engine-side failure
   * fails identically every time), and that "the cache keeps completed
   * files" (the batch persist is transactional and rolls back to zero
   * rows). v0.1.0 shipped all three statements to a user hitting
   * `UNIQUE constraint failed: symbol.id`. This copy promises neither retry
   * nor retention. See docs/DECISIONS.md.
   */
  analysisFailed: (logPath: string): TitledCopy => ({
    title: 'Onboard could not finish analyzing this repository',
    description: `The engine reported an internal error, and it will report the same one if this repository is analyzed again. The log is at ${logPath}. Reporting this with the log is the fastest way to get it fixed.`,
  }),
  engineNotStarted: (logPath: string): TitledCopy => ({
    title: 'Onboard could not start its analysis engine',
    description: `The analysis engine is missing from this installation, so nothing was analyzed. Reinstalling Onboard should restore it. The log is at ${logPath}.`,
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
   * Gap: Section 10's "AI toggle on, no key stored" row specifies the
   * behavior (every `ai_*` returns E_AI_DISABLED) but no literal copy.
   * Filled with the most conventional phrasing consistent with the other
   * AppError strings; see docs/DECISIONS.md.
   */
  aiDisabled: (): TitledCopy => ({
    title: 'AI is off',
    description:
      'Onboard did not send anything. Turn on AI in Settings and store a key for your provider to use this.',
  }),
  /**
   * Gap: Section 7.4 lists E_AI_NETWORK among `test_ai_key`'s error codes but
   * Section 10 gives no literal copy. See docs/DECISIONS.md.
   */
  aiNetwork: (provider: string): TitledCopy => ({
    title: `Onboard couldn't reach ${provider}`,
    description: `The request never completed, so nothing was answered. Check your connection and try again. Static mode is unaffected — everything else still works.`,
  }),
  /**
   * Gap: Section 7.4 lists E_AI_MODEL_NOT_FOUND but Section 10 gives no
   * literal copy. See docs/DECISIONS.md.
   */
  aiModelNotFound: (model: string): TitledCopy => ({
    title: `That model isn't available`,
    description: `The provider does not recognise ${model}. Check the model name in Settings, then test again.`,
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
 * Section 9 Phase 12 step 6: the three optional AI surfaces (`ai_project_summary`,
 * `ai_explain_module`, `ai_ask` — Section 7.4). A5/A20: none of this is
 * reachable until the user turns AI on, and the "unavailable" copy below says
 * WHICH of the two reasons applies rather than showing one dead panel for
 * both.
 */
export const AI_PANEL_COPY = {
  title: 'Ask AI',
  description:
    'Optional. Onboard sends a redacted, capped set of snippets and shows exactly how much left this machine. Every path an answer cites is verified against the index first.',
  loadingLabel: 'Asking the model…',
  /**
   * Criterion 17: the ACTUAL `sentFileCount` / `sentByteCount` from the
   * response, shown for every AI action, in plain sight — never rounded,
   * never hidden behind a disclosure widget.
   */
  sentPayload: (provider: string, fileCount: number, byteCount: number): string =>
    `Sent ${fileCount} file${fileCount === 1 ? '' : 's'} (${byteCount} bytes) to ${provider}.`,
  /** "Succeeded but empty" — never the same blank panel as "nothing yet" or "failed". */
  emptyAnswer: {
    title: 'The model returned an empty answer',
    description:
      'Nothing was withheld — the response itself had no text. Ask again, or ask something narrower.',
  },
  summaryTitle: 'Project summary',
  summaryAction: 'Summarise this project',
  summaryIdle:
    'Nothing requested yet. Onboard will send snippets from the highest-ranked files in this repo.',
  moduleTitle: 'Explain a module',
  moduleAction: 'Explain this module',
  moduleSelectLabel: 'Module',
  moduleIdle: 'Nothing requested yet. Pick a module, then ask for an explanation.',
  moduleNone:
    'There are no modules to explain — the module map found no directory with enough analysed files.',
  askTitle: 'Ask a question',
  askAction: 'Ask',
  askInputLabel: 'Question',
  askPlaceholder: 'e.g. Where does a request get authenticated?',
  askIdle:
    'Nothing asked yet. Answers cite files from this repo, and each citation is checked against the index before it is shown.',
  /**
   * Gap: Section 10 specifies the behavior for both unusable states (toggle
   * off; toggle on with no key) but no literal UI copy for the panel itself.
   * See docs/DECISIONS.md.
   */
  unavailableDisabled: (): TitledCopy => ({
    title: 'AI is off',
    description:
      'Onboard runs static by default — nothing leaves this machine. Turn on "Enable AI features" in Settings to ask for summaries, module explanations, and answers.',
  }),
  unavailableMissingKey: (provider: string): TitledCopy => ({
    title: `No key stored for ${provider}`,
    description: `AI is on, but ${provider} needs a key before Onboard can send anything. Paste one in Settings and press "Test key" — nothing is sent until a key passes.`,
  }),
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
  E_ENGINE_NOT_STARTED: ERRORS.engineNotStarted('').title,
  E_ANALYSIS_FAILED: ERRORS.analysisFailed('').title,
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
  // Phase 12 step 6's codes. E_AI_CITATION_REJECTED and E_AI_PAYLOAD_UNSAFE
  // have static titles too, so they resolve through the same lookup. The two
  // codes whose TITLE interpolates a value — E_AI_RATE_LIMITED (provider) and
  // E_AI_NETWORK (provider) — cannot, and are handled by
  // `resolveAiErrorCopy` below, which knows the configured provider.
  E_AI_DISABLED: ERRORS.aiDisabled().title,
  E_AI_CITATION_REJECTED: ERRORS.aiCitationRejected('').title,
  E_AI_PAYLOAD_UNSAFE: ERRORS.aiPayloadUnsafe().title,
  E_AI_MODEL_NOT_FOUND: ERRORS.aiModelNotFound('').title,
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

export interface AiErrorLike {
  readonly code: string;
  readonly message: string;
  readonly path?: string | null;
}

/**
 * `resolveErrorCopy` for the AI surfaces, which have two rows Section 10's
 * plain code→title lookup cannot serve on its own:
 *
 * - `E_AI_RATE_LIMITED` / `E_AI_NETWORK`: the TITLE interpolates the provider
 *   name, so it cannot live in the static `ERROR_TITLES` map. The configured
 *   provider is passed in. (The `0` below is a placeholder for a parameter
 *   that appears only in the description, which comes from `error.message` —
 *   the same idiom `ERROR_TITLES` already uses with `ERRORS.pathNotFound('')`.)
 * - `E_AI_CITATION_REJECTED`: Section 8.10 step 3 returns the offending path
 *   in `AppError.path`, and Section 10 requires it interpolated into the
 *   description. The description is rebuilt here from that field so the real
 *   path is shown even if a producer sent a message without it; `error.message`
 *   remains the fallback.
 */
export function resolveAiErrorCopy(error: AiErrorLike, provider: string): ResolvedErrorCopy {
  if (error.code === 'E_AI_RATE_LIMITED') {
    return { title: ERRORS.aiRateLimited(provider, 0).title, description: error.message, actionLabel: null };
  }
  if (error.code === 'E_AI_NETWORK') {
    return { title: ERRORS.aiNetwork(provider).title, description: error.message, actionLabel: null };
  }
  if (error.code === 'E_AI_CITATION_REJECTED') {
    const offendingPath = error.path ?? '';
    const copy = ERRORS.aiCitationRejected(offendingPath);
    return {
      title: copy.title,
      description: offendingPath === '' ? error.message : copy.description,
      actionLabel: null,
    };
  }
  return resolveErrorCopy(error);
}
