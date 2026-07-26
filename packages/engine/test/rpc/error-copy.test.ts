import { describe, expect, test } from 'bun:test';
import {
  fileTooLargeMessage,
  formatByteSizeLabel,
  noAnalysisMessage,
  noSupportedFilesMessage,
  notADirectoryMessage,
  pathEscapesRepoMessage,
  pathNotFoundMessage,
  permissionDeniedMessage,
  repoTooLargeMessage,
} from '../../src/rpc/error-copy';

/**
 * Locks in the Section 7/12 convention this file's helpers must follow:
 * `message` carries the user-facing description (never behind a
 * disclosure); `detail` is reserved for genuine developer detail (a stack
 * trace or an OS error string) and is `null` when there is none. An earlier
 * version of `error-copy.ts` had these backwards — see docs/DECISIONS.md.
 */
describe('error-copy — message/detail convention (Section 7, Section 12)', () => {
  test('pathNotFoundMessage puts the actionable description in message, and detail is null', () => {
    const copy = pathNotFoundMessage('my-repo');
    expect(copy.message).toBe('Onboard could not find my-repo. It may have been moved, renamed, or deleted.');
    expect(copy.detail).toBeNull();
  });

  test('permissionDeniedMessage puts the actionable description in message, and detail is null', () => {
    const copy = permissionDeniedMessage('my-repo');
    expect(copy.message).toBe('The operating system denied read access to my-repo. Grant read permission, or pick a folder you own.');
    expect(copy.detail).toBeNull();
  });

  test('noSupportedFilesMessage puts the actionable description in message, and detail is null', () => {
    const copy = noSupportedFilesMessage();
    expect(copy.message).toBe(
      'Onboard v1 reads JavaScript, TypeScript, and Python. This folder has none outside ignored paths. Go and Rust support is planned.',
    );
    expect(copy.detail).toBeNull();
  });

  test('repoTooLargeMessage interpolates fileCount/limit into message, and detail is null', () => {
    const copy = repoTooLargeMessage(30000, 25000);
    expect(copy.message).toBe('30000 source files exceed the 25000-file limit. Pick a subdirectory such as src/ to map a slice of it.');
    expect(copy.detail).toBeNull();
  });

  test('fileTooLargeMessage interpolates name/size into message, and detail is null', () => {
    const copy = fileTooLargeMessage('big.ts', '2.3 MB');
    expect(copy.message).toBe('big.ts is 2.3 MB. Onboard displays files up to 2 MB. Open it in your editor instead.');
    expect(copy.detail).toBeNull();
  });

  test('notADirectoryMessage puts the actionable description in message, and detail is null', () => {
    const copy = notADirectoryMessage('some-file.txt');
    expect(copy.message).toBe('some-file.txt is a file, not a folder. Choose the folder that contains it instead.');
    expect(copy.detail).toBeNull();
  });

  test('pathEscapesRepoMessage matches apps/desktop/src/copy/messages.ts ERRORS.pathEscapesRepo().description exactly', () => {
    const copy = pathEscapesRepoMessage();
    expect(copy.message).toBe('Onboard only opens files inside the folder it analyzed. Re-run analysis if this looks wrong.');
    expect(copy.detail).toBeNull();
  });

  test('noAnalysisMessage puts the actionable description in message, and detail is null', () => {
    const copy = noAnalysisMessage();
    expect(copy.message).toBe('Run an analysis before searching or opening files.');
    expect(copy.detail).toBeNull();
  });

  test('formatByteSizeLabel renders one decimal place in MB', () => {
    expect(formatByteSizeLabel(2_411_724)).toBe('2.3 MB');
  });
});
