import { describe, expect, test } from 'vitest';
import { AnalysisEnvelope } from '@onboard/contract';
import { createMockIpc } from './mock-ipc';

describe('createMockIpc', () => {
  test('pickRepoFolder resolves a deterministic mock path', async () => {
    const ipc = createMockIpc();
    const result = await ipc.pickRepoFolder();
    expect(result.path).not.toBeNull();
  });

  test('analyzeRepo resolves a schema-valid AnalysisEnvelope built from the sample fixture', async () => {
    const ipc = createMockIpc();
    const envelope = await ipc.analyzeRepo({ path: '/mock/repo', isForceRefresh: false });
    expect(() => AnalysisEnvelope.parse(envelope)).not.toThrow();
    expect(envelope.result.repo.name).toBe('acme-billing-api');
  });

  test('analyzeRepo emits a progress event for every phase before resolving', async () => {
    const ipc = createMockIpc();
    const seenPhases: string[] = [];
    const unsubscribe = ipc.onAnalysisProgress((event) => {
      seenPhases.push(event.phase);
    });

    await ipc.analyzeRepo({ path: '/mock/repo', isForceRefresh: false });
    unsubscribe();

    expect(seenPhases).toEqual(['walk', 'parse', 'resolve', 'graph', 'rank', 'persist']);
  });

  test('unsubscribing stops further progress delivery', async () => {
    const ipc = createMockIpc();
    let callCount = 0;
    const unsubscribe = ipc.onAnalysisProgress(() => {
      callCount += 1;
    });
    unsubscribe();

    await ipc.analyzeRepo({ path: '/mock/repo', isForceRefresh: false });

    expect(callCount).toBe(0);
  });

  test('getSettings/updateSettings round-trip immutably', async () => {
    const ipc = createMockIpc();
    const before = await ipc.getSettings();
    expect(before.ai.isEnabled).toBe(false);

    const after = await ipc.updateSettings({ ai: { ...before.ai, isEnabled: true } });

    expect(after.ai.isEnabled).toBe(true);
    expect(before.ai.isEnabled).toBe(false); // the original snapshot was not mutated
  });

  test('ai_* actions reject with E_AI_DISABLED while the master toggle is off (A5 default)', async () => {
    const ipc = createMockIpc();
    await expect(ipc.aiProjectSummary({ repoId: '9f3c1a7b2e5d4086' })).rejects.toMatchObject({
      code: 'E_AI_DISABLED',
    });
  });

  test('ai_* actions succeed and cite an indexed path once AI is enabled', async () => {
    const ipc = createMockIpc();
    await ipc.updateSettings({ ai: { ...(await ipc.getSettings()).ai, isEnabled: true } });

    const result = await ipc.aiAsk({ repoId: '9f3c1a7b2e5d4086', question: 'What does this do?' });

    expect(result.citedPaths.length).toBeGreaterThan(0);
    expect(result.markdown).toContain(result.citedPaths[0]);
  });

  test('testAiKey rejects E_AI_KEY_INVALID until a key has been stored', async () => {
    const ipc = createMockIpc();
    await expect(ipc.testAiKey({ provider: 'anthropic', model: 'claude-sonnet-4-5' })).rejects.toMatchObject({
      code: 'E_AI_KEY_INVALID',
    });

    await ipc.storeAiKey({ provider: 'anthropic', apiKey: 'sk-ant-test-key-0000000000000000000' });
    const result = await ipc.testAiKey({ provider: 'anthropic', model: 'claude-sonnet-4-5' });

    expect(result.isOk).toBe(true);
  });

  test('readRepoFile returns synthetic content that preserves the fixture line count', async () => {
    const ipc = createMockIpc();
    const result = await ipc.readRepoFile({ repoId: '9f3c1a7b2e5d4086', path: 'src/index.ts' });
    expect(result.content.split('\n')).toHaveLength(result.lineCount);
  });

  test('readRepoFile rejects an unindexed path rather than inventing content', async () => {
    const ipc = createMockIpc();
    await expect(
      ipc.readRepoFile({ repoId: '9f3c1a7b2e5d4086', path: 'does/not/exist.ts' }),
    ).rejects.toMatchObject({ path: 'does/not/exist.ts' });
  });

  test('searchRepo drops sub-3-character terms and reports them', async () => {
    const ipc = createMockIpc();
    const response = await ipc.searchRepo({ repoId: '9f3c1a7b2e5d4086', query: 'db', limit: 50 });
    expect(response.droppedTerms).toContain('db');
    expect(response.hits).toHaveLength(0);
  });

  test('searchRepo matches on a path segment for a valid term', async () => {
    const ipc = createMockIpc();
    const response = await ipc.searchRepo({ repoId: '9f3c1a7b2e5d4086', query: 'auth', limit: 50 });
    expect(response.hits.some((hit) => hit.path.includes('auth'))).toBe(true);
  });
});
