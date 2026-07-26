/**
 * Fixture run as its own `bun` subprocess by `test/guard/no-network.test.ts` —
 * poisoning `fetch`/`net`/`http`/`dns` must never happen inside the shared
 * `bun test` process itself (it would break every other test file that
 * legitimately needs a working `fetch`/network stack in its own tooling).
 *
 * Uses each module's `.default` (the style `import net from 'node:net'`
 * resolves to) since that is the one the guard can actually poison — see
 * `src/guard/no-network.ts`'s `poisonModuleFunctions` doc comment.
 */
import { EngineNetworkBlockedError } from '../../../src/guard/no-network';

async function tryOp(label: string, op: () => unknown): Promise<void> {
  try {
    await op();
    console.log(`FAIL:${label}:no-throw`);
  } catch (error) {
    console.log(error instanceof EngineNetworkBlockedError ? `PASS:${label}` : `FAIL:${label}:wrong-error:${String(error)}`);
  }
}

// eslint-disable-next-line no-restricted-globals -- verifying the guard blocks fetch requires calling it
await tryOp('fetch', () => fetch('http://example.com'));

const net = (await import('node:net')).default;
await tryOp('net.connect', () => net.connect({ port: 80, host: 'example.com' }));

const http = (await import('node:http')).default;
await tryOp('http.get', () => http.get('http://example.com'));

const https = (await import('node:https')).default;
await tryOp('https.get', () => https.get('https://example.com'));

const tls = (await import('node:tls')).default;
await tryOp('tls.connect', () => tls.connect({ port: 443, host: 'example.com' }));

const dgram = (await import('node:dgram')).default;
await tryOp('dgram.createSocket', () => dgram.createSocket('udp4'));

const dns = (await import('node:dns')).default;
await tryOp('dns.lookup', () => dns.lookup('example.com', () => {}));
