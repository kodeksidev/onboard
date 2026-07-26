import { createRef } from 'react';
import { describe, expect, test } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import { useCodeMirror } from './useCodeMirror';

function setupContainer(): React.RefObject<HTMLDivElement | null> {
  const ref = createRef<HTMLDivElement>();
  render(<div ref={ref} />);
  return ref;
}

describe('useCodeMirror', () => {
  test('mounts a read-only CodeMirror view with the given content', async () => {
    const containerRef = setupContainer();
    renderHook(() => useCodeMirror({ containerRef, content: 'const a = 1;\nconst b = 2;', language: 'ts' }));

    await waitFor(() => {
      expect(containerRef.current?.querySelector('.cm-editor')).not.toBeNull();
    });
    expect(containerRef.current?.textContent).toContain('const a = 1;');
  });

  test('the editor is not editable (read-only, A13)', async () => {
    const containerRef = setupContainer();
    renderHook(() => useCodeMirror({ containerRef, content: 'const a = 1;', language: 'ts' }));

    await waitFor(() => {
      const contentDom = containerRef.current?.querySelector('.cm-content');
      expect(contentDom?.getAttribute('contenteditable')).toBe('false');
    });
  });

  test('scrollToLine moves the cursor/selection to that line', async () => {
    const containerRef = setupContainer();
    const content = Array.from({ length: 50 }, (_unused, index) => `line ${index + 1}`).join('\n');
    const { result } = renderHook(() => useCodeMirror({ containerRef, content, language: 'ts' }));

    await waitFor(() => {
      expect(containerRef.current?.querySelector('.cm-editor')).not.toBeNull();
    });

    result.current.scrollToLine(10);

    await waitFor(() => {
      expect(result.current.getCurrentLine()).toBe(10);
    });
  });

  test('an initial `line` prop scrolls there on mount', async () => {
    const containerRef = setupContainer();
    const content = Array.from({ length: 50 }, (_unused, index) => `line ${index + 1}`).join('\n');
    const { result } = renderHook(() => useCodeMirror({ containerRef, content, language: 'ts', line: 25 }));

    await waitFor(() => {
      expect(result.current.getCurrentLine()).toBe(25);
    });
  });

  test('destroys the previous view when content changes (no leaked instances)', async () => {
    const containerRef = setupContainer();
    const { rerender } = renderHook(({ content }) => useCodeMirror({ containerRef, content, language: 'ts' }), {
      initialProps: { content: 'first' },
    });
    await waitFor(() => expect(containerRef.current?.querySelectorAll('.cm-editor').length).toBe(1));

    rerender({ content: 'second' });

    await waitFor(() => expect(containerRef.current?.textContent).toContain('second'));
    expect(containerRef.current?.querySelectorAll('.cm-editor').length).toBe(1);
  });
});
