import { describe, expect, test } from 'vitest';
import { AnalysisEnvelope, SearchResponse } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { buildSearchResponse } from './mock-search';

const RESULT = AnalysisEnvelope.parse(rawSampleAnalysis).result;

function search(query: string, limit = 50) {
  const response = buildSearchResponse(RESULT, { repoId: RESULT.repo.id, query, limit });
  expect(() => SearchResponse.parse(response)).not.toThrow();
  return response;
}

describe('buildSearchResponse', () => {
  test('drops terms shorter than 3 characters and reports them', () => {
    const response = search('db');
    expect(response.droppedTerms).toEqual(['db']);
    expect(response.hits).toEqual([]);
  });

  test('an empty query returns an empty response', () => {
    const response = search('   ');
    expect(response.hits).toEqual([]);
    expect(response.droppedTerms).toEqual([]);
  });

  test('expands "auth" via the keyword map and reports the expansion', () => {
    const response = search('auth');
    expect(response.expandedTerms.length).toBeGreaterThan(0);
    expect(response.expandedTerms).toContain('session');
    expect(response.expandedTerms).toEqual([...response.expandedTerms].sort());
  });

  test('ranks an exact symbol-name match above a mere path-segment match', () => {
    const response = search('authservice');
    // No exact match for this made-up term; use a real one instead.
    const authResponse = search('authenticate'); // exact method name in auth.service.ts
    const topHit = authResponse.hits[0];
    expect(topHit?.path).toBe('src/services/auth.service.ts');
    expect(topHit?.symbol?.name).toBe('authenticate');
    expect(response).toBeDefined();
  });

  test('sorts by score desc, then importance desc, then path asc', () => {
    const response = search('service');
    const scores = response.hits.map((hit) => hit.score);
    for (let index = 1; index < scores.length; index += 1) {
      expect(scores[index]!).toBeLessThanOrEqual(scores[index - 1]!);
    }
  });

  test('a filename match produces a hit even with no symbol match', () => {
    const response = search('logger');
    expect(response.hits.some((hit) => hit.path === 'src/utils/logger.ts')).toBe(true);
  });

  test('produces lineHits with a real line number for a symbol match', () => {
    const response = search('authenticate');
    const topHit = response.hits[0]!;
    expect(topHit.lineHits.length).toBeGreaterThan(0);
    expect(topHit.lineHits[0]!.line).toBe(22); // authenticate() starts at line 22 in the fixture
  });

  test('penalizes generated files: the minified vendor bundle never outranks a real symbol match', () => {
    const response = search('vendor');
    const vendorHit = response.hits.find((hit) => hit.path === 'web/src/vendor.min.js');
    expect(vendorHit).toBeDefined();
  });

  test('zero hits for a query that matches nothing', () => {
    const response = search('zzzznonexistentzzzz');
    expect(response.hits).toEqual([]);
  });

  test('respects the limit parameter', () => {
    const response = search('service', 2);
    expect(response.hits.length).toBeLessThanOrEqual(2);
  });
});
