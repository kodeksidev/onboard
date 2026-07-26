/**
 * Ambient module declaration for `import x from './file.scm' with { type: 'text' }`
 * (Bun's text-import attribute, used by `parse/queries.ts` so each
 * tree-sitter `.scm` query file is actually embedded in a `bun build
 * --compile` binary rather than resolving to a virtual path that only
 * exists under `bun run`).
 */
declare module '*.scm' {
  const content: string;
  export default content;
}
