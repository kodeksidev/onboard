/**
 * @onboard/engine — Python symbol + raw-import extraction (Section 9 Phase 3).
 *
 * Python's grammar has no distinct "method" node (a class method is a plain
 * `function_definition` inside the class's body block) and no export
 * keyword, so both "method vs function" and "isExported" are derived here
 * rather than in `queries/python.scm` — see docs/DECISIONS.md for the exact
 * conventions chosen (name-based export convention, SCREAMING_SNAKE ->
 * `const`).
 */
import type { Language, Node, QueryCapture, QueryMatch } from 'web-tree-sitter';
import { Parser, Query } from 'web-tree-sitter';
import type { LanguageParser, ParsedFile, RawImport, RawImportKind, RawSymbol } from './language-parser';

const CONTAINER_NODE_TYPES = new Set(['function_definition', 'class_definition']);
const CONSTANT_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SIGNATURE_MAX_LENGTH = 200;

function firstLineSignature(node: Node): string {
  const firstLine = node.text.split('\n')[0] ?? '';
  return firstLine.trim().slice(0, SIGNATURE_MAX_LENGTH);
}

/** A `function_definition`/`class_definition` may be wrapped by a transparent `decorated_definition`. */
function definitionPosition(node: Node): Node {
  return node.parent?.type === 'decorated_definition' ? node.parent : node;
}

function findContainerName(node: Node): string | null {
  let current = definitionPosition(node).parent;
  while (current !== null) {
    if (CONTAINER_NODE_TYPES.has(current.type)) {
      const name = current.childForFieldName('name');
      if (name !== null) {
        return name.text;
      }
    }
    current = current.parent;
  }
  return null;
}

function isMethod(fnNode: Node): boolean {
  const parent = definitionPosition(fnNode).parent;
  return parent?.type === 'block' && parent.parent?.type === 'class_definition';
}

/** Convention: a name not starting with `_` is considered part of the module's public surface. */
function isExportedByConvention(name: string): boolean {
  return !name.startsWith('_');
}

function buildFunctionOrClassSymbol(nameNode: Node, isClass: boolean): RawSymbol {
  const declNode = nameNode.parent ?? nameNode;
  const kind = isClass ? 'class' : isMethod(declNode) ? 'method' : 'function';
  return {
    name: nameNode.text,
    kind,
    startLine: definitionPosition(declNode).startPosition.row + 1,
    endLine: definitionPosition(declNode).endPosition.row + 1,
    isExported: isExportedByConvention(nameNode.text),
    containerName: findContainerName(declNode),
    signature: firstLineSignature(declNode),
  };
}

function buildAssignmentSymbol(nameNode: Node): RawSymbol {
  const declNode = nameNode.parent?.parent ?? nameNode; // identifier -> assignment -> expression_statement
  return {
    name: nameNode.text,
    kind: CONSTANT_NAME_PATTERN.test(nameNode.text) ? 'const' : 'variable',
    startLine: declNode.startPosition.row + 1,
    endLine: declNode.endPosition.row + 1,
    isExported: isExportedByConvention(nameNode.text),
    containerName: null, // query anchors this to module-level only
    signature: firstLineSignature(declNode),
  };
}

function stringLiteralContent(stringNode: Node): string {
  for (let i = 0; i < stringNode.childCount; i += 1) {
    const child = stringNode.child(i);
    if (child?.type === 'string_content') {
      return child.text;
    }
  }
  return stringNode.text;
}

function buildRouteSymbol(captures: readonly QueryCapture[]): RawSymbol | null {
  const call = captures.find((c) => c.name === 'route.call')?.node ?? null;
  const path = captures.find((c) => c.name === 'route.path')?.node ?? null;
  if (call === null || path === null) {
    return null;
  }
  return {
    name: stringLiteralContent(path),
    kind: 'route',
    startLine: call.startPosition.row + 1,
    endLine: call.endPosition.row + 1,
    isExported: false,
    containerName: findContainerName(call),
    signature: firstLineSignature(call),
  };
}

function symbolFromMatch(match: QueryMatch): RawSymbol | null {
  for (const capture of match.captures) {
    switch (capture.name) {
      case 'symbol.function_def':
        return buildFunctionOrClassSymbol(capture.node, false);
      case 'symbol.class':
        return buildFunctionOrClassSymbol(capture.node, true);
      case 'symbol.assignment_target':
        return buildAssignmentSymbol(capture.node);
      case 'route.call':
        return buildRouteSymbol(match.captures);
      default:
        break;
    }
  }
  return null;
}

function relativePrefixParts(node: Node): { dots: string; moduleName: string } {
  let dots = '';
  let moduleName = '';
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child?.type === 'import_prefix') {
      dots = child.text;
    }
    if (child?.type === 'dotted_name') {
      moduleName = child.text;
    }
  }
  return { dots, moduleName };
}

