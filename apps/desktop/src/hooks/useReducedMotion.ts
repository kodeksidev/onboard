import { useSyncExternalStore } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const mediaQueryList = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQueryList.addEventListener('change', onChange);
  return () => mediaQueryList.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * A17 / criterion 21: "With prefers-reduced-motion: reduce, no Cytoscape
 * animation and no CSS transition runs." CSS transitions are disabled
 * globally in `index.css`; this hook is the JS-side equivalent for
 * Cytoscape's `animate` option (Phase 8) and any other imperative motion.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
