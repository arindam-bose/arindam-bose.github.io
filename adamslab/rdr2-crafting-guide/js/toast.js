// ============================================================
// The undo toast.
//
// Inventory entry has no save button — every tap is a ledger row
// the moment you make it.  This is what makes that safe: one tap
// to put it back.
// ============================================================

const DURATION = 6000;

let element = null;
let timer = null;

/**
 * Show a message, optionally with one action.
 *
 *   toast('Added 1 Perfect Beaver Pelt', { label: 'Undo', run: () => … })
 */
export function toast(message, action = null) {
  element ??= document.getElementById('toast');
  clearTimeout(timer);

  // A modal dialog sits in the top layer, above anything a z-index can
  // reach, and makes the rest of the page inert.  So while one is open
  // the toast lives inside it, or its Undo could be neither seen nor
  // pressed.
  const host = document.querySelector('dialog[open]') ?? document.body;
  if (element.parentElement !== host) host.append(element);

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  element.replaceChildren(text);

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      dismiss();
      action.run();
    });
    element.append(button);
  }

  // A way out that does not depend on waiting.
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close close-btn';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = 'x';
  close.addEventListener('click', dismiss);
  element.append(close);

  element.hidden = false;
  timer = setTimeout(dismiss, action?.duration ?? DURATION);
}

/** Whether a toast is up -- an Undo still on offer, say. */
export function showing() {
  return Boolean(element && !element.hidden);
}

// Back to the page when that dialog closes, still showing, so an Undo
// offered inside it stays in reach.  `close` does not bubble; capture
// sees it anyway.
document.addEventListener('close', (event) => {
  if (element && event.target.contains(element)) document.body.append(element);
}, true);

function dismiss() {
  clearTimeout(timer);
  if (element) element.hidden = true;
}