function plainImportSpecifiers(node: Node, line: number): RawImport[] {
  const imports: RawImport[] = [];
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child?.type === 'dotted_name') {
      imports.push({ specifier: child.text, line, kind: 'static', isTypeOnly: false, isLiteral: true });
    } else if (child?.type === 'aliased_import') {
      const moduleNode = child.child(0);
      if (moduleNode !== null) {
        imports.push({ specifier: moduleNode.text, line, kind: 'static', isTypeOnly: false, isLiteral: true });
      }
    }
  }
  return imports;
}

function fromImportBasePath(node: Node): string | null {
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child?.type === 'import') {
      return null; // reached the `import` keyword before finding a module clause
    }
    if (child?.type === 'relative_import') {
      const { dots, moduleName } = relativePrefixParts(child);
      return moduleName.length > 0 ? `${dots}${moduleName}` : dots;
    }
    if (child?.type === 'dotted_name') {
      return child.text;
    }
  }
  return null;
}

function fromImportNames(node: Node): Node[] {
  const names: Node[] = [];
  let pastImportKeyword = false;
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child === null) {
      continue;
    }
    if (child.type === 'import') {
      pastImportKeyword = true;
      continue;
    }
    if (pastImportKeyword && (child.type === 'dotted_name' || child.type === 'aliased_import' || child.type === 'wildcard_import')) {
      names.push(child);
    }
  }
  return names;
}

function fromImportSpecifiers(node: Node, line: number): RawImport[] {
  const basePath = fromImportBasePath(node);
  if (basePath === null) {
    return [];
  }
  const separator = basePath.endsWith('.') ? '' : '.';
  const imports: RawImport[] = [];
  for (const nameNode of fromImportNames(node)) {
    if (nameNode.type === 'wildcard_import') {
      imports.push({ specifier: basePath, line, kind: 'static', isTypeOnly: false, isLiteral: true });
      continue;
    }
    const importedText = nameNode.type === 'aliased_import' ? (nameNode.child(0)?.text ?? '') : nameNode.text;
    imports.push({ specifier: `${basePath}${separator}${importedText}`, line, kind: 'static' as RawImportKind, isTypeOnly: false, isLiteral: true });
  }
  return imports;
}

/**
 * `importlib.import_module(...)` (Section 8.2 rule 6). A literal string
 * argument is resolved with the same rules as a normal `import`; anything
 * else (a variable, an f-string, a concatenation, ...) is recorded as a
 * non-literal `dynamic` import so the resolver reports `dynamic-expression`
 * instead of inventing an edge from opaque runtime data.
 */
function dynamicImportFromMatch(match: QueryMatch): RawImport[] {
  const call = match.captures.find((c) => c.name === 'import.dynamic_call')?.node ?? null;
  const arg = match.captures.find((c) => c.name === 'import.dynamic_arg')?.node ?? null;
  if (call === null || arg === null) {
    return [];
  }
  const line = call.startPosition.row + 1;
  if (arg.type === 'string') {
    return [{ specifier: stringLiteralContent(arg), line, kind: 'static', isTypeOnly: false, isLiteral: true }];
  }
  return [{ specifier: arg.text, line, kind: 'dynamic', isTypeOnly: false, isLiteral: false }];
}

function importsFromMatch(match: QueryMatch): RawImport[] {
  if (match.captures.some((c) => c.name === 'import.dynamic_call')) {
    return dynamicImportFromMatch(match);
  }
  const stmt = match.captures.find((c) => c.name === 'import.stmt')?.node ?? null;
  if (stmt === null) {
    return [];
  }
  const line = stmt.startPosition.row + 1;
  return stmt.type === 'import_statement' ? plainImportSpecifiers(stmt, line) : fromImportSpecifiers(stmt, line);
}

function byLineThenName(a: RawSymbol, b: RawSymbol): number {
  if (a.startLine !== b.startLine) {
    return a.startLine - b.startLine;
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function byLineThenSpecifier(a: RawImport, b: RawImport): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0;
}

function extractAll(rootNode: Node, query: Query): ParsedFile {
  const symbols: RawSymbol[] = [];
  const imports: RawImport[] = [];
  for (const match of query.matches(rootNode)) {
    const symbol = symbolFromMatch(match);
    if (symbol !== null) {
      symbols.push(symbol);
      continue;
    }
    imports.push(...importsFromMatch(match));
  }
  return {
    imports: [...imports].sort(byLineThenSpecifier),
    symbols: [...symbols].sort(byLineThenName),
    hasSyntaxError: rootNode.hasError,
  };
}

/** Builds the `python` `LanguageParser` from a loaded grammar + query source. */
export function createPythonParser(language: Language, querySource: string): LanguageParser {
  const query = new Query(language, querySource);
  const parser = new Parser();
  parser.setLanguage(language);

  return {
    languageId: 'python',
    parse(sourceText: string): ParsedFile {
      const tree = parser.parse(sourceText);
      if (tree === null) {
        throw new Error("tree-sitter produced a null tree for language 'python'");
      }
      return extractAll(tree.rootNode, query);
    },
  };
}
