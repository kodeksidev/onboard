/**
 * `cytoscape-fcose` and `cytoscape-expand-collapse` (A11) ship no bundled
 * TypeScript declarations. Both are standard Cytoscape.js extension
 * modules: a default export of `(cy: typeof cytoscape) => void` that
 * registers a layout / core extension when passed to `cytoscape.use()`.
 * This is a minimal, honest shim for that shape — not a redeclaration of
 * `@onboard/contract` or any frozen type, just filling a real gap in the
 * third-party ecosystem.
 */
declare module 'cytoscape-fcose' {
  import type cytoscape from 'cytoscape';

  const register: (cs: typeof cytoscape) => void;
  export default register;
}

declare module 'cytoscape-expand-collapse' {
  import type cytoscape from 'cytoscape';

  const register: (cs: typeof cytoscape) => void;
  export default register;
}
