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
