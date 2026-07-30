import { describe, expect, test } from 'bun:test';
import { unlockedNetworkEntryPoints } from '../../src/guard/no-network';

/**
 * Importing the guard installs it, so by the time this file runs the poison is
 * already in place. That is the whole design (`main.ts` imports it first), and
 * it is what these tests exercise.
 *
 * WHY THESE EXIST. The guard was previously called "sound by construction" on
 * the grounds that it installs once at module evaluation and ES module ordering
 * serializes that. Both halves of the claim are true and neither addresses
 * DURABILITY: whether anything running afterwards can undo it. Measured, the
 * answer was yes — `http.default.request` was left `writable: true,
 * configurable: true`, and assigning over the stub restored a working function.
 * `globalThis.fetch` was locked; the module half was not.
 *
 * LIMIT OF THIS METHOD, stated rather than implied. These tests run in-process
 * and can only observe what this process can reach. They do not establish that
 * a dependency which captured a reference BEFORE the guard installed is
 * blocked — the guard's own header documents that named-import bindings are
 * unpoisonable per spec — nor that a native module bypasses JavaScript
 * entirely. Those are covered, if at all, by the other two layers: the bundle
 * static scan and the `unshare -rn` sandboxed run on Linux CI. A green file
 * here is not a claim about the process's total egress.
 */
async function callNetworkExport(specifier: string, key: string): Promise<'threw' | 'returned'> {
  const namespace = (await import(specifier)) as { default?: Record<string, unknown> };
  const target = namespace.default ?? (namespace as unknown as Record<string, unknown>);
  try {
    (target[key] as () => unknown)();
    return 'returned';
  } catch {
    return 'threw';
  }
}

describe('the no-network guard holds, and cannot be undone', () => {
  test('fetch throws', async () => {
    await expect(async () => (globalThis.fetch as unknown as () => Promise<unknown>)()).toThrow();
  });

  test('fetch cannot be redefined', () => {
    expect(() =>
      Object.defineProperty(globalThis, 'fetch', { value: () => 'restored', configurable: true }),
    ).toThrow();
  });

  test.each([
    ['node:http', 'request'],
    ['node:https', 'request'],
    ['node:net', 'connect'],
    ['node:tls', 'connect'],
    ['node:dgram', 'createSocket'],
    ['node:dns', 'lookup'],
  ])('%s.%s is poisoned even when imported after install', async (specifier, key) => {
    expect(await callNetworkExport(specifier, key)).toBe('threw');
  });

  test('a poisoned module export cannot be assigned over', async () => {
    // The regression this file was written for. Before the stubs were locked,
    // this assignment succeeded and the replacement was callable.
    const http = (await import('node:http')) as unknown as { default: Record<string, unknown> };

    expect(() => {
      http.default.request = () => 'restored';
    }).toThrow();
    expect(await callNetworkExport('node:http', 'request')).toBe('threw');
  });

  test('a poisoned module export cannot be redefined either', async () => {
    // Assignment and `defineProperty` are different doors; locking one is not
    // locking the other.
    const http = (await import('node:http')) as unknown as { default: Record<string, unknown> };

    expect(() =>
      Object.defineProperty(http.default, 'request', { value: () => 'restored', configurable: true }),
    ).toThrow();
  });

  test('every poisoned entry point was lockable', () => {
    // Non-vacuity for the two tests above: they check `http.request`
    // specifically. This asserts nothing ELSE fell back to an unlocked stub —
    // so a runtime that makes some export non-configurable produces a NAMED
    // failure here instead of a quietly weaker guard.
    expect(unlockedNetworkEntryPoints).toEqual([]);
  });

  test('the guard actually poisoned something', () => {
    // The floor. Every assertion above would pass against a guard that found
    // no function-valued exports at all and poisoned nothing.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

    expect(original?.writable).toBe(false);
    expect(original?.configurable).toBe(false);
  });
});
