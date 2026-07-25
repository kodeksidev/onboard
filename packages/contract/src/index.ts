/**
 * @onboard/contract — public barrel.
 *
 * This is the frozen JSON contract (Section 7) that the engine, the Rust
 * shell, and the React UI all consume unchanged. See analysis-result.ts,
 * search.ts, rpc.ts, and error.ts for the individual schema groups.
 */

export * from './analysis-result';
export * from './search';
export * from './rpc';
export * from './error';
export * from './stable-stringify';
