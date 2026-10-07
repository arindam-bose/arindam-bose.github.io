// ============================================================
// The detail dialog a card opens.
//
// Materials, Recipes and the ledger all open one, and the
// plumbing is the same: a native modal <dialog>, a close button,
// Esc and a backdrop click to leave, and a body that repaints
// whenever the store changes underneath it.  What goes in the
// body, and what its buttons do, is the view's business.
//
//   const detail = detailDialog({
//     render: (id) => html | null,   // null: the thing is gone, close
//     onClick: (event, id) => {},    // anything but the close button
//     route: 'materials',            // this dialog is part of the address
//   });
//   detail.focus(id); detail.refresh(); detail.destroy();
//
// A dialog given a `route` is addressable: it opens whichever card
// the address names and takes that card back out of the address when
// it is shut, so the view hands `focus` straight to the router and
// has nothing else to say about it.  The ledger's dialog has no
// route -- there is no address for "the history, opened" -- and is
// driven by open() alone.
//
// The rendered body starts with detailHead() from render.js, which
// supplies the heading and the close button.  Any button that
// should keep focus across a repaint carries a data-key naming it.
// ============================================================

import * as nav from './nav.js';

export function detailDialog({ render, onClick = () => {}, route = null }) {
  // On <body>, not inside the view: the view is an aria-live region,
  // and every refresh of an open dialog would be read out again.
  const dialog = document.createElement('dialog');
  dialog.className = 'detail';
  dialog.setAttribute('aria-labelledby', 'detail-title');

  // Only the body is repainted: the undo toast moves into the dialog
  // while it is open, and must not be wiped along with the content.
  const body = document.createElement('div');
  body.className = 'detail-body';
  dialog.append(body);
  document.body.append(dialog);

  let current = null;
  let busy = false;

  // Set while the whole view is being torn down.  A dialog closing
  // because you left the page is not you dismissing it, and the two
  // have to be told apart: the address is already somewhere else by
  // then, and onClose would drag it back.
  let leaving = false;

  /** Repaint; false if there is nothing left to show, which closes it. */
  function paint() {
    const html = render(current);
    if (html == null) {
      if (dialog.open) dialog.close();
      return false;
    }

    // The button just pressed is replaced by the repaint, so put the
    // focus back on its successor rather than losing it to <body>.
    const focused = document.activeElement;
    const key = dialog.contains(focused) ? focused.dataset.key : null;

    body.innerHTML = html;

    if (key) {
      const again = body.querySelector(`[data-key="${CSS.escape(key)}"]`);
      (again && !again.disabled ? again : body.querySelector('[data-close]'))?.focus();
    }
    return true;
  }

  dialog.addEventListener('close', () => {
    current = null;
    body.innerHTML = '';
    if (!leaving && route) nav.closed(route);
  });

  dialog.addEventListener('click', async (event) => {
    // A click on the backdrop lands on the <dialog> itself: the body
    // inside it covers every pixel of the box.
    if (event.target === dialog || event.target.closest('[data-close]')) {
      dialog.close();
      return;
    }

    // Every action here is a write, and the body only repaints once it
    // has reached IndexedDB -- until then the old buttons are still
    // live.  One at a time, so a double-click cannot craft twice or
    // take a stock that has just reached zero below it.
    if (busy) return;
    busy = true;
    try { await onClick(event, current); }
    finally { busy = false; }
  });

  /** Show `id`; false if there is no such thing to show. */
  function openCard(id) {
    current = id;
    if (!paint()) { current = null; return false; }
    if (!dialog.open) dialog.showModal();
    body.querySelector('[data-close]')?.focus();
    return true;
  }

  return {
    open: openCard,

    /**
     * Show whichever card the address names, or none -- what the
     * router calls on every arrival.
     *
     * An id already on screen is left alone rather than repainted,
     * which would throw the focus back to the close button.  An id
     * nothing answers to -- a stale bookmark, something dropped from
     * the reference data -- leaves the page up and takes itself back
     * out of the address.
     */
    focus(id) {
      if (!id) { if (dialog.open) dialog.close(); }
      else if (id !== current && !openCard(id) && route) nav.closed(route);
    },

    /** Repaint if open -- called on every store change. */
    refresh() {
      if (dialog.open) paint();
    },

    destroy() {
      leaving = true;
      // `close` fires a task later, after the dialog is gone, so the
      // toast it would have sent home is rescued by hand first.
      const note = document.getElementById('toast');
      if (note && dialog.contains(note)) document.body.append(note);
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}

/**
 * Whether a click on a card should open it: always from its name,
 * and from anywhere else unless the click ended a text selection --
 * that is someone copying a name, not asking for more.
 *
 * A cross-link is the exception at the top: tapping the recipe named
 * on a material's card asks for that recipe, not for the card it was
 * printed on, and the href already says where to go.
 */
export function opensCard(event) {
  if (event.target.closest('a[href]')) return false;
  return Boolean(event.target.closest('[data-open]')) || !String(getSelection());
}
