// ============================================================
// Which of the two palettes is on.
//
// Parchment is the default and leather is the alternative, so
// the attribute is only ever read by one selector in app.css.
// The choice is a preference, not data: it lives in
// localStorage rather than the ledger, and is per device on
// purpose — the same person reads this on a bright phone
// outdoors and a dark screen at night.
//
// index.html sets the attribute inline, before app.css is
// applied, so a returning reader never sees the other theme
// flash first.  Everything here runs after that and only has
// to keep up.
// ============================================================

import * as prefs from './prefs.js';

const KEY = 'rdr2:theme';
const DEFAULT = 'parchment';

export const THEMES = [
  { id: 'parchment', label: 'Parchment' },
  { id: 'leather',   label: 'Leather' },
];

/** The stored choice, or the default if there isn't a usable one. */
export function current() {
  const stored = prefs.get(KEY);
  return THEMES.some((t) => t.id === stored) ? stored : DEFAULT;
}

/**
 * Paint in `name` and remember it.  The browser's own chrome —
 * the address bar, the scrollbars, a form control's default
 * colours — is told through `theme-color` and `color-scheme`
 * rather than left on the other theme's black.
 */
export function set(name) {
  const theme = THEMES.some((t) => t.id === name) ? name : DEFAULT;

  document.documentElement.dataset.theme = theme;
  prefs.set(KEY, theme);
  syncBrowserChrome();
}

/**
 * Read the theme's own --bg back out of the stylesheet rather
 * than keeping a second copy of it here, which would be one
 * more thing to remember when the palette moves.
 */
export function syncBrowserChrome() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;

  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg').trim();
  if (bg) meta.setAttribute('content', bg);
}

