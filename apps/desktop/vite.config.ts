import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Onboard desktop webview (Section 4, Section 14). Tauri's reference frontend
 * pairing: React 19 + Vite 7. The dev server never proxies to a remote origin
 * (Section 12) — the only "backend" it talks to in development is the mock
 * IPC layer (`VITE_IPC=mock`, Section 9 Phase 7) or the real Tauri IPC once
 * Phase 11 wires the sidecar.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  css: {
    // Tailwind 4's styling is handled entirely by the `tailwindcss()` Vite
    // plugin above (CSS-first, no postcss.config.* — see docs/DECISIONS.md,
    // Phase 7). Without this, Vite's own CSS pipeline still auto-searches
    // upward from cwd for a postcss config on every build, which walks as
    // far as the workspace root `package.json`; that file carries a
    // pre-existing UTF-8 BOM (present since Phase 0, unrelated to Phase 11)
    // that Node's strict `JSON.parse` rejects, failing the build outright.
    // Supplying an explicit (empty) postcss config here skips that
    // filesystem search entirely — a Phase 11 workaround, not a fix for the
    // BOM itself, which is out of this app's scope (root `package.json`).
    postcss: { plugins: [] },
  },
});
