// ============================================================
// Backups.
//
// Everything personal lives in this browser and nowhere else, so
// a copy kept somewhere safe is the only thing that survives the
// site's data being cleared.  This is the one place that writes
// that copy, reads one back, and judges how overdue the next one
// is -- the masthead button and the Settings page both go
// through here, so they can never disagree about when you last
// saved.
//
// "Overdue" is counted in changes, not days: a month without a
// backup and without a single change risks nothing, while a day's
// heavy logging risks a day's work.  Time only matters once there
// is something unsaved for it to have been sitting on.
// ============================================================

import * as store from './store.js';
import * as prefs from './prefs.js';
import { plural } from './render.js';
import { toast, showing } from './toast.js';

const LAST_EXPORT = 'rdr2:last-export';

// A reminder is worth showing once per visit, not once per page load.
const REMINDED = 'rdr2:backup-reminded';

const DAY = 24 * 60 * 60 * 1000;

// When the masthead button starts wearing its dot ...
const DUE = { changes: 25, days: 7 };
// ... and when a visit opens with a word about it.
const OVERDUE = { changes: 100, days: 30 };

// ------------------------------------------------------------
// change notification
//
// A backup changes nothing in the store, so the store's own
// listeners never hear about one.  Anything showing the backup's
// state listens here as well.
// ------------------------------------------------------------

const listeners = new Set();

/**
 * Call `fn` after every backup taken.  A restore is a store change, so
 * the store's own listeners already hear about that one.  Returns an
 * unsubscribe.
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function saved() {
  prefs.set(LAST_EXPORT, new Date().toISOString());
  for (const fn of listeners) fn();
}

// ------------------------------------------------------------
// how overdue
// ------------------------------------------------------------

/** When the last copy was taken, as a Date, or null if never. */
export function lastSaved() {
  const last = prefs.get(LAST_EXPORT);
  return last ? new Date(last) : null;
}

/**
 * What is not in any backup yet, and how much that matters:
 * `level` is 'ok', 'due' or 'overdue'.
 */
export function status() {
  const { count, oldest } = store.changesSince(prefs.get(LAST_EXPORT));
  const age = oldest ? (Date.now() - oldest) / DAY : 0;
  const past = ({ changes, days }) => count >= changes || (count > 0 && age >= days);

  return {
    count,
    level: past(OVERDUE) ? 'overdue' : past(DUE) ? 'due' : 'ok',
  };
}

// ------------------------------------------------------------
// out and back in
// ------------------------------------------------------------

/**
 * "2026-10-05_18-36-09": when, to the second, on the reader's own clock
 * -- UTC would date an evening's backup tomorrow in the Americas.  The
 * time is hyphenated because Windows will not have a colon in a file
 * name, and to the second so two backups on one day sort, and never
 * overwrite, each other.
 */
function fileStamp(d) {
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
       + `_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
}

/** Save everything as a file named for the moment it was taken. */
export function download() {
  const name = `rdr2_inventory_${fileStamp(new Date())}.json`;
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Not revoked in the same tick: some browsers start the download a
  // moment after the click, and would find the file already gone.
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  saved();
  toast(`Saved ${name}`);
}

/**
 * The same text on the clipboard.  The download attribute is
 * unreliable on iOS, so there is always a way to get it out by hand.
 */
export async function copy() {
  try {
    await navigator.clipboard.writeText(store.exportJSON());
    saved();
    toast('Copied. Paste it somewhere safe.');
  } catch {
    toast('This browser would not let the page copy. Use Download.');
  }
}

/**
 * Replace everything with a backup's contents.  What is here now is
 * then exactly what that file holds, so it counts as backed up.
 *
 * Stamped first, and quietly: the import's own change notice already
 * repaints everything that shows the backup's state, so telling this
 * module's listeners as well would only paint it all twice.  A failed
 * import puts the old stamp back.
 */
export async function restore(text) {
  const before = prefs.get(LAST_EXPORT);
  prefs.set(LAST_EXPORT, new Date().toISOString());
  try {
    return await store.importJSON(text);
  } catch (err) {
    if (before === null) prefs.remove(LAST_EXPORT);
    else prefs.set(LAST_EXPORT, before);
    throw err;
  }
}

// ------------------------------------------------------------
// nudges
// ------------------------------------------------------------

/**
 * Open the visit with a word about an overdue backup -- once a visit,
 * and only in Personalize, where the data is.  Called once, shortly
 * after startup, and held back if a toast is already up then: a write
 * made in that first moment has an Undo showing, and this must not
 * take its place.
 */
export function remind() {
  if (!store.isPersonal() || showing()) return;

  const { count, level } = status();
  if (level !== 'overdue') return;

  try {
    if (sessionStorage.getItem(REMINDED)) return;
    sessionStorage.setItem(REMINDED, '1');
  } catch { /* no storage: remind every load rather than never */ }

  toast(`${plural(count, 'change')} ${count === 1 ? 'is' : 'are'} not in any backup yet.`,
        { label: 'Back up', run: download, duration: 12000 });
}

let asked = false;

/**
 * Ask the browser not to clear this site's data on its own.  Safari
 * otherwise does after seven days without a visit (unless the site is
 * on the home screen), and any browser may when space runs low.  Asked
 * once a page load, after the first write: Chrome and Safari decide
 * silently, and Firefox asks the reader once and remembers the answer.
 */
export async function keep() {
  if (asked || !navigator.storage?.persist) return;
  asked = true;
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* refused or unsupported: the backup reminder still covers it */ }
}

/** Whether the browser has agreed to keep the data: true, false, or null if it cannot say. */
export async function kept() {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}
