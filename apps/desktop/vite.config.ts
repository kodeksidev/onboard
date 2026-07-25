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
});
