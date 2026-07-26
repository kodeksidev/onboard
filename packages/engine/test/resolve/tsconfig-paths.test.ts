import { describe, expect, test } from 'bun:test';
import {
  discoverTsconfigs,
  matchPathsPattern,
  substituteTarget,
  type TsconfigDiscoveryInput,
} from '../../src/resolve/tsconfig-paths';

describe('discoverTsconfigs — extends chains', () => {
  test('merges baseUrl/paths from a base config into the extending config (child overrides)', () => {
    const files: Record<string, string> = {
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@shared/*': ['shared/*'] } } }),
      'tsconfig.json': JSON.stringify({
        extends: './tsconfig.base.json',
        compilerOptions: { paths: { '@/*': ['src/*'] } },
      }),
    };
    const input: TsconfigDiscoveryInput = {
      tsconfigPaths: ['tsconfig.json'],
      readFile: (path) => files[path] ?? null,
    };
    const result = discoverTsconfigs(input);
    expect(result.diagnostics).toEqual([]);
    const config = result.configs[0];
    expect(config?.baseUrl).toBe('.');
    const patterns = config?.paths.map((p) => p.pattern).sort();
    expect(patterns).toEqual(['@/*', '@shared/*']);
  });

  test('emits TSCONFIG_UNREADABLE and skips a config with invalid JSON', () => {
    const input: TsconfigDiscoveryInput = {
      tsconfigPaths: ['tsconfig.json'],
      readFile: () => '{ not valid json',
    };
    const result = discoverTsconfigs(input);
    expect(result.configs).toEqual([]);
    expect(result.diagnostics).toEqual([{ code: 'TSCONFIG_UNREADABLE', path: 'tsconfig.json' }]);
  });

  test('strips JSONC comments before parsing', () => {
    const input: TsconfigDiscoveryInput = {
      tsconfigPaths: ['tsconfig.json'],
      readFile: () => '{\n  // a comment\n  "compilerOptions": { "baseUrl": "." } /* trailing */\n}\n',
    };
    const result = discoverTsconfigs(input);
    expect(result.diagnostics).toEqual([]);
    expect(result.configs[0]?.baseUrl).toBe('.');
  });

  test('stops following extends at a cycle rather than looping forever', () => {
    const files: Record<string, string> = {
      'a.json': JSON.stringify({ extends: './b.json', compilerOptions: { baseUrl: '.' } }),
      'b.json': JSON.stringify({ extends: './a.json' }),
    };
    const input: TsconfigDiscoveryInput = { tsconfigPaths: ['a.json'], readFile: (path) => files[path] ?? null };
    const result = discoverTsconfigs(input);
    expect(result.configs).toHaveLength(1);
  });
});

describe('matchPathsPattern / substituteTarget', () => {
  test('matches a wildcard pattern and captures the remainder', () => {
    expect(matchPathsPattern('@/*', '@/lib/db')).toBe('lib/db');
  });

  test('returns null when the specifier does not match', () => {
    expect(matchPathsPattern('@/*', 'other/lib')).toBeNull();
  });

  test('matches an exact (non-wildcard) pattern', () => {
    expect(matchPathsPattern('@exact', '@exact')).toBe('');
    expect(matchPathsPattern('@exact', '@exact/sub')).toBeNull();
  });

  test('substitutes the capture into the target template', () => {
    expect(substituteTarget('src/*', 'lib/db')).toBe('src/lib/db');
  });
});
