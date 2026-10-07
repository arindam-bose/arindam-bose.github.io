// ============================================================
// Ledger — the record everything else is derived from.
//
// A dialog opened from Settings rather than a panel in it: it is
// the one thing there that grows without limit, and a page that
// is mostly history buries the controls underneath it.
//
// Read-only.  The ledger is append-only by design — a mis-entry
// is corrected with another row, or undone from the toast at the
// moment you make it, not edited here afterwards.
// ============================================================

import * as queries from '../queries.js';
import * as store from '../store.js';
import { detailHead, esc, pager, PAGE } from '../render.js';
import { detailDialog } from '../dialog.js';

// Plainer words than the schema's, which are written for the CHECK
// constraint rather than for reading back.
const REASON_WORDS = {
  kill: 'hunted',
  loot: 'found',
  buy: 'bought',
  craft: 'crafted',
  move: 'moved',
  correction: 'corrected',
};

/**
 * The ledger dialog.  Returns { open, refresh, destroy }, like any
 * other detail dialog; the view that owns the link owns this too.
 */
export function ledgerDialog() {
  let shown = PAGE;

  const dialog = detailDialog({
    render,
    onClick(event) {
      const button = event.target.closest('[data-page]');
      if (!button) return;

      if (button.dataset.page === 'more') {
        shown += PAGE;
        dialog.refresh();
      } else {
        shown = PAGE;
        dialog.refresh();
        button.closest('dialog')?.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
  });

  function render() {
    const total = store.stats().entries;
    const rows = total ? queries.ledgerEntries(Math.min(shown, total)) : [];

    return `
      ${detailHead('Your data', 'Ledger')}

      ${total
        ? `<p class="note">Current stock is the sum of this. Newest first.</p>
           <div class="entries">${rows.map(entry).join('')}</div>
           ${pager(shown, total)}`
        : '<p class="empty">Nothing logged yet.</p>'}`;
  }

  return {
    // Always from the top: a long list left paged out is not where
    // you meant to start reading.
    open() {
      shown = PAGE;
      dialog.open('ledger');
    },
    refresh: dialog.refresh,
    destroy: dialog.destroy,
  };
}

function entry(e) {
  const sign = e.delta > 0 ? '+' : '-';

  return `
    <div class="entry">
      <span class="delta ${e.delta > 0 ? 'up' : 'down'}">${sign}${Math.abs(e.delta)}</span>
      <span class="entry-what">
        ${esc(e.material)}${e.unknown_material
          ? ' <span class="badge stale">unknown</span>' : ''}
        <small>${esc(e.place)} - ${esc(when(e.ts))}${
          e.recipe ? ` - for ${esc(e.recipe)}` : ''}</small>
      </span>
      <span class="reason">${esc(REASON_WORDS[e.reason] ?? e.reason)}</span>
    </div>`;
}

/**
 * SQLite writes `datetime('now')` in UTC with no zone marker, and a
 * browser reads a bare "YYYY-MM-DD HH:MM:SS" as local time.  Say so
 * explicitly, or every entry is off by your offset.
 */
function when(ts) {
  const at = new Date(`${String(ts).replace(' ', 'T')}Z`);
  if (Number.isNaN(at.getTime())) return String(ts);

  return at.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
