// Deliberately never imported by anything else — one of Section 13
// criterion 7's "2 known orphans" (see src/dynamic-import-demo.ts for the
// other). Kept as a genuine zero-edge file against an otherwise-connected
// majority, so orphan detection has something real to discriminate.
export const THING = 'kitchen-sink sub thing';
