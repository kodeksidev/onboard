/**
 * @onboard/engine — resolves the `onboard-engine-*` filename for the host
 * running this script (Tauri's `<name>-<target-triple>[.exe]` convention).
 * Shared by `build-sidecar.ts`'s post-build smoke test and `test-rpc.ts`'s
 * gate so both name the exact same file one way.
 */
export function binaryNameForHost(): string {
  if (process.platform === 'win32') {
    return 'onboard-engine-x86_64-pc-windows-msvc.exe';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'onboard-engine-aarch64-apple-darwin' : 'onboard-engine-x86_64-apple-darwin';
  }
  return 'onboard-engine-x86_64-unknown-linux-gnu';
}
