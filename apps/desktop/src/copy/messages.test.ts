import { describe, expect, test } from 'vitest';
import {
  EMPTY_STATE_NO_REPO,
  ERRORS,
  MODE_INDICATOR,
  MODULE_MAP_COPY,
  ROADMAP_COPY,
  SEARCH_COPY,
  resolveErrorCopy,
} from './messages';

describe('MODE_INDICATOR (A6 — frozen verbatim)', () => {
  test('static string is byte-exact, using the middle dot U+00B7', () => {
    expect(MODE_INDICATOR.static).toBe(
      '🔒 Static mode · no network · nothing leaves this machine',
    );
    const middleDotCount = [...MODE_INDICATOR.static].filter((ch) => ch === '·').length;
    expect(middleDotCount).toBe(2);
    expect(MODE_INDICATOR.static).not.toContain('•');
    expect(MODE_INDICATOR.static).not.toContain(' - ');
  });

  test('AI string interpolates provider and model with the middle dot separator', () => {
    expect(MODE_INDICATOR.ai('anthropic', 'claude-sonnet-4-5')).toBe(
      '☁️ AI mode · anthropic/claude-sonnet-4-5 · snippets sent to anthropic',
    );
  });
});

describe('Section 10 literal copy', () => {
  test('no repo chosen yet', () => {
    expect(EMPTY_STATE_NO_REPO.title).toBe('No repository open');
    expect(EMPTY_STATE_NO_REPO.description).toBe(
      'Choose a folder to map. Nothing is uploaded — analysis runs entirely on this machine.',
    );
    expect(EMPTY_STATE_NO_REPO.actionLabel).toBe('Choose folder');
  });

  test('chosen folder deleted before analysis', () => {
    const copy = ERRORS.pathNotFound('acme-api');
    expect(copy.title).toBe('That folder no longer exists');
    expect(copy.description).toBe(
      'Onboard could not find acme-api. It may have been moved, renamed, or deleted.',
    );
    expect(copy.actionLabel).toBe('Choose another folder');
  });

  test('folder unreadable', () => {
    const copy = ERRORS.permissionDenied('acme-api');
    expect(copy.title).toBe("Onboard can't read this folder");
    expect(copy.description).toBe(
      'The operating system denied read access to acme-api. Grant read permission, or pick a folder you own.',
    );
  });

  test('repo exceeds the file ceiling', () => {
    const copy = ERRORS.repoTooLarge(30000);
    expect(copy.title).toBe('This repository is too large to map in one pass');
    expect(copy.description).toBe(
      '30000 source files exceed the 25,000-file limit. Pick a subdirectory such as src/ to map a slice of it.',
    );
    expect(copy.actionLabel).toBe('Choose a subfolder');
  });

  test('sidecar crashes mid-analysis', () => {
    const copy = ERRORS.engineCrashed('/tmp/onboard/onboard.log');
    expect(copy.title).toBe('Analysis stopped unexpectedly');
    expect(copy.description).toBe(
      'The analysis engine exited before finishing. The log is at /tmp/onboard/onboard.log. Retrying usually works — the cache keeps completed files.',
    );
  });

  test('engine binary missing from the installation', () => {
    const copy = ERRORS.engineNotStarted('/tmp/onboard/onboard.log');
    expect(copy.title).toBe('Onboard could not start its analysis engine');
    expect(copy.description).toBe(
      'The analysis engine is missing from this installation, so nothing was analyzed. Reinstalling Onboard should restore it. The log is at /tmp/onboard/onboard.log.',
    );
  });

  test('the not-started copy never leaks a raw OS error string', () => {
    // The defect this copy replaced rendered the spawn failure verbatim:
    // "Failed to start the analysis engine process: The system cannot find
    // the path specified. (os error 3)". Section 12 puts OS strings in
    // `detail`, behind the Details disclosure — never in the body a user
    // reads. Asserting the absence keeps a future edit from reintroducing it.
    const copy = ERRORS.engineNotStarted('/tmp/onboard/onboard.log');
    expect(copy.description).not.toMatch(/os error/i);
    expect(copy.description).not.toMatch(/cannot find the path/i);
  });

  test('search with zero hits', () => {
    const copy = SEARCH_COPY.noResults('foobarbaz');
    expect(copy.title).toBe("Nothing matched 'foobarbaz'");
    expect(copy.description).toBe(
      'Try a concept like auth, payment, or routing — Onboard expands those into related terms.',
    );
  });

  test('search term shorter than 3 chars', () => {
    expect(SEARCH_COPY.droppedTerm('db')).toBe("Ignored: 'db' (min 3 characters)");
  });
});

describe('resolveErrorCopy', () => {
  test('maps a known AppError code to its static title and passes message through as the description', () => {
    const resolved = resolveErrorCopy({
      code: 'E_PATH_NOT_FOUND',
      message: 'Onboard could not find acme-api. It may have been moved, renamed, or deleted.',
    });
    expect(resolved.title).toBe('That folder no longer exists');
    expect(resolved.description).toBe(
      'Onboard could not find acme-api. It may have been moved, renamed, or deleted.',
    );
    expect(resolved.actionLabel).toBe('Choose another folder');
  });

  test('falls back to a generic title for an unrecognized code', () => {
    const resolved = resolveErrorCopy({ code: 'E_TOTALLY_UNKNOWN', message: 'Something specific.' });
    expect(resolved.title).toBe('Something went wrong');
    expect(resolved.description).toBe('Something specific.');
    expect(resolved.actionLabel).toBeNull();
  });
});

describe('ROADMAP_COPY', () => {
  test('every RoadmapStep.section value has a distinct, human-readable label', () => {
    const labels = Object.values(ROADMAP_COPY.sectionLabels);
    expect(labels).toHaveLength(5);
    expect(new Set(labels).size).toBe(5); // all distinct
  });

  test('dependedOnByLabel pluralizes correctly', () => {
    expect(ROADMAP_COPY.dependedOnByLabel(1)).toBe('Imported by 1 file');
    expect(ROADMAP_COPY.dependedOnByLabel(4)).toBe('Imported by 4 files');
  });
});

describe('MODULE_MAP_COPY', () => {
  test('fileCountLabel pluralizes correctly', () => {
    expect(MODULE_MAP_COPY.fileCountLabel(1)).toBe('1 file');
    expect(MODULE_MAP_COPY.fileCountLabel(2)).toBe('2 files');
  });
});
