/**
 * Section 8.2 rule 9 / Section 13 criterion 7: `import()` with a non-literal
 * (template-literal) argument must be recorded as an `UnresolvedImport` with
 * reason 'dynamic-expression', never invented as a resolved edge.
 *
 * Deliberately never imported by anything else — one of Section 13
 * criterion 7's "2 known orphans": this file has zero resolved edges in
 * either direction, since its only import can never resolve.
 */
const pluginName = 'reporting';

export function loadPlugin(): Promise<unknown> {
  return import(`./plugins/${pluginName}`);
}
