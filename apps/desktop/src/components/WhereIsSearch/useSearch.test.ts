import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ipc } from '@/ipc/ipc';
import { useSearch, SEARCH_DEBOUNCE_MS } from './useSearch';

const REPO_ID = '9f3c1a7b2e5d4086';

afterEach(() => {
  vi.useRealTimers();
});

describe('useSearch', () => {
  test('does nothing until a query is set', () => {
    const { result } = renderHook(() => useSearch(REPO_ID));
    expect(result.current.response).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  test('debounces at SEARCH_DEBOUNCE_MS before calling the IPC layer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const searchSpy = vi.spyOn(ipc, 'searchRepo');
    const { result } = renderHook(() => useSearch(REPO_ID));

    act(() => {
      result.current.setQuery('auth');
    });
    expect(searchSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(searchSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(searchSpy).toHaveBeenCalledWith({ repoId: REPO_ID, query: 'auth', limit: 50 });
  });

  test('re-typing before the debounce fires cancels the earlier timer (only one call)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const searchSpy = vi.spyOn(ipc, 'searchRepo');
    const { result } = renderHook(() => useSearch(REPO_ID));

    act(() => {
      result.current.setQuery('a');
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 10);
    });
    act(() => {
      result.current.setQuery('auth');
    });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledWith({ repoId: REPO_ID, query: 'auth', limit: 50 });
  });

  test('populates a real, zod-validated response for a genuine query', async () => {
    const { result } = renderHook(() => useSearch(REPO_ID));

    act(() => {
      result.current.setQuery('authenticate');
    });

    await waitFor(() => expect(result.current.response).not.toBeNull());
    expect(result.current.response?.hits[0]?.path).toBe('src/services/auth.service.ts');
    expect(result.current.isLoading).toBe(false);
  });

  test('clearing the query clears the response', async () => {
    const { result } = renderHook(() => useSearch(REPO_ID));
    act(() => {
      result.current.setQuery('authenticate');
    });
    await waitFor(() => expect(result.current.response).not.toBeNull());

    act(() => {
      result.current.setQuery('');
    });

    expect(result.current.response).toBeNull();
  });

  test('an in-flight query is discarded if a newer one starts (stale-response guard)', async () => {
    const { result } = renderHook(() => useSearch(REPO_ID));

    act(() => {
      result.current.setQuery('authenticate');
    });
    act(() => {
      result.current.setQuery('logger');
    });

    await waitFor(() => expect(result.current.response).not.toBeNull());
    expect(result.current.response?.query).toBe('logger');
  });
});
