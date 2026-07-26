/**
 * @onboard/engine — JS/TS/TSX symbol + raw-import extraction (Section 9 Phase 3).
 *
 * Tree-sitter queries (`queries/{javascript,ts,tsx}.scm`) do the broad
 * structural matching; this module refines each match into a `RawSymbol` or
 * `RawImport` (container walking, const-vs-`let` detection, export
 * detection, the component/hook naming heuristics — none of which are
 * expressible as a single query pattern without per-language predicate
 * gymnastics that would be harder to read than the equivalent five lines of
 * TypeScript).
 */
import type { Language, Node, QueryCapture, QueryMatch } from 'web-tree-sitter';
import { Parser, Query } from 'web-tree-sitter';
import { HOOK_BASENAME_PATTERN } from '../constants';
import type {
  LanguageParser,
  ParsedFile,
  RawImport,
  RawImportKind,
  RawSymbol,
  SymbolKindValue,
  SupportedLanguageId,
} from './language-parser';

/** A bare PascalCase identifier (unlike `PASCAL_CASE_TSX_PATTERN`, no file extension). */
const PASCAL_CASE_IDENTIFIER_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const FUNCTION_LIKE_VALUE_TYPES = new Set(['arrow_function', 'function_expression', 'generator_function']);
const CONTAINER_NODE_TYPES = new Set(['function_declaration', 'class_declaration', 'method_definition', 'interface_declaration']);
const SIGNATURE_MAX_LENGTH = 200;
const JSX_CAPABLE_LANGUAGES = new Set<SupportedLanguageId>(['javascript', 'tsx']);

function firstLineSignature(node: Node): string {
  const firstLine = node.text.split('\n')[0] ?? '';
  return firstLine.trim().slice(0, SIGNATURE_MAX_LENGTH);
}

