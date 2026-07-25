import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom does not implement `window.matchMedia`. Every component that reads
 * `prefers-reduced-motion` or `prefers-color-scheme` needs a stub, so it is
 * installed once here rather than duplicated per test file. Defaults to "no
 * preference" (`matches: false`); tests that need reduced-motion override it
 * with `vi.spyOn(window, 'matchMedia')`.
 */
function createMatchMediaStub(): typeof window.matchMedia {
  return (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

window.matchMedia = window.matchMedia ?? createMatchMediaStub();

afterEach(() => {
  cleanup();
});
