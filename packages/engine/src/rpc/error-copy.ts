/**
 * @onboard/engine — Section 10 copy table, transcribed for every
 * `AppErrorCode` the engine itself can detect and construct.
 *
 * `AppError.message` is the user-facing **description** — Section 7: "user-
 * facing, from the copy table in Section 10." Section 10's rows are
 * formatted **"Title"** / description; the UI derives the *title* from
 * `code` alone (`apps/desktop/src/copy/messages.ts`'s `ERROR_TITLES`) and
 * renders `AppError.message` as the description shown under it. `detail` is
 * the OPPOSITE of user-facing copy — Section 7: "developer detail; logged
 * locally, shown behind a 'Details' disclosure"; Section 12: "provider
 * response bodies, stack traces, and OS error strings go to `detail`." None
 * of the helpers below have genuine developer detail to add beyond what
 * `message` already says, so `detail` is `null` throughout; a caller with a
 * real OS error object should pass its own string in separately rather than
 * have this module manufacture one.
 *
 * (Corrected from an earlier version of this file that had `message` and
 * `detail` backwards — putting the actionable description behind the
 * "Details" disclosure and leaving only the short title in the user-facing
 * field. Caught by rust-tauri during Phase 11 integration; see
 * `docs/DECISIONS.md`.)
 *
 * Three codes below have no literal Section 10 entry: `E_NOT_A_DIRECTORY`,
 * `E_PATH_ESCAPES_REPO`, `E_NO_ANALYSIS`. `E_PATH_ESCAPES_REPO`'s text below
 * is copied verbatim from `apps/desktop/src/copy/messages.ts`'s
 * `ERRORS.pathEscapesRepo()` (the UI's own gap-filled copy, so the two
 * sides show identical text instead of diverging). `E_NOT_A_DIRECTORY` and
 * `E_NO_ANALYSIS` have no UI-side entry either, so these remain this
 * engine's own reasonable placeholder text, flagged here and in
 * `docs/DECISIONS.md`.
 */

export interface ErrorCopy {
  readonly message: string;
  readonly detail: string | null;
}

/** `{size}` interpolation for `fileTooLargeMessage`, e.g. `2.3 MB`. */
export function formatByteSizeLabel(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function pathNotFoundMessage(name: string): ErrorCopy {
  return {
    message: `Onboard could not find ${name}. It may have been moved, renamed, or deleted.`,
    detail: null,
  };
}

export function permissionDeniedMessage(name: string): ErrorCopy {
  return {
    message: `The operating system denied read access to ${name}. Grant read permission, or pick a folder you own.`,
    detail: null,
  };
}

export function noSupportedFilesMessage(): ErrorCopy {
  return {
    message:
      'Onboard v1 reads JavaScript, TypeScript, and Python. This folder has none outside ignored paths. Go and Rust support is planned.',
    detail: null,
  };
}

export function repoTooLargeMessage(fileCount: number, limit: number): ErrorCopy {
  return {
    message: `${String(fileCount)} source files exceed the ${String(limit)}-file limit. Pick a subdirectory such as src/ to map a slice of it.`,
    detail: null,
  };
}

export function fileTooLargeMessage(name: string, sizeLabel: string): ErrorCopy {
  return {
    message: `${name} is ${sizeLabel}. Onboard displays files up to 2 MB. Open it in your editor instead.`,
    detail: null,
  };
}

/** No literal Section 10 copy exists for this case — see this file's header comment. */
export function notADirectoryMessage(name: string): ErrorCopy {
  return {
    message: `${name} is a file, not a folder. Choose the folder that contains it instead.`,
    detail: null,
  };
}

/**
 * No literal Section 10 copy exists for this case. Text matches
 * `apps/desktop/src/copy/messages.ts`'s `ERRORS.pathEscapesRepo().description`
 * exactly — see this file's header comment.
 */
export function pathEscapesRepoMessage(): ErrorCopy {
  return {
    message: 'Onboard only opens files inside the folder it analyzed. Re-run analysis if this looks wrong.',
    detail: null,
  };
}

/** No literal Section 10 copy exists for this case — see this file's header comment. */
export function noAnalysisMessage(): ErrorCopy {
  return {
    message: 'Run an analysis before searching or opening files.',
    detail: null,
  };
}
