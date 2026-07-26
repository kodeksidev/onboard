/**
 * Ambient module declaration for `import x from './file.wasm' with { type: 'file' }`
 * (Bun's file-import attribute). This yields a string path that is only
 * resolvable through `Bun.file(...)`, not `node:fs` — it is what lets
 * `grammar-loader.ts` embed `web-tree-sitter`'s own `tree-sitter.wasm`
 * runtime so a `bun build --compile` binary can actually find it (see
 * `docs/DECISIONS.md`).
 */
declare module '*.wasm' {
  const filePath: string;
  export default filePath;
}
