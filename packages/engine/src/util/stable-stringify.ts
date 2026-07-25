/**
 * @onboard/engine — re-export of the frozen `stableStringify` (Section 8.8).
 *
 * `stableStringify` is FROZEN in `@onboard/contract` (Phase 1). The engine
 * never redefines it; this module exists only so engine code can `import
 * { stableStringify } from '../util/stable-stringify'` alongside its other
 * `util/*` siblings without every call site reaching across package
 * boundaries directly. There is exactly one implementation, in the contract
 * package.
 */
export { stableStringify } from '@onboard/contract';
