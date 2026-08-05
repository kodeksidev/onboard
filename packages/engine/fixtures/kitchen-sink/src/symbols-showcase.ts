// Deliberately covers the SymbolKind values not otherwise exercised by the
// other fixtures (interface, type, enum, class, method, variable) — see
// test/parse/symbol-kind-coverage.test.ts.

export interface ShowcaseInterface {
  id: number;
}

export type ShowcaseType = string | number;

export enum ShowcaseEnum {
  A,
  B,
}

export class ShowcaseClass {
  method(): number {
    return 1;
  }
}

let showcaseVariable = 1;
var showcaseLegacyVariable = 2;

// Regression fixture for a real crash: "UNIQUE constraint failed: symbol.id"
// (docs/DECISIONS.md). Two distinct, single-argument `.get(...)` calls that
// share a name and a source line used to be misdetected by the route query
// as two Express-style "route" symbols named "id" — and since
// `computeSymbolId` hashes only path#name#startLine (never `kind`), both
// phantom route rows collided on the exact same `symbol.id` and crashed the
// cache write on insert. Neither call below has a second (handler) argument,
// so the route query must not match either of them.
const cacheA = new Map([['id', 1]]);
const cacheB = new Map([['id', 2]]);
function readBothCaches(): boolean {
  return cacheA.get('id') === cacheB.get('id');
}

// Regression fixture for the SECOND "UNIQUE constraint failed: symbol.id"
// crash — the one the fix above introduced (docs/DECISIONS.md). Requiring a
// handler argument was done with an UNANCHORED `(_) @route.handler`, which
// binds once per argument following the path, so tree-sitter emitted one
// match per binding: `argc - 1` identical route symbols sharing name and
// startLine. The routes below take 3, 4 and 5 arguments and must therefore
// produce exactly ONE route symbol each. Arity 2 — the only arity the
// `node-express` fixture had — is precisely where the defect was invisible,
// which is why it shipped.
declare const showcaseRouter: {
  get(path: string, ...handlers: unknown[]): void;
  post(path: string, ...handlers: unknown[]): void;
  delete(path: string, ...handlers: unknown[]): void;
};
declare const showcaseAuth: unknown;
declare const showcaseAudit: unknown;
declare function showcaseValidate(schema: unknown): unknown;
declare function showcaseHandler(): void;

showcaseRouter.get('/showcase', showcaseValidate({}), showcaseHandler);
showcaseRouter.post('/showcase', showcaseAuth, showcaseValidate({}), showcaseHandler);
showcaseRouter.delete('/showcase/:id', showcaseAuth, showcaseAudit, showcaseValidate({}), showcaseHandler);
