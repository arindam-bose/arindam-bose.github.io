// ============================================================
// Small per-device preferences.
//
// Which theme, which inventory location, when you last exported:
// choices, not data.  They live in localStorage rather than the
// ledger, and they are never worth an exception.
//
// Reading localStorage throws outright in a browser with site
// data blocked, and in Safari's private mode it has historically
// thrown on write.  isPersonal() is called on every render of
// every screen, so an unguarded read there does not degrade the
// app, it stops it.  Everything goes through here instead.
// ============================================================

/** The stored string, or `fallback` if there isn't one we can read. */
export function get(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Forget `key`. */
export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch { /* nothing stored to forget */ }
}

/** Store `value`.  Losing a preference is not worth failing a write for. */
export function set(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch { /* no storage: the session keeps it, the next one starts fresh */ }
}
