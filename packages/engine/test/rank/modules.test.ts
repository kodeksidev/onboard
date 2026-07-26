import { describe, expect, test } from 'bun:test';
import { buildModules, computeModuleIdByPath, type ModuleFileInput, type ModuleInput } from '../../src/rank/modules';

function file(path: string, overrides: Partial<ModuleFileInput> = {}): ModuleFileInput {
  return { path, isParsed: true, importance: 0.1, importanceRank: 10, ...overrides };
}

describe('buildModules', () => {
  test('a directory with >= 3 parsed files becomes a module', () => {
    const input: ModuleInput = {
      files: [file('src/routes/a.ts'), file('src/routes/b.ts'), file('src/routes/c.ts')],
      sourceRoots: [''],
      edges: [],
    };
    const modules = buildModules(input);
    expect(modules).toHaveLength(1);
    expect(modules[0]?.dirPath).toBe('src/routes');
    expect(modules[0]?.fileCount).toBe(3);
  });

  test('a directory with fewer than MODULE_MIN_FILES parsed files is not a module', () => {
    const input: ModuleInput = {
      files: [file('src/routes/a.ts'), file('src/routes/b.ts')],
      sourceRoots: [''],
      edges: [],
    };
    expect(buildModules(input)).toEqual([]);
  });

  test('purposeByConvention comes from the static table for a known directory name', () => {
    const input: ModuleInput = {
      files: [file('src/services/a.ts'), file('src/services/b.ts'), file('src/services/c.ts')],
      sourceRoots: [''],
      edges: [],
    };
    const modules = buildModules(input);
    expect(modules[0]?.purposeByConvention).toBe('Business logic, independent of any transport layer.');
  });

  test('an unknown directory name gets the "{n} files; no directory convention matched." fallback', () => {
    const input: ModuleInput = {
      files: [file('src/whatsit/a.ts'), file('src/whatsit/b.ts'), file('src/whatsit/c.ts')],
      sourceRoots: [''],
      edges: [],
    };
    const modules = buildModules(input);
    expect(modules[0]?.purposeByConvention).toBe('3 files; no directory convention matched.');
  });

  test('a file belongs to its deepest qualifying ancestor (depth-2 wins over depth-1 when both qualify)', () => {
    const input: ModuleInput = {
      files: [
        file('src/other1.ts'),
        file('src/other2.ts'),
        file('src/other3.ts'), // 3 files directly in 'src' -> 'src' (depth 1) qualifies
        file('src/api/a.ts'),
        file('src/api/b.ts'),
        file('src/api/c.ts'), // 3 files directly in 'src/api' -> 'src/api' (depth 2) also qualifies
      ],
      sourceRoots: [''],
      edges: [],
    };
    const moduleId = computeModuleIdByPath(input);
    // 'src/api/a.ts' has BOTH 'src' and 'src/api' as qualifying candidate ancestors -> the deeper one wins.
    expect(moduleId.get('src/api/a.ts')).toBe('src-api');
    // 'src/other1.ts' only has 'src' as a candidate ancestor (no depth-2 candidate applies to it).
    expect(moduleId.get('src/other1.ts')).toBe('src');
    const modules = buildModules(input);
    expect(modules.map((m) => m.dirPath).sort()).toEqual(['src', 'src/api']);
  });

  test('a directory below the depth-1/2 window never qualifies, however many direct files it has', () => {
    const input: ModuleInput = {
      files: [
        file('src/onlyone.ts'), // only 1 file directly in 'src' -> 'src' (depth 1) does not qualify
        file('src/api/a.ts'),
        file('src/api/b.ts'),
        file('src/api/c.ts'), // 'src/api' (depth 2) qualifies
      ],
      sourceRoots: [''],
      edges: [],
    };
    const modules = buildModules(input);
    expect(modules.map((m) => m.dirPath)).toEqual(['src/api']);
    const moduleId = computeModuleIdByPath(input);
    expect(moduleId.get('src/onlyone.ts')).toBeUndefined(); // no qualifying ancestor at depth 1 or 2
  });

  test('keyFilePaths is the top 5 by importanceRank ascending', () => {
    const files = Array.from({ length: 8 }, (_, i) => file(`src/big/f${String(i)}.ts`, { importanceRank: 8 - i }));
    const input: ModuleInput = { files, sourceRoots: [''], edges: [] };
    const modules = buildModules(input);
    expect(modules[0]?.keyFilePaths).toEqual(['f7.ts', 'f6.ts', 'f5.ts', 'f4.ts', 'f3.ts'].map((f) => `src/big/${f}`));
  });

  test('dependsOnModuleIds / dependedOnByModuleIds reflect cross-module edges', () => {
    const input: ModuleInput = {
      files: [
        file('src/routes/a.ts'),
        file('src/routes/b.ts'),
        file('src/routes/c.ts'),
        file('src/services/a.ts'),
        file('src/services/b.ts'),
        file('src/services/c.ts'),
      ],
      sourceRoots: [''],
      edges: [{ fromPath: 'src/routes/a.ts', toPath: 'src/services/a.ts' }],
    };
    const modules = buildModules(input);
    const routes = modules.find((m) => m.dirPath === 'src/routes')!;
    const services = modules.find((m) => m.dirPath === 'src/services')!;
    expect(routes.dependsOnModuleIds).toEqual(['src-services']);
    expect(services.dependedOnByModuleIds).toEqual(['src-routes']);
  });

  test('modules are sorted by dirPath', () => {
    const input: ModuleInput = {
      files: [
        file('src/zeta/a.ts'),
        file('src/zeta/b.ts'),
        file('src/zeta/c.ts'),
        file('src/alpha/a.ts'),
        file('src/alpha/b.ts'),
        file('src/alpha/c.ts'),
      ],
      sourceRoots: [''],
      edges: [],
    };
    const modules = buildModules(input);
    expect(modules.map((m) => m.dirPath)).toEqual(['src/alpha', 'src/zeta']);
  });

  test('returns an empty array when nothing qualifies', () => {
    const input: ModuleInput = { files: [file('index.ts')], sourceRoots: [''], edges: [] };
    expect(buildModules(input)).toEqual([]);
  });
});
