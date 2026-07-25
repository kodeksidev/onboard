/**
 * @onboard/engine — public barrel (Phases 2-3: walk, classify, hash, cache,
 * parsing, symbols, tokens).
 *
 * Phases 4-5 add `resolve/`, `graph/`, `rank/`, `search/`, `rpc/`, and
 * `analyze.ts` on top of this without changing anything re-exported here.
 * The engine remains a standalone module (A1): nothing below couples to
 * Tauri or React, and nothing here ever touches the network (Section 12).
 */

export * from './constants';

export * from './walk/walk';
export * from './walk/gitignore';
export * from './walk/skip-rules';

export * from './classify/classify-file';
export * from './classify/convention-tables';

export * from './cache/cache-store';
export * from './cache/sqlite-cache-store';
export * from './cache/invalidation';

export * from './parse/language-parser';
export * from './parse/grammar-loader';
export * from './parse/parser-pool';

export * from './index/symbol-index';
export * from './index/token-index';

export * from './util/posix-path';
export * from './util/hash';
export * from './util/stable-stringify';