function findContainerName(node: Node): string | null {
  let current = node.parent;
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

function isExportedDeclaration(declNode: Node): boolean {
  return declNode.parent?.type === 'export_statement';
}

function hasTypeOnlyMarker(stmtNode: Node): boolean {
  for (let i = 0; i < stmtNode.childCount; i += 1) {
    if (stmtNode.child(i)?.type === 'type') {
      return true;
    }
  }
  return false;
}

function stringLiteralContent(stringNode: Node): string {
  for (let i = 0; i < stringNode.childCount; i += 1) {
    const child = stringNode.child(i);
    if (child?.type === 'string_fragment') {
      return child.text;
    }
  }
  return stringNode.text;
}

/** Reclassifies a callable's kind by naming convention (hook/component), Section 8.6's style. */
function reclassifyCallable(
  name: string,
  currentKind: SymbolKindValue,
  isFunctionLike: boolean,
  languageId: SupportedLanguageId,
): SymbolKindValue {
  if (!isFunctionLike) {
    return currentKind;
  }
  if (HOOK_BASENAME_PATTERN.test(name)) {
    return 'hook';
  }
  if (JSX_CAPABLE_LANGUAGES.has(languageId) && PASCAL_CASE_IDENTIFIER_PATTERN.test(name)) {
    return 'component';
  }
  return currentKind;
}

function buildFunctionLikeSymbol(nameNode: Node, kind: SymbolKindValue, languageId: SupportedLanguageId): RawSymbol {
  const declNode = nameNode.parent ?? nameNode;
  const resolvedKind = reclassifyCallable(nameNode.text, kind, true, languageId);
  return {
    name: nameNode.text,
    kind: resolvedKind,
    startLine: declNode.startPosition.row + 1,
    endLine: declNode.endPosition.row + 1,
    isExported: isExportedDeclaration(declNode),
    containerName: findContainerName(declNode),
    signature: firstLineSignature(declNode),
  };
}

function buildVariableSymbol(nameNode: Node, keyword: string, languageId: SupportedLanguageId): RawSymbol | null {
  const declarator = nameNode.parent;
  const declNode = declarator?.parent ?? null;
  if (declarator === null || declNode === null) {
    return null;
  }
  const valueNode = declarator.childForFieldName('value');
  const isFunctionLike = valueNode !== null && FUNCTION_LIKE_VALUE_TYPES.has(valueNode.type);
  const baseKind: SymbolKindValue = keyword === 'const' ? 'const' : 'variable';
  return {
    name: nameNode.text,
    kind: reclassifyCallable(nameNode.text, baseKind, isFunctionLike, languageId),
    startLine: declNode.startPosition.row + 1,
    endLine: declNode.endPosition.row + 1,
    isExported: isExportedDeclaration(declNode),
    containerName: findContainerName(declNode),
    signature: firstLineSignature(declNode),
  };
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

function symbolFromMatch(match: QueryMatch, languageId: SupportedLanguageId): RawSymbol | null {
  for (const capture of match.captures) {
    switch (capture.name) {
      case 'symbol.function':
        return buildFunctionLikeSymbol(capture.node, 'function', languageId);
      case 'symbol.class':
        return buildFunctionLikeSymbol(capture.node, 'class', languageId);
      case 'symbol.method':
        return buildFunctionLikeSymbol(capture.node, 'method', languageId);
      case 'symbol.interface':
        return buildFunctionLikeSymbol(capture.node, 'interface', languageId);
      case 'symbol.type':
        return buildFunctionLikeSymbol(capture.node, 'type', languageId);
      case 'symbol.enum':
        return buildFunctionLikeSymbol(capture.node, 'enum', languageId);
      case 'symbol.lexical': {
        const declNode = capture.node.parent?.parent;
        const keyword = declNode?.child(0)?.type ?? 'const';
        return buildVariableSymbol(capture.node, keyword, languageId);
      }
      case 'symbol.var':
        return buildVariableSymbol(capture.node, 'var', languageId);
      case 'route.call':
        return buildRouteSymbol(match.captures);
      default:
        break;
    }
  }
  return null;
}

interface ImportMatchInfo {
  readonly specifier: string;
  readonly kind: RawImportKind;
  readonly isTypeOnly: boolean;
  readonly isLiteral: boolean;
}

function importKindAndSpecifier(match: QueryMatch): ImportMatchInfo | null {
  const names = match.captures.map((c) => c.name);
  if (names.includes('import.stmt')) {
    const stmt = match.captures.find((c) => c.name === 'import.stmt')!.node;
    const source = stmt.childForFieldName('source');
    if (source === null) {
      return null; // side-effect import with no source is unreachable per the grammar, guarded anyway
    }
    const isTypeOnly = hasTypeOnlyMarker(stmt);
    return { specifier: stringLiteralContent(source), kind: isTypeOnly ? 'type' : 'static', isTypeOnly, isLiteral: true };
  }
  if (names.includes('import.reexport_stmt')) {
    const stmt = match.captures.find((c) => c.name === 'import.reexport_stmt')!.node;
    const source = stmt.childForFieldName('source')!;
    return { specifier: stringLiteralContent(source), kind: 'reexport', isTypeOnly: hasTypeOnlyMarker(stmt), isLiteral: true };
  }
  if (names.includes('import.require_stmt')) {
    const arg = match.captures.find((c) => c.name === 'import.require_arg')!.node;
    return { specifier: stringLiteralContent(arg), kind: 'require', isTypeOnly: false, isLiteral: true };
  }
  if (names.includes('import.dynamic_stmt')) {
    const arg = match.captures.find((c) => c.name === 'import.dynamic_arg')!.node;
    const isLiteral = arg.type === 'string';
    const specifier = isLiteral ? stringLiteralContent(arg) : arg.text;
    return { specifier, kind: 'dynamic', isTypeOnly: false, isLiteral };
  }
  return null;
}

function importFromMatch(match: QueryMatch): RawImport | null {
  const resolved = importKindAndSpecifier(match);
  if (resolved === null) {
    return null;
  }
  const anchor = match.captures[0]?.node;
  if (anchor === undefined) {
    return null;
  }
  return {
    specifier: resolved.specifier,
    line: anchor.startPosition.row + 1,
    kind: resolved.kind,
    isTypeOnly: resolved.isTypeOnly,
    isLiteral: resolved.isLiteral,
  };
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

function extractAll(rootNode: Node, query: Query, languageId: SupportedLanguageId): ParsedFile {
  const symbols: RawSymbol[] = [];
  const imports: RawImport[] = [];
  for (const match of query.matches(rootNode)) {
    const symbol = symbolFromMatch(match, languageId);
    if (symbol !== null) {
      symbols.push(symbol);
      continue;
    }
    const rawImport = importFromMatch(match);
    if (rawImport !== null) {
      imports.push(rawImport);
    }
  }
  return {
    imports: [...imports].sort(byLineThenSpecifier),
    symbols: [...symbols].sort(byLineThenName),
    hasSyntaxError: rootNode.hasError,
  };
}

/** Builds a `LanguageParser` for `javascript`, `typescript`, or `tsx` from a loaded grammar + query source. */
export function createTsFamilyParser(languageId: SupportedLanguageId, language: Language, querySource: string): LanguageParser {
  const query = new Query(language, querySource);
  const parser = new Parser();
  parser.setLanguage(language);

  return {
    languageId,
    parse(sourceText: string): ParsedFile {
      const tree = parser.parse(sourceText);
      if (tree === null) {
        throw new Error(`tree-sitter produced a null tree for language '${languageId}'`);
      }
      return extractAll(tree.rootNode, query, languageId);
    },
  };
}
