// ============================================================
// The tool's version -- the one place a release is numbered.
//
// A plain script rather than a module, so the service worker can
// load it too (importScripts) and name its cache after it: bumping
// `number` here is what renews everyone's offline copy, and the
// Settings page reads both fields for its "Tool version" line.
// Bump it, and set `date`, with every release.
// ============================================================

self.APP_VERSION = { number: 27, date: '2026-10-05' };
