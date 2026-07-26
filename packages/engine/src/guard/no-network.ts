/**
 * @onboard/engine — the runtime no-network guard (Section 9 Phase 5, Section 5,
 * Section 12's threat model: "no remote attacker because there is no server").
 *
 * This is the ONE file in `packages/engine` that references
 * `node:net`/`node:http`/`node:https`/`node:tls`/`node:dgram`/`node:dns` —
 * its entire purpose is to poison them, not use them. It does so via dynamic
 * `import()` rather than a static `import ... from`, which is deliberate:
 * `eslint.config.js`'s `no-restricted-imports` (repo-wide for
 * `packages/engine`) matches static import/export declarations, and this is
 * the one file that legitimately needs to name what it guards against
 * without asking for an exception to that rule (confirmed: this file lints
 * clean with zero `eslint-disable` comments anywhere in it).
 *
 * MUST be the first thing `main.ts` imports, before web-tree-sitter, the
 * cache, or anything else has a chance to capture a reference to `fetch` or
 * a network module's real exports — poisoning happens as an import-time
 * side effect, not behind a function the caller might forget to invoke.
 */

/** Thrown by every network entry point this guard poisons. */
export class EngineNetworkBlockedError extends Error {
  readonly code = 'E_NETWORK_BLOCKED' as const;

  constructor(api: string) {
    super(
      `${api} is disabled: packages/engine has no network capability by construction ` +
        '(Section 5, Section 12, A5 — static mode makes no network calls whatsoever).',
    );
    this.name = 'EngineNetworkBlockedError';
  }
}

function throwBlocked(api: string): never {
  throw new EngineNetworkBlockedError(api);
}

function poisonFetch(): void {
  Object.defineProperty(globalThis, 'fetch', {
    value: () => throwBlocked('fetch()'),
    writable: false,
    configurable: false,
    enumerable: true,
  });
}

/**
 * Replaces every function-valued export on a built-in module's mutable CJS
 * `.default` object with a throwing stub. ES module namespace objects
 * (`import * as net from 'node:net'`'s named bindings) are frozen per spec —
 * `net.connect = ...` throws "Attempted to assign to readonly property" even
 * from within the same realm — so there is no way to poison a NAMED import
 * binding after the fact; only the `.default` (CJS interop) object, which
 * Bun/Node share as a single mutable singleton across every import of the
 * same specifier, can be mutated post-hoc. This covers `import net from
 * 'node:net'` (the default-import style essentially all real code, including
 * this repo's own dependencies, actually uses) but not a hypothetical
 * `import { connect } from 'node:net'` named import — a genuine, spec-level
 * limitation, documented rather than silently accepted as "handled."
 */
function poisonModuleFunctions(moduleName: string, moduleExports: Record<string, unknown>): void {
  for (const key of Object.keys(moduleExports)) {
    if (typeof moduleExports[key] === 'function') {
      moduleExports[key] = () => throwBlocked(`${moduleName}.${key}()`);
    }
  }
}

function defaultExportOf(namespace: unknown): Record<string, unknown> {
  const withDefault = namespace as { default?: unknown };
  return (withDefault.default ?? namespace) as Record<string, unknown>;
}

/**
 * Imports every module BEFORE poisoning any of them. `node:https`'s own
 * source defines `class Agent extends http.Agent` at module-evaluation
 * time; poisoning `http`'s exports (which replaces every function-valued
 * export, `Agent` included, with a throwing stub) before `node:https` has
 * been loaded turns `http.Agent` into something with no `.prototype`,
 * crashing `https`'s own internal class declaration with "Base class must
 * have a prototype property." Loading all six modules first, then poisoning
 * every one of them only once every module's own top-level code has already
 * run, avoids this entirely.
 */
async function poisonNetworkModules(): Promise<void> {
  const [net, http, https, tls, dgram, dns] = await Promise.all([
    import('node:net'),
    import('node:http'),
    import('node:https'),
    import('node:tls'),
    import('node:dgram'),
    import('node:dns'),
  ]);
  poisonModuleFunctions('net', defaultExportOf(net));
  poisonModuleFunctions('http', defaultExportOf(http));
  poisonModuleFunctions('https', defaultExportOf(https));
  poisonModuleFunctions('tls', defaultExportOf(tls));
  poisonModuleFunctions('dgram', defaultExportOf(dgram));
  const dnsDefault = defaultExportOf(dns);
  poisonModuleFunctions('dns', dnsDefault);
  if (typeof dnsDefault.promises === 'object' && dnsDefault.promises !== null) {
    poisonModuleFunctions('dns.promises', dnsDefault.promises as Record<string, unknown>);
  }
}

let installPromise: Promise<void> | null = null;

/**
 * Installs the guard. Safe to call more than once (idempotent — later calls
 * reuse the first installation's promise). `main.ts` never calls this
 * directly; importing this module installs it immediately as a side effect.
 */
export function installNoNetworkGuard(): Promise<void> {
  poisonFetch();
  installPromise ??= poisonNetworkModules();
  return installPromise;
}

await installNoNetworkGuard();
