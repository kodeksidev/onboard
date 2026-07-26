/**
 * @onboard/engine — the static half of `verify:no-network`, as a pure function
 * so it can be regression-tested against a real emitted bundle.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE
 *
 * The original scan only matched the DYNAMIC import form, `import("net")`,
 * because that is the shape `guard/no-network.ts` itself uses. A privacy audit
 * planted a live static import in the bundle:
 *
 *     import { connect } from 'node:net';
 *     export const probeSocket = connect(443, 'evil.example.com');
 *
 * and the gate reported PASS. Inspecting the emitted bundle confirmed the
 * import really was present as `from "net"` — the scan simply never looked for
 * that form. ESLint covers first-party code, but it never sees DEPENDENCY
 * code, and this scan is the only control that does, so the hole sat on the
 * one surface nothing else guarded.
 *
 * All three emitted forms are now matched. Keeping the logic here rather than
 * inline in the script is what lets `test/guard/scan-bundle.test.ts` build a
 * real bundle containing a real import and assert this reports a violation —
 * the previous arrangement could only be tested by trusting a PASS.
 */

/** Node built-ins that would constitute network egress from the engine. */
export const BARE_NETWORK_SPECIFIERS = ['net', 'http', 'https', 'tls', 'dgram', 'dns'] as const;

export type NetworkSpecifier = (typeof BARE_NETWORK_SPECIFIERS)[number];

export interface SpecifierFinding {
  readonly specifier: NetworkSpecifier;
  /** Human-readable description of the emitted form that matched. */
  readonly form: string;
  readonly count: number;
}

/**
 * Every way a bundler can emit a reference to a built-in module.
 *
 * `import("net")`   - dynamic import, the form the guard itself uses.
 * `from "net"`      - static ESM import; THIS is the form the audit proved was
 *                     being missed. Whitespace between `from` and the quote is
 *                     optional in minified output, hence `\s*`.
 * `require("net")`  - CJS interop, which Bun emits for dependencies that ship
 *                     CommonJS.
 */
function patternsFor(specifier: NetworkSpecifier): readonly { form: string; regex: RegExp }[] {
  const quoted = `["']${specifier}["']`;
  return [
    { form: `import(${specifier})`, regex: new RegExp(`import\\(\\s*${quoted}\\s*\\)`, 'g') },
    { form: `from ${specifier}`, regex: new RegExp(`from\\s*${quoted}`, 'g') },
    { form: `require(${specifier})`, regex: new RegExp(`require\\(\\s*${quoted}\\s*\\)`, 'g') },
  ];
}

/**
 * Finds every network-module reference in `text`. Callers are expected to pass
 * the bundle with the guard module's own body already excised — the guard
 * legitimately imports all six.
 */
export function findNetworkSpecifiers(text: string): readonly SpecifierFinding[] {
  const findings: SpecifierFinding[] = [];
  for (const specifier of BARE_NETWORK_SPECIFIERS) {
    for (const { form, regex } of patternsFor(specifier)) {
      const count = [...text.matchAll(regex)].length;
      if (count > 0) {
        findings.push({ specifier, form, count });
      }
    }
  }
  return findings;
}
