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
