import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { Language } from 'web-tree-sitter';
import { createGrammarLoader } from '../../src/parse/grammar-loader';
import { readQuerySource } from '../../src/parse/queries';
import { createTsFamilyParser } from '../../src/parse/ts-parser';
import type { LanguageParser } from '../../src/parse/language-parser';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');

let tsParser: LanguageParser;
let jsParser: LanguageParser;
let tsxParser: LanguageParser;

beforeAll(async () => {
  const loader = createGrammarLoader(GRAMMARS_DIR);
  const tsLang: Language = await loader.getLanguage('typescript');
  const jsLang: Language = await loader.getLanguage('javascript');
  const tsxLang: Language = await loader.getLanguage('tsx');
  tsParser = createTsFamilyParser('typescript', tsLang, readQuerySource('typescript'));
  jsParser = createTsFamilyParser('javascript', jsLang, readQuerySource('javascript'));
  tsxParser = createTsFamilyParser('tsx', tsxLang, readQuerySource('tsx'));
});

afterAll(() => {
  // no explicit teardown required; Parser/Language instances are GC'd normally
});

function symbolNamed(parsed: ReturnType<LanguageParser['parse']>, name: string) {
  return parsed.symbols.find((s) => s.name === name);
}

describe('createTsFamilyParser — functions, classes, methods', () => {
  test('extracts a top-level function declaration', () => {
    const parsed = tsParser.parse('function add(a: number, b: number): number { return a + b; }');
    const symbol = symbolNamed(parsed, 'add');
    expect(symbol?.kind).toBe('function');
    expect(symbol?.isExported).toBe(false);
  });

  test('extracts an exported class and its method, with the method\'s container set', () => {
    const parsed = tsParser.parse('export class Widget {\n  render(): string {\n    return "x";\n  }\n}');
    const cls = symbolNamed(parsed, 'Widget');
    const method = symbolNamed(parsed, 'render');
    expect(cls?.kind).toBe('class');
    expect(cls?.isExported).toBe(true);
    expect(method?.kind).toBe('method');
    expect(method?.containerName).toBe('Widget');
  });
});

describe('createTsFamilyParser — const/let/var and hook/component naming', () => {
  test('a top-level const is kind "const"; a top-level let is kind "variable"', () => {
    const parsed = tsParser.parse('const PI = 3.14;\nlet counter = 0;\nvar legacy = 1;');
    expect(symbolNamed(parsed, 'PI')?.kind).toBe('const');
    expect(symbolNamed(parsed, 'counter')?.kind).toBe('variable');
    expect(symbolNamed(parsed, 'legacy')?.kind).toBe('variable');
  });

  test('does not index a function-local variable (only program-level declarations)', () => {
    const parsed = tsParser.parse('function outer() {\n  const inner = 1;\n  return inner;\n}');
    expect(symbolNamed(parsed, 'inner')).toBeUndefined();
    expect(symbolNamed(parsed, 'outer')?.kind).toBe('function');
  });

  test('a use[A-Z]-named function is reclassified as a hook, even in a .ts file', () => {
    const parsed = tsParser.parse('export function useCounter() { return 1; }');
    expect(symbolNamed(parsed, 'useCounter')?.kind).toBe('hook');
  });

  test('a PascalCase function in a .tsx file is reclassified as a component', () => {
    const parsed = tsxParser.parse('export function Card() { return null; }');
    expect(symbolNamed(parsed, 'Card')?.kind).toBe('component');
  });

  test('a PascalCase arrow-function const in a .tsx file is reclassified as a component', () => {
    const parsed = tsxParser.parse('export const Header = () => { return null; };');
    expect(symbolNamed(parsed, 'Header')?.kind).toBe('component');
  });

  test('a PascalCase function in a plain .ts file is NOT reclassified as a component (no JSX)', () => {
    const parsed = tsParser.parse('export function NotAComponent() { return 1; }');
    expect(symbolNamed(parsed, 'NotAComponent')?.kind).toBe('function');
  });

  test('a PascalCase const whose value is not a function is left as "const"', () => {
    const parsed = tsxParser.parse('export const Config = { flag: true };');
    expect(symbolNamed(parsed, 'Config')?.kind).toBe('const');
  });
});

describe('createTsFamilyParser — TypeScript-only declarations', () => {
  test('extracts interface, type alias, and enum', () => {
    const parsed = tsParser.parse(
      'export interface Foo { x: number }\nexport type Bar = string;\nexport enum Color { Red, Green }',
    );
    expect(symbolNamed(parsed, 'Foo')?.kind).toBe('interface');
    expect(symbolNamed(parsed, 'Bar')?.kind).toBe('type');
    expect(symbolNamed(parsed, 'Color')?.kind).toBe('enum');
  });
});

describe('createTsFamilyParser — route detection', () => {
  test('extracts a router.get(...) call as a route symbol named after its path', () => {
    const parsed = jsParser.parse("router.get('/users/:id', getUser);");
    const route = parsed.symbols.find((s) => s.kind === 'route');
    expect(route?.name).toBe('/users/:id');
  });
});

describe('createTsFamilyParser — raw imports', () => {
  test('extracts a static default import', () => {
    const parsed = jsParser.parse("import React from 'react';");
    expect(parsed.imports).toEqual([{ specifier: 'react', line: 1, kind: 'static', isTypeOnly: false, isLiteral: true }]);
  });

  test('marks `import type` as kind "type" with isTypeOnly true', () => {
    const parsed = tsParser.parse("import type { Foo } from './foo';");
    expect(parsed.imports).toEqual([{ specifier: './foo', line: 1, kind: 'type', isTypeOnly: true, isLiteral: true }]);
  });

  test('extracts a bare re-export as kind "reexport"', () => {
    const parsed = jsParser.parse("export * from './reexport';");
    expect(parsed.imports).toEqual([{ specifier: './reexport', line: 1, kind: 'reexport', isTypeOnly: false, isLiteral: true }]);
  });

  test('extracts a require() call as kind "require"', () => {
    const parsed = jsParser.parse("const fs = require('node:fs');");
    expect(parsed.imports).toEqual([{ specifier: 'node:fs', line: 1, kind: 'require', isTypeOnly: false, isLiteral: true }]);
  });

  test('extracts a literal dynamic import() as kind "dynamic"', () => {
    const parsed = jsParser.parse("const mod = import('./lazy');");
    expect(parsed.imports).toEqual([{ specifier: './lazy', line: 1, kind: 'dynamic', isTypeOnly: false, isLiteral: true }]);
  });

  test('extracts a non-literal dynamic import() with the raw expression as its specifier', () => {
    const parsed = jsParser.parse('const mod = import(pathVar);');
    expect(parsed.imports).toEqual([{ specifier: 'pathVar', line: 1, kind: 'dynamic', isTypeOnly: false, isLiteral: false }]);
  });

  test('does not invent an edge for a plain function call named "notrequire"', () => {
    const parsed = jsParser.parse("const x = notrequire('./nope');");
    expect(parsed.imports).toEqual([]);
  });
});

describe('createTsFamilyParser — syntax error detection', () => {
  test('flags hasSyntaxError for malformed source without throwing', () => {
    const parsed = jsParser.parse('function broken( { const x = ; return } !!!');
    expect(parsed.hasSyntaxError).toBe(true);
  });

  test('does not flag well-formed source', () => {
    const parsed = jsParser.parse('function ok() { return 1; }');
    expect(parsed.hasSyntaxError).toBe(false);
  });
});
