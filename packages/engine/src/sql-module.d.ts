/**
 * Ambient module declaration for `import x from './file.sql' with { type: 'text' }`
 * (Bun's text-import attribute, used by `cache/sqlite-cache-store.ts` so
 * `schema.sql` is actually embedded in a `bun build --compile` binary rather
 * than resolving to a virtual path that only exists under `bun run`).
 */
declare module '*.sql' {
  const content: string;
  export default content;
}
