import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { search, searchKeymap } from '@codemirror/search';
import type { AnalysisResult } from '@onboard/contract';

/** `Language` isn't re-exported as a type by `@onboard/contract` (only its zod schema); derive it from a field that is. */
export type Language = AnalysisResult['files'][number]['language'];

/**
 * CodeMirror 6, read-only (A13): virtualized rendering means even a
 * 20,000-line file mounts fast (Section 9 Phase 10's gate) — CM6 only ever
 * builds DOM for the visible window, not the whole document. Language
 * support is chosen per `Language` (Section 7's frozen enum); `other`
 * (and any language without dedicated CM6 support in Section 4's package
 * list) falls back to plain-text highlighting rather than erroring.
 */
function languageExtension(language: Language): Extension {
  switch (language) {
    case 'ts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'js':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'py':
      return python();
    case 'json':
      return json();
    case 'md':
      return markdown();
    default:
      return [];
  }
}

/**
 * CodeMirror's content DOM (`.cm-content`) has `role="textbox"` (Section
 * 9's read-only editor is still an ARIA textbox, just non-editable) with no
 * accessible name of its own — axe-core's `aria-input-field-name` rule
 * correctly flags that. `contentAttributes` sets a real `aria-label` on that
 * exact element.
 */
function buildExtensions(language: Language, ariaLabel: string): Extension[] {
  return [
    lineNumbers(),
    syntaxHighlighting(defaultHighlightStyle),
    languageExtension(language),
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
    keymap.of(searchKeymap),
    search(),
  ];
}

/** Scrolls the view so `line` (1-based, clamped to the document) is centered and places the cursor there. */
export function scrollToLine(view: EditorView | null, line: number): void {
  if (view === null) {
    return;
  }
  const clampedLine = Math.min(Math.max(line, 1), view.state.doc.lines);
  const lineInfo = view.state.doc.line(clampedLine);
  view.dispatch({
    selection: { anchor: lineInfo.from },
    effects: EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
  });
}

/** Reads the 1-based line the cursor currently sits on. */
export function currentLine(view: EditorView | null): number | null {
  if (view === null) {
    return null;
  }
  return view.state.doc.lineAt(view.state.selection.main.head).number;
}

const DEFAULT_EDITOR_ARIA_LABEL = 'File contents';

export interface UseCodeMirrorOptions {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly content: string;
  readonly language: Language;
  readonly line?: number;
  /** Accessible name for the editor's `role="textbox"` content region; defaults to a generic label. */
  readonly ariaLabel?: string;
}

export interface UseCodeMirrorApi {
  scrollToLine: (line: number) => void;
  /** 1-based line the cursor is on, or `null` before the view mounts. Mainly a test seam. */
  getCurrentLine: () => number | null;
}

/** Owns the one `EditorView` instance for the mounted `FileViewer` (mirrors `useCytoscape.ts`'s pattern). */
export function useCodeMirror(options: UseCodeMirrorOptions): UseCodeMirrorApi {
  const { containerRef, content, language, line, ariaLabel = DEFAULT_EDITOR_ARIA_LABEL } = options;
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (containerRef.current === null) {
      return undefined;
    }
    const view = new EditorView({
      state: EditorState.create({ doc: content, extensions: buildExtensions(language, ariaLabel) }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [content, language, containerRef, ariaLabel]);

  useEffect(() => {
    if (line !== undefined) {
      scrollToLine(viewRef.current, line);
    }
    // Re-run whenever a fresh view is mounted (content/language changed) too, so the requested line still applies.
  }, [line, content, language]);

  return {
    scrollToLine: useCallback((targetLine: number) => scrollToLine(viewRef.current, targetLine), []),
    getCurrentLine: useCallback(() => currentLine(viewRef.current), []),
  };
}
