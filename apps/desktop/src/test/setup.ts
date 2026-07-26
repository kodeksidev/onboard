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

/**
 * jsdom has no real layout engine, so `Range.prototype.getClientRects` is
 * unimplemented (`TypeError: textRange(...).getClientRects is not a
 * function`). CodeMirror 6's `EditorView.scrollIntoView` centering logic
 * calls it during its rAF-scheduled measure pass whenever a selection moves
 * (e.g. `FileViewer`'s "jump to symbol" / "open at line" flows). This is a
 * measurement stub, not a behavior fake: it returns an empty, zero-sized
 * rect list, matching the honest "jsdom cannot lay out real text" limitation
 * documented for `@tanstack/react-virtual`'s `offsetHeight` stub, and does
 * not change what CodeMirror computes from document/model state (line
 * numbers, doc content, `EditorState.selection`).
 */
function stubClientRects(): DOMRectList {
  return { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as DOMRectList;
}
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = stubClientRects;
}
if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

afterEach(() => {
  cleanup();
});
