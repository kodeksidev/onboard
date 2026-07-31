import type { JSX } from 'react';
import type { AiProviderName } from '@/ipc/ipc';
import { MODE_INDICATOR } from '@/copy/messages';

export interface ModeIndicatorProps {
  readonly isEnabled: boolean;
  readonly provider: AiProviderName;
  readonly model: string;
  /**
   * Accepted so callers can pass the full `settings.ai` shape through, but
   * deliberately does not change the rendered string: A5/A6 require the
   * static-mode string to render whenever `isEnabled` is false, for every
   * value of `hasStoredKey` (a key stored with the master toggle off is
   * still "off" — AI never activates from a stored key alone).
   */
  readonly hasStoredKey: boolean;
}

/**
 * Inline SVG rather than an icon package. `lucide-react` was proposed, but it
 * is NOT a dependency of this app (nothing in `src` renders an icon or an SVG
 * today), so using it would mean adding a runtime dependency, a lockfile
 * change and a new audit surface to a release branch for two glyphs.
 *
 * `aria-hidden` and `focusable="false"` are load-bearing, not decoration: the
 * indicator's accessible name must stay exactly the frozen string, so the
 * glyph must be invisible to assistive technology. A screen reader announcing
 * "lock Static mode …" would break criterion 13's byte-exact reading.
 *
 * Paths are drawn here, not copied from an icon set, so there is no third
 * party licence or attribution attached to them.
 */
function ModeGlyph({ isEnabled }: { readonly isEnabled: boolean }): JSX.Element {
  const shared = {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false',
    className: 'shrink-0',
  };
  return isEnabled ? (
    // Cloud
    <svg {...shared} data-testid="mode-glyph-cloud">
      <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97 6 6 0 0 0-11.66-1.4A4 4 0 0 0 6.5 19Z" />
    </svg>
  ) : (
    // Padlock, shackle closed
    <svg {...shared} data-testid="mode-glyph-lock">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/**
 * The persistent privacy-mode indicator (A5, A6). The two rendered strings
 * are frozen verbatim and must never be composed from smaller pieces that
 * could drift — `MODE_INDICATOR` in `copy/messages.ts` is the single place
 * either string is assembled.
 *
 * The emoji that A6 froze into those strings was removed on 2026-07-31 by
 * product-owner decision; the glyph beside the text carries that signal now.
 * See `MODE_INDICATOR`'s comment and the AMENDMENT in docs/DECISIONS.md.
 */
export function ModeIndicator({ isEnabled, provider, model }: ModeIndicatorProps): JSX.Element {
  const text = isEnabled ? MODE_INDICATOR.ai(provider, model) : MODE_INDICATOR.static;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
    >
      <ModeGlyph isEnabled={isEnabled} />
      {text}
    </span>
  );
}
