// Set here rather than left to main.js, for the same reason the
// theme is set in the head: that module is deferred behind the
// wasm runtime, and until it runs a reader in General mode would
// watch the switch sit on Personalize -- and a screen reader
// would be told the wrong one outright.
//
// A file rather than inline so the page's Content-Security-Policy
// needs no hash for it.  Loaded right after the switch, so the
// switch is already in the document.
try {
  document.getElementById('mode-toggle').setAttribute('aria-checked',
    String(localStorage.getItem('rdr2:personal-mode') === 'personal'));
} catch (e) { /* private mode: the default is fine */ }
