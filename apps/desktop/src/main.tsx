import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { useRepoStore } from '@/state/repoStore';

/**
 * Phase 11 E2E test bridge — ONLY present in the dedicated `bun run
 * build:e2e` build (`vite build --mode e2e`), never in `dev` or the real
 * packaged build Phase 14 ships (`vite build`, default `production` mode).
 * WebDriver/`tauri-driver` cannot automate the native OS folder-picker
 * dialog `pickFolder` opens (a well-known limitation shared by every
 * Electron/Tauri E2E setup), so `e2e/picker.spec.ts` drives `analyzePath`
 * directly instead — exercising the exact same `analyze_repo` → real
 * sidecar → real `AnalysisEnvelope` → rendered-UI path a real folder pick
 * would, minus clicking through the native dialog widget itself.
 */
if (import.meta.env.MODE === 'e2e') {
  Object.assign(window, { __onboardE2E: { useRepoStore } });
}

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
