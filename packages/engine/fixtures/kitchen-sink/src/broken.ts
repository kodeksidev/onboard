// Deliberately unparseable (Section 11: kitchen-sink needs "an unparseable
// file"). tree-sitter is error-tolerant and will never throw on this — it
// produces a tree with ERROR nodes, which is exactly what
// test/parse/kitchen-sink.test.ts asserts surfaces as a PARSE_FAILED
// diagnostic instead of an unhandled exception.

export function broken( {
  const x = ;
  return
}

!!! this is not valid syntax in any language ???
