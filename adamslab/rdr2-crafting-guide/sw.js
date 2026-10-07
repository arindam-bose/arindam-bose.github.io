// ============================================================
// Offline cache.
//
// Two strategies, because the files divide cleanly in two:
//
//   The wasm runtime (650 KB), the database (210 KB), the fonts
//   and the artwork are immutable — replacing any of them is a
//   new release in js/version.js, and so a new CACHE — so they
//   are served from the cache and only fetched once.
//
//   Everything else is app code, served network-first and
//   falling back to the cache when there is no signal.  That
//   costs a conditional request on a warm start and buys you
//   edits showing up without a cache bump, which matters far
//   more while this is still being written.
// ============================================================

// Named after the release in js/version.js, so bumping the version
// there is what renews the cache.
importScripts('js/version.js');
const CACHE = `rdr2-crafting-v${self.APP_VERSION.number}`;

// Fetched once and kept: big, and only ever replaced wholesale.
// The fonts and the artwork join the runtime and the database here —
// a typeface and a logo change about as often, and a conditional
// request for each of them on every warm start buys nothing.
const IMMUTABLE = [
  'vendor/sql-wasm.js',
  'vendor/sql-wasm.wasm',
  'data/rdr2.db',
  'fonts/marston/Marston.otf',
  'fonts/fb_remington/FBRemington-Regular.ttf',
  'fonts/rdr2_lino_regular/RDR Lino Regular.ttf',
  'images/logo.png',
  'images/logo-128.png',
  'images/favicon-32.png',
  'images/icon-192.png',
  'images/apple-touch-icon.png',
  'images/pixel-cowboy-campfire-at-dusk-960.jpg',
  'images/pixel-cowboy-campfire-at-dusk-1920.jpg',
];

const SHELL = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'database/personal_schema.sql',
  'js/version.js',
  'js/mode-toggle-early.js',
  'js/file-protocol.js',
  'js/main.js',
  'js/backup.js',
  'js/db.js',
  'js/store.js',
  'js/queries.js',
  'js/render.js',
  'js/dialog.js',
  'js/nav.js',
  'js/toast.js',
  'js/theme.js',
  'js/prefs.js',
  'js/views/materials.js',
  'js/views/material-dialog.js',
  'js/views/inventory.js',
  'js/views/recipes.js',
  'js/views/settings.js',
  'js/views/ledger.js',
  'js/views/guide.js',
  'js/views/toolbar.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...IMMUTABLE, ...SHELL]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // Only this tool's own old releases.  Every tool served from
    // arindam-bose.github.io shares one origin, and so one cache
    // storage: clearing everything that is not CACHE would throw away
    // the other tools' offline copies each time this one updated.
    await Promise.all(names
      .filter((n) => n.startsWith('rdr2-crafting-v') && n !== CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();

    for (const client of await self.clients.matchAll()) {
      client.postMessage({ type: 'offline-ready' });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The search pages -- one per material and recipe, written by
  // scripts/build_pages.py -- are for whoever arrives from a search,
  // not the app, so they are fetched fresh and never kept: the offline
  // cache stays the size of the app.  Offline, a reader is sent to the
  // same card in the app instead, which works without a signal.
  const page = request.mode === 'navigate' && searchPage(url);
  if (page) {
    event.respondWith(fetch(request).catch(() => Response.redirect(page, 302)));
    return;
  }

  // Decoded, since a request spells a space as %20 and the list above
  // spells it as a space: RDR Lino's file name has two.
  const path = decodeURIComponent(url.pathname).replace(/^\//, '');
  const immutable = IMMUTABLE.some((file) => path.endsWith(file));

  event.respondWith(immutable ? cacheFirst(request) : networkFirst(request));
});

/**
 * Where in the app a search page's address points, or null if it is not
 * one: materials/perfect-beaver-pelt/ is #/materials/ing-perfect-beaver-pelt,
 * and the A-Z lists, materials/ and recipes/, are the tabs themselves.
 * The slug is the id without its prefix, which is what lets this work
 * without a list of them.
 */
function searchPage(url) {
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return null;

  const rest = url.pathname.slice(scope.pathname.length);
  const match = rest.match(/^(materials|recipes)\/(?:([a-z0-9-]+)\/)?(?:index\.html)?$/);
  if (!match) return null;

  const [, route, slug] = match;
  const prefix = route === 'materials' ? 'ing-' : 'recipe-';
  return new URL(`./#/${route}${slug ? `/${prefix}${slug}` : ''}`, scope).href;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch (err) {
    // Offline.  A navigation can always fall back to the shell,
    // since routing happens in the hash.
    const cached = await caches.match(request)
      ?? (request.mode === 'navigate' ? await caches.match('index.html') : null);
    if (cached) return cached;
    throw err;
  }
}
