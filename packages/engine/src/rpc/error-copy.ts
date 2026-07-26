/**
 * @onboard/engine — Section 10 copy table, transcribed verbatim for every
 * `AppErrorCode` the engine itself can detect and construct.
 *
 * `AppError.message` is "user-facing... never raw" (Section 7's frozen
 * schema), so every literal string below is copied byte-for-byte from
 * Section 10's table, with `{name}`/`{n}`/`{size}` interpolated. Three codes
 * this module also builds copy for — `E_NOT_A_DIRECTORY`, `E_PATH_ESCAPES_REPO`,
 * `E_NO_ANALYSIS` — do NOT have a literal Section 10 entry (Section 10 only
 * documents the deleted-folder, permission, and repo-too-large cases for
 * `analyze_repo`, and the symlink-escape behavior for `read_repo_file`
 * without giving its copy string). Those three messages are this engine's
 * own reasonable placeholder text, flagged here and in `docs/DECISIONS.md`
 * for the UI copy owner (`src/copy/messages.ts`) to confirm or override —
 * they are not invented replacements for an existing frozen string.
 */

/** `{size}` interpolation for `fileTooLargeMessage`, e.g. `2.3 MB`. */
export function formatByteSizeLabel(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function pathNotFoundMessage(name: string): { message: string; detail: string } {
  return {
    message: 'That folder no longer exists',
    detail: `Onboard could not find ${name}. It may have been moved, renamed, or deleted.`,
  };
}

export function permissionDeniedMessage(name: string): { message: string; detail: string } {
  return {
    message: "Onboard can't read this folder",
    detail: `The operating system denied read access to ${name}. Grant read permission, or pick a folder you own.`,
  };
}

export function noSupportedFilesMessage(): { message: string; detail: string } {
  return {
    message: 'No supported source files found',
    detail:
      'Onboard v1 reads JavaScript, TypeScript, and Python. This folder has none outside ignored paths. Go and Rust support is planned.',
  };
}

export function repoTooLargeMessage(fileCount: number, limit: number): { message: string; detail: string } {
  return {
    message: 'This repository is too large to map in one pass',
    detail: `${String(fileCount)} source files exceed the ${String(limit)}-file limit. Pick a subdirectory such as src/ to map a slice of it.`,
  };
}

export function fileTooLargeMessage(name: string, sizeLabel: string): { message: string; detail: string } {
  return {
    message: 'File too large to display',
    detail: `${name} is ${sizeLabel}. Onboard displays files up to 2 MB. Open it in your editor instead.`,
  };
}

/** No literal Section 10 copy exists for this case — see this file's header comment. */
export function notADirectoryMessage(name: string): { message: string; detail: string } {
  return {
    message: 'That path is not a folder',
    detail: `${name} is a file, not a folder. Choose the folder that contains it instead.`,
  };
}

/** No literal Section 10 copy exists for this case — see this file's header comment. */
export function pathEscapesRepoMessage(): { message: string; detail: string } {
  return {
    message: "That path is outside the repository",
    detail: 'The requested file resolves to a location outside the analyzed folder and was not opened.',
  };
}

/** No literal Section 10 copy exists for this case — see this file's header comment. */
export function noAnalysisMessage(): { message: string; detail: string } {
  return {
    message: 'This repository has not been analyzed yet',
    detail: 'Run an analysis before searching or opening files.',
  };
}
