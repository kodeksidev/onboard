import { beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createGrammarLoader } from '../../src/parse/grammar-loader';
import { readQuerySource } from '../../src/parse/queries';
import { createPythonParser } from '../../src/parse/python-parser';
import type { LanguageParser } from '../../src/parse/language-parser';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');

let pythonParser: LanguageParser;

beforeAll(async () => {
  const loader = createGrammarLoader(GRAMMARS_DIR);
  const language = await loader.getLanguage('python');
  pythonParser = createPythonParser(language, readQuerySource('python'));
});

function symbolNamed(parsed: ReturnType<LanguageParser['parse']>, name: string) {
  return parsed.symbols.find((s) => s.name === name);
}

describe('createPythonParser — functions, classes, methods', () => {
  test('extracts a top-level function as kind "function"', () => {
    const parsed = pythonParser.parse('def main():\n    pass\n');
    expect(symbolNamed(parsed, 'main')?.kind).toBe('function');
  });

  test('extracts a class and reclassifies its nested def as "method"', () => {
    const parsed = pythonParser.parse('class Foo:\n    def bar(self):\n        return 1\n');
    expect(symbolNamed(parsed, 'Foo')?.kind).toBe('class');
    const method = symbolNamed(parsed, 'bar');
    expect(method?.kind).toBe('method');
    expect(method?.containerName).toBe('Foo');
  });

  test('a name starting with "_" is not exported by convention; others are', () => {
    const parsed = pythonParser.parse('def _private():\n    pass\ndef public():\n    pass\n');
    expect(symbolNamed(parsed, '_private')?.isExported).toBe(false);
    expect(symbolNamed(parsed, 'public')?.isExported).toBe(true);
  });
});

describe('createPythonParser — module-level assignment', () => {
  test('a SCREAMING_SNAKE_CASE assignment is kind "const"', () => {
    const parsed = pythonParser.parse('MAX_RETRIES = 3\n');
    expect(symbolNamed(parsed, 'MAX_RETRIES')?.kind).toBe('const');
  });

  test('a lowercase assignment is kind "variable"', () => {
    const parsed = pythonParser.parse('counter = 0\n');
    expect(symbolNamed(parsed, 'counter')?.kind).toBe('variable');
  });

  test('does not index an assignment inside a function body', () => {
    const parsed = pythonParser.parse('def f():\n    local_var = 1\n    return local_var\n');
    expect(symbolNamed(parsed, 'local_var')).toBeUndefined();
  });
});

describe('createPythonParser — route detection via decorator', () => {
  test('extracts a Flask-style @app.route(...) decorated function as a route symbol', () => {
    const parsed = pythonParser.parse("@app.route('/users/<id>')\ndef get_user(id):\n    return {}\n");
    const route = parsed.symbols.find((s) => s.kind === 'route');
    expect(route?.name).toBe('/users/<id>');
    expect(parsed.symbols.some((s) => s.name === 'get_user' && s.kind === 'function')).toBe(true);
  });
});

describe('createPythonParser — raw imports', () => {
  test('extracts a plain "import os"', () => {
    const parsed = pythonParser.parse('import os\n');
    expect(parsed.imports).toEqual([{ specifier: 'os', line: 1, kind: 'static', isTypeOnly: false, isLiteral: true }]);
  });

  test('extracts an aliased import by its real module name', () => {
    const parsed = pythonParser.parse('import os.path as osp\n');
    expect(parsed.imports).toEqual([{ specifier: 'os.path', line: 1, kind: 'static', isTypeOnly: false, isLiteral: true }]);
  });

  test('extracts "from typing import Optional" as a combined specifier', () => {
    const parsed = pythonParser.parse('from typing import Optional\n');
    expect(parsed.imports).toEqual([{ specifier: 'typing.Optional', line: 1, kind: 'static', isTypeOnly: false, isLiteral: true }]);
  });

  test('extracts a relative "from . import sibling"', () => {
    const parsed = pythonParser.parse('from . import sibling\n');
    expect(parsed.imports).toEqual([{ specifier: '.sibling', line: 1, kind: 'static', isTypeOnly: false, isLiteral: true }]);
  });

  test('extracts a two-dot relative "from ..models import User"', () => {
    const parsed = pythonParser.parse('from ..models import User\n');
    expect(parsed.imports).toEqual([{ specifier: '..models.User', line: 1, kind: 'static', isTypeOnly: false, isLiteral: true }]);
  });

  test('extracts multiple names from one "from x import a, b"', () => {
    const parsed = pythonParser.parse('from x import a, b\n');
    expect(parsed.imports).toEqual([
      { specifier: 'x.a', line: 1, kind: 'static', isTypeOnly: false, isLiteral: true },
      { specifier: 'x.b', line: 1, kind: 'static', isTypeOnly: false, isLiteral: true },
    ]);
  });

  test('extracts a wildcard import as just the module', () => {
    const parsed = pythonParser.parse('from z import *\n');
    expect(parsed.imports).toEqual([{ specifier: 'z', line: 1, kind: 'static', isTypeOnly: false, isLiteral: true }]);
  });
});

describe('createPythonParser — importlib.import_module (Section 8.2 rule 6)', () => {
  test('a literal string argument is extracted as a normal, literal, resolvable import', () => {
    const parsed = pythonParser.parse("import importlib\nimportlib.import_module('app.models.user_model')\n");
    expect(parsed.imports).toContainEqual({
      specifier: 'app.models.user_model',
      line: 2,
      kind: 'static',
      isTypeOnly: false,
      isLiteral: true,
    });
  });

  test('a non-literal (variable) argument is extracted as a non-literal dynamic import', () => {
    const parsed = pythonParser.parse('import importlib\ndef load(name):\n    return importlib.import_module(name)\n');
    expect(parsed.imports).toContainEqual({ specifier: 'name', line: 3, kind: 'dynamic', isTypeOnly: false, isLiteral: false });
  });

  test('ignores a trailing keyword argument and captures only the first positional argument', () => {
    const parsed = pythonParser.parse("import importlib\nimportlib.import_module('pkg.mod', package='pkg')\n");
    expect(parsed.imports).toContainEqual({ specifier: 'pkg.mod', line: 2, kind: 'static', isTypeOnly: false, isLiteral: true });
    expect(parsed.imports.some((imp) => imp.specifier === 'pkg')).toBe(false);
  });
});

describe('createPythonParser — syntax error detection', () => {
  test('flags hasSyntaxError for malformed source without throwing', () => {
    const parsed = pythonParser.parse('def broken(:\n    return\n!!!\n');
    expect(parsed.hasSyntaxError).toBe(true);
  });
});
