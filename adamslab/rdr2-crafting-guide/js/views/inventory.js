// ============================================================
// Inventory — entry, not reporting.
//
// Three locations with a stepper each is too much width on a
// phone, so the location is a segmented control under the search
// box and each row carries one stepper that writes to it.  You are
// almost always entering a batch for one place at a time,
// because you just walked out of the Trapper.
//
// Steppers stage, they do not write.  You enter the batch, look
// at it, and commit it — one SQLite transaction and one
// IndexedDB transaction however many rows, with undo at the
// level of the whole commit.  Staged edits outlive a tab switch
// (a dot appears on the Inventory tab) and are only lost if you
// discard them or close the page, which the browser warns about.
//
// A second kind of row control lives beside the stepper: a transfer,
// for handing loot from the Satchel to whichever of Pearson or
// Trapper actually wants it, and taking it back.  Where a stepper's
// delta is a gain from nowhere or a correction, a transfer is the
// same items leaving one location as they land in another, so it
// always writes two ledger rows -- one negative, one positive, both
// reason 'move' -- as one entry in the batch.  The Fence gets none of
// this: it spends straight from the Satchel, so there is nothing to
// hand it.
//
// The row carries only a "Transfer to" button for it, never a second -/+
// pair: two steppers side by side look alike, and a slip on the
// wrong one silently hands a pelt to a vendor.  The button opens a
// small panel that names the material, where it is moving from, and
// each place it can go, each with its own stepper -- every control in
// there says what it does.
// ============================================================

import * as backup from '../backup.js';
import * as queries from '../queries.js';
import * as store from '../store.js';
import { esc, empty, heldAt, nameWith, plural, qualityStars, icon } from '../render.js';
import * as toolbar from './toolbar.js';
import * as prefs from '../prefs.js';
import { toast } from '../toast.js';
import * as nav from '../nav.js';
import { freshCard, materialDialog } from './material-dialog.js';

const LOCATION_KEY = 'rdr2:location';
const OFFER_DISMISSED = 'rdr2:personalize-offer-dismissed';

// The icon that matches each location's id, for the segmented tabs
// and the Transfer button and panel alike.
const LOCATION_ICON = {
  'loc-satchel': 'satchel', 'loc-pearson': 'pearson', 'loc-trapper': 'trapper',
};

// A vendor location transfers only with the Satchel, never with each
// other, so "the other end" of a transfer is always one of these two
// from the Satchel, or always the Satchel from one of these two.
const VENDOR_LOCATIONS = ['loc-pearson', 'loc-trapper'];

// Staged, uncommitted edits and transfers, keyed so the two kinds
// never collide even when they touch the same material and location.
// Module-level, so leaving the screen does not throw them away.
const staged = new Map();
const editKey = (location, ingredient) => `edit\u0000${location}\u0000${ingredient}`;
const moveKey = (ingredient, from, to) => `move\u0000${ingredient}\u0000${from}\u0000${to}`;

/**
 * Every pending change at one location, net, by ingredient -- each
 * one's own staged edit, minus what is staged to leave from here,
 * plus what is staged to arrive here from the other end.  This is
 * what a row's count actually shows, whichever screen it is read
 * from.  Built once per render rather than rescanned per row: every
 * row on the screen asks the same question about the same fixed
 * location, so one pass over `staged` answers all of them.
 */
function pendingIndex(location) {
  const index = new Map();
  const add = (id, delta) => index.set(id, (index.get(id) ?? 0) + delta);

  for (const e of staged.values()) {
    if (e.kind === 'edit' && e.location_id === location) add(e.ingredient_id, e.delta);
    else if (e.kind === 'move' && e.from_location_id === location) add(e.ingredient_id, -e.delta);
    else if (e.kind === 'move' && e.to_location_id === location) add(e.ingredient_id, e.delta);
  }
  return index;
}

window.addEventListener('beforeunload', (event) => {
  if (staged.size) event.preventDefault();
});

export function mount(root) {
  const locations = queries.locations();
  const state = {
    location: prefs.get(LOCATION_KEY) ?? locations[0].id,
    search: '',
  };
  if (!locations.some((l) => l.id === state.location)) {
    state.location = locations[0].id;
  }

  // Which vendor(s) a material can be handed to, keyed by ingredient.
  // Reference data, fixed for the life of the page: read once, not on
  // every render.
  const wants = new Map();
  for (const w of queries.vendorWants()) {
    if (!wants.has(w.ingredient_id)) wants.set(w.ingredient_id, new Set());
    wants.get(w.ingredient_id).add(w.location_id);
  }

  // Rebuilt at the top of every update(), read by row() through
  // section(): every row on the same render asks pendingIndex() the
  // same question, so it is computed once rather than once each.
  let pendingIdx;

  const tabs = locations.map((l) => ({ id: l.id, title: l.name, icon: LOCATION_ICON[l.id] }));
  root.innerHTML = `
    <div class="toolbar">
      ${toolbar.searchBox('i-search', 'Search a material or animal…')}
    </div>
    ${toolbar.tabRow('i-locations', 'location', tabs,
                     { selected: state.location, counts: false })}
    <div id="i-sections"></div>
    <div class="move-pop" id="i-move" popover role="dialog"
         aria-labelledby="i-move-title"></div>
    <div class="savebar" id="i-savebar" hidden>
      <span class="pending-count" id="i-pending"></span>
      <button type="button" class="discard" id="i-discard">Discard</button>
      <button type="button" class="save" id="i-save">Save</button>
    </div>`;

  const segmented = root.querySelector('#i-locations');
  const searchBox = root.querySelector('#i-search');
  const sections = root.querySelector('#i-sections');
  const savebar = root.querySelector('#i-savebar');
  const pending = root.querySelector('#i-pending');
  const movePop = root.querySelector('#i-move');

  // A row's name opens the material's own card, here on Inventory --
  // what it goes into, who wants it -- the same dialog Materials
  // opens.  Under this page's address, so shutting it leaves you on
  // your batch rather than on another tab.
  //
  // Its counts include what is staged here but not yet saved, as the
  // rows do.  Its own steppers write straight away, so a "-" read off
  // the saved count alone could take a stock below zero once the
  // staged batch lands -- sending all three pelts to the Trapper, then
  // taking one more from the Satchel in here.
  const detail = materialDialog({
    route: 'inventory',
    find(id) {
      const card = freshCard(id);
      if (!card) return card;
      card.demands = card.demands.map((d) => ({
        ...d, have: d.have + (pendingIndex(d.location_id).get(id) ?? 0),
      }));
      return card;
    },
  });

  // The row whose Transfer panel is open, by what stageMove() needs, or
  // null.  The rows are rebuilt on every change, so the panel keeps
  // the material rather than the element and finds its row again.
  let moving = null;

  toolbar.wireTabs(segmented, 'location', state, () => {
    prefs.set(LOCATION_KEY, state.location);
    update();
  });

  searchBox.addEventListener('input', () => {
    state.search = searchBox.value.trim();
    update();
  });
  toolbar.wireClear(searchBox);

  // One listener for every stepper: the rows are replaced on each
  // change, so per-row listeners would not survive anyway.
  sections.addEventListener('click', (event) => {
    if (event.target.closest('#i-personalize')) {
      store.setPersonal(true);
      toast('Personalize is on -- every card now counts what you have.');
      return;
    }
    if (event.target.closest('#i-offer-dismiss')) {
      offerDismissed = true;
      prefs.set(OFFER_DISMISSED, new Date().toISOString());
      update();
      return;
    }

    const opener = event.target.closest('.move-btn');
    if (opener) {
      openMove(opener);
      return;
    }

    const button = event.target.closest('[data-delta]');
    if (!button) return;
    stage(button.closest('.row').dataset, Number(button.dataset.delta));
  });

  // The panel's own steppers, and its close button.
  movePop.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) {
      movePop.hidePopover();
      return;
    }
    const button = event.target.closest('[data-move]');
    if (button && moving) stageMove(moving, button.dataset.to, Number(button.dataset.move));
  });

  // A tap outside closes the panel before the click lands, so a tap on
  // the same Transfer button would only open it again -- and the browser
  // folds that close-and-reopen into one 'toggle', so it cannot be
  // seen afterwards.  Noting, as the finger goes down, whether the
  // panel was open for this row lets that tap close it instead.
  let closingFor = null;
  sections.addEventListener('pointerdown', (event) => {
    const opener = event.target.closest('.move-btn');
    const ingredient = opener?.closest('.row').dataset.ingredient;
    // Only the button whose panel is open: a tap on another row's
    // closes this panel on the way in, and should open its own.
    closingFor = opener && movePop.matches(':popover-open')
                 && moving?.ingredient === ingredient ? ingredient : null;
  }, true);

  movePop.addEventListener('toggle', (event) => {
    if (event.newState === 'open') return;
    const opener = moving && moveButtonFor(moving.ingredient);
    moving = null;
    for (const b of sections.querySelectorAll('.move-btn[aria-expanded="true"]')) {
      b.setAttribute('aria-expanded', 'false');
    }
    // Back where the reader was, unless they have already moved on.
    if (opener && (!document.activeElement || document.activeElement === document.body
                   || movePop.contains(document.activeElement))) {
      opener.focus();
    }
  });

  function openMove(opener) {
    const { ingredient, name, source } = opener.closest('.row').dataset;
    const wasOpen = closingFor === ingredient;
    closingFor = null;
    if (wasOpen) {
      if (movePop.matches(':popover-open')) movePop.hidePopover();
      return;
    }

    for (const b of sections.querySelectorAll('.move-btn[aria-expanded="true"]')) {
      b.setAttribute('aria-expanded', 'false');
    }
    moving = { ingredient, name, source };
    renderMove();
    movePop.showPopover();
    placeMove();
    opener.setAttribute('aria-expanded', 'true');
    movePop.querySelector('[data-move="1"]:not(:disabled)')?.focus();
  }

  function moveButtonFor(ingredient) {
    return sections.querySelector(`.row[data-ingredient="${CSS.escape(ingredient)}"] .move-btn`);
  }

  // Beside its button where there is room; on a phone the stylesheet
  // makes it a sheet along the bottom instead, and the inline
  // position would only fight that.
  const narrow = window.matchMedia('(max-width: 559px)');
  function placeMove() {
    const opener = moving && moveButtonFor(moving.ingredient);
    if (narrow.matches || !opener) {
      movePop.style.top = movePop.style.left = '';
      return;
    }
    const at = opener.getBoundingClientRect();
    const box = movePop.getBoundingClientRect();
    const gap = 6;
    const below = at.bottom + gap + box.height <= window.innerHeight - 8;
    const top = below ? at.bottom + gap : Math.max(8, at.top - gap - box.height);
    const left = Math.min(Math.max(8, at.right - box.width), window.innerWidth - box.width - 8);
    movePop.style.top = `${top}px`;
    movePop.style.left = `${left}px`;
  }
  function onResize() {
    if (movePop.matches(':popover-open')) placeMove();
  }
  window.addEventListener('resize', onResize);
  // Pinned to the screen, it would drift off its row as the page
  // scrolls, so it follows its button -- and closes once the button
  // has gone off screen, rather than hanging over unrelated rows.
  // Not closed on any scroll: a trackpad still coasting from the last
  // swipe would shut it the moment it opened.
  let following = false;
  function onScroll() {
    if (narrow.matches || following || !movePop.matches(':popover-open')) return;
    following = true;
    requestAnimationFrame(() => {
      following = false;
      if (!moving || !movePop.matches(':popover-open')) return;
      const at = moveButtonFor(moving.ingredient)?.getBoundingClientRect();
      if (!at || at.bottom < 0 || at.top > window.innerHeight) movePop.hidePopover();
      else placeMove();
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  function renderMove() {
    const rowEl = moveButtonFor(moving.ingredient)?.closest('.row');
    if (!rowEl) {
      movePop.hidePopover();
      return;
    }
    const from = state.location;
    const available = Number(rowEl.dataset.qty) + (pendingIdx.get(moving.ingredient) ?? 0);
    const targets = moveTargets(moving.ingredient, from, wants);

    // The repaint replaces the button just pressed, so note which it
    // was and hand the focus to its successor -- or, once that one is
    // disabled (nothing left to send), to the close button -- rather
    // than dropping it to the page, as the detail dialog does.
    const pressed = movePop.contains(document.activeElement) ? document.activeElement : null;
    const again = pressed?.dataset.move
      ? `[data-move="${pressed.dataset.move}"][data-to="${pressed.dataset.to}"]` : null;

    movePop.innerHTML = `
      <div class="move-head">
        <div>
          <p class="move-kicker">Transfer from ${esc(LOCATION_LABEL[from])}
            <span class="move-left">${available} ${
              targets.some((to) => staged.has(moveKey(moving.ingredient, from, to)))
                ? 'left' : 'here'}</span></p>
          <h3 id="i-move-title">${rowEl.dataset.title}</h3>
        </div>
        <button type="button" class="detail-close" data-close
                aria-label="Close">×</button>
      </div>
      <ul class="move-dests">
        ${targets.map((to) => moveDest(moving, from, to, available)).join('')}
      </ul>
      <p class="move-note">Hands over what you already hold -- nothing new
        is logged.  Saved with the rest of your changes.</p>`;

    if (pressed) {
      const next = again && movePop.querySelector(again);
      (next && !next.disabled ? next : movePop.querySelector('[data-close]'))?.focus();
    }
  }

  // The restore offer's file input is rebuilt with the sections, so it
  // is listened for here, the same way the steppers are.  There is
  // nothing on the device to lose -- the offer only shows with nothing
  // logged and nothing staged -- so there is no confirming step: a file
  // that reads cleanly is loaded, and one that does not says why.
  sections.addEventListener('change', async (event) => {
    if (event.target.id !== 'i-restore') return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const text = await file.text();
    const found = store.inspectImport(text);
    if (found.fatal) {
      toast(found.fatal);
      return;
    }
    try {
      await backup.restore(text);
    } catch (err) {
      console.error(err);
      toast(`That backup could not be loaded: ${err?.message ?? err}`);
      return;
    }
    toast(`Restored ${found.ledger} ${found.ledger === 1 ? 'entry' : 'entries'}.`
      + (found.problems.length ? ` Note: ${found.problems.join('; ')}.` : ''));
  });

  root.querySelector('#i-discard').addEventListener('click', discard);
  root.querySelector('#i-save').addEventListener('click', save);

  // The row carries what the ledger needs, so a tap costs no query.
  function stage({ ingredient, name, source }, delta) {
    const k = editKey(state.location, ingredient);
    const entry = staged.get(k)
      ?? { kind: 'edit', ingredient_id: ingredient, location_id: state.location,
           name, source_type: source, delta: 0 };

    entry.delta += delta;
    if (entry.delta === 0) staged.delete(k);
    else staged.set(k, entry);

    update();
  }

  // A tap always moves one unit between the Satchel and whichever
  // vendor `to` names, in the direction the screen you are on implies:
  // `state.location` is always the other end.  Sending one first
  // cancels against a transfer already staged the other way for the
  // same material, rather than piling up beside it -- three out and
  // one back, before either is saved, is one decision to send two,
  // not two ledger entries that would each write and half-undo the
  // other.  Capped at zero rather than going negative, since there is
  // no such thing as sending fewer than none.
  function stageMove({ ingredient, name, source }, to, delta) {
    const from = state.location;

    if (delta > 0) {
      const oppositeKey = moveKey(ingredient, to, from);
      const opposite = staged.get(oppositeKey);
      if (opposite) {
        const cancel = Math.min(opposite.delta, delta);
        opposite.delta -= cancel;
        delta -= cancel;
        if (opposite.delta === 0) staged.delete(oppositeKey);
        else staged.set(oppositeKey, opposite);
      }
    }

    if (delta !== 0) {
      const k = moveKey(ingredient, from, to);
      const entry = staged.get(k)
        ?? { kind: 'move', ingredient_id: ingredient, name, source_type: source,
             from_location_id: from, to_location_id: to, delta: 0 };

      entry.delta = Math.max(0, entry.delta + delta);
      if (entry.delta === 0) staged.delete(k);
      else staged.set(k, entry);
    }

    update();
  }

  function discard() {
    staged.clear();
    update();
  }

  async function save() {
    const entries = [...staged.values()];
    staged.clear();
    update();

    // A transfer is the same items leaving one place as they land in
    // another, so it is always two ledger rows, not one -- both
    // 'move', signed opposite -- written together with everything
    // else in the batch.
    const toWrite = entries.flatMap((e) => e.kind === 'move' ? [
      { ingredient_id: e.ingredient_id, location_id: e.from_location_id,
        delta: -e.delta, reason: 'move' },
      { ingredient_id: e.ingredient_id, location_id: e.to_location_id,
        delta: e.delta, reason: 'move' },
    ] : [{
      ingredient_id: e.ingredient_id, location_id: e.location_id,
      delta: e.delta, reason: store.reasonFor(e.source_type, e.delta),
    }]);

    const written = await store.recordBatch(toWrite);

    const ids = written.map((r) => r.id);
    toast(`Saved ${plural(entries.length, 'change')}`,
          { label: 'Undo', run: () => store.undoBatch(ids) });
  }

  function update() {
    const searching = state.search.length > 0;
    const place = locations.find((l) => l.id === state.location).name;
    const at = heldAt(state.location, place);
    pendingIdx = pendingIndex(state.location);

    if (searching) {
      const hits = queries.searchMaterials(state.search, state.location);
      // The title is already the count here.  Capitalised by hand
      // rather than through `plural`: every other count on the page
      // reads inline ("6 recipes"), but this one stands alone as a
      // heading, in the same sentence case as the rest of the page.
      sections.innerHTML = section(
        `${hits.length} ${hits.length === 1 ? 'Match' : 'Matches'}`,
        hits, 'No material or animal by that name.', false);
    } else {
      // What you are holding here first, then the quick way back to
      // whatever you were logging lately.
      sections.innerHTML = (store.isEmpty() && !staged.size ? restoreOffer() : '')
        + (offering() ? personalizeOffer() : '')
        + section(at, held(state.location), `Nothing ${lower(at)} yet.`)
        + section('Recently Touched', recent(state.location), '');
    }

    if (moving) renderMove();

    detail.refresh();

    savebar.hidden = staged.size === 0;
    pending.textContent = `${plural(staged.size, 'unsaved change')}`;

    // Say so on the tab too, since the bar goes with the screen.
    const tab = document.querySelector('.tabs [data-route="inventory"]');
    if (tab) {
      if (staged.size) tab.dataset.pending = staged.size;
      else delete tab.dataset.pending;
    }
  }

  // Held here as well as stored, so "Not now" still holds for the rest
  // of the visit in a browser that will not keep the preference.
  let offerDismissed = false;

  /**
   * Whether to suggest Personalize: in General, once there is
   * something logged for it to show -- the moment its value is
   * plain, rather than a switch to find before there is any reason
   * to.  Until "Not now", or until it is turned on.
   */
  function offering() {
    return !store.isPersonal() && !store.isEmpty()
      && !offerDismissed && prefs.get(OFFER_DISMISSED) === null;
  }

  function section(title, list, emptyText, counted = true) {
    if (!list.length && !emptyText) return '';
    return `
      <section class="stock-section">
        <div class="section-head">
          <p class="list-label">${esc(title)}</p>
          ${counted ? `<span class="count">${plural(list.length, 'item')}</span>` : ''}
        </div>
        ${list.length
          ? `<div class="rows">${list
               .map((m) => row(m, state.location, wants, pendingIdx))
               .join('')}</div>`
          : empty(emptyText)}
      </section>`;
  }

  update();
  // On the window, so they outlive the page unless taken off: each would
  // keep this whole screen alive, and run on every scroll, after it.
  function destroy() {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll);
    detail.destroy();
  }

  return { update, focus: detail.focus, destroy };
}

/**
 * Shown only while nothing at all is logged here: the one moment a
 * backup file is what someone needs most -- a new device, or a browser
 * whose data was cleared -- so the way back in is on the page they land
 * on, not three tabs away.
 */
function restoreOffer() {
  return `
    <section class="restore-offer">
      <p class="note"><strong>Starting fresh on this device?</strong> If you
        have a backup file from before, load it and pick up where you left off.</p>
      <label class="ghost-btn file-btn">Restore from a backup
        <input type="file" id="i-restore" accept=".json,application/json" hidden>
      </label>
    </section>`;
}

/**
 * The invitation into Personalize, for someone logging in General:
 * what they have just entered is kept, but nothing else on the site
 * shows it until the switch is on.
 */
function personalizeOffer() {
  return `
    <section class="restore-offer personalize-offer">
      <p class="note"><strong>Make the guide yours.</strong> Turn on
        Personalize and every card counts what you have logged: what is
        ready to craft, and what is still left to hunt.</p>
      <div class="panel-actions">
        <button type="button" class="more-btn" id="i-personalize">Turn on Personalize</button>
        <button type="button" class="ghost-btn" id="i-offer-dismiss">Not now</button>
      </div>
    </section>`;
}

const lower = (text) => text[0].toLowerCase() + text.slice(1);

/**
 * What you are holding here, plus anything staged for it — a
 * material you just added has no stock yet, but it is about to,
 * so it belongs in this list rather than vanishing from view.
 */
function held(location) {
  const stock = queries.stockAt(location);
  const seen = new Set(stock.map((m) => m.ingredient_id));

  const incoming = [];
  for (const e of staged.values()) {
    const arrives = e.kind === 'edit' ? e.location_id === location
                                       : e.to_location_id === location;
    if (!arrives || seen.has(e.ingredient_id)) continue;
    seen.add(e.ingredient_id);
    incoming.push(asRow(e));
  }

  return [...stock, ...incoming]
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Touched lately but not currently held — the quick way back. */
function recent(location) {
  const holding = new Set(held(location).map((m) => m.ingredient_id));
  return queries.recentMaterials(location)
    .filter((m) => !holding.has(m.ingredient_id));
}

function asRow(e) {
  return {
    ingredient_id: e.ingredient_id,
    name: e.name,
    source_type: e.source_type,
    quality: null,
    qty: 0,
    gathered: 0,
    received: 0,
    used_crafting: 0,
  };
}

/**
 * What has passed through your hands here.  Only worth saying once
 * there is a history to report — on a row you have never touched it
 * would be three zeroes and no information.  Gathered and received
 * are kept apart: a transfer did not come from a kill, a purchase or
 * the wild, and folding it into "gathered" would credit a vendor with
 * loot that only ever came from the Satchel.
 */
function history(m) {
  if (!m.gathered && !m.received) return '';

  const parts = [];
  if (m.gathered) parts.push(`${m.gathered} gathered`);
  if (m.received) parts.push(`${m.received} received`);
  if (m.used_crafting) parts.push(`${m.used_crafting} crafted`);
  return `<small class="history">${parts.join(' - ')}</small>`;
}

function row(m, location, wants, pendingIdx) {
  const shown = m.qty + (pendingIdx.get(m.ingredient_id) ?? 0);
  const net = shown - m.qty;

  const mark = net
    ? `<small>${net > 0 ? '+' : '-'}${Math.abs(net)}</small>`
    : '';

  return `
    <div class="row${net ? ' staged' : ''}" data-ingredient="${esc(m.ingredient_id)}"
         data-name="${esc(m.name)}" data-source="${esc(m.source_type)}"
         data-qty="${m.qty}"
         data-title="${esc(nameWith(m.name, qualityStars(m.quality)))}">
      <span class="name"><a class="xlink" href="${esc(nav.href('inventory', m.ingredient_id))}"
        >${nameWith(m.name, qualityStars(m.quality))}</a>${history(m)}</span>
      <span class="controls">
        ${moveButton(m, location, wants, shown)}
        <span class="stepper">
          <button type="button" data-delta="-1" ${shown <= 0 ? 'disabled' : ''}
                  aria-label="One fewer ${esc(m.name)}">-</button>
          <output class="${shown > 0 ? 'held' : ''}${net ? ' pending' : ''}"
            >${shown}${mark}</output>
          <button type="button" data-delta="1"
                  aria-label="One more ${esc(m.name)}">+</button>
        </span>
      </span>
    </div>`;
}

/**
 * A word for each end of a transfer, matching how the rest of the app
 * names a location -- "the Satchel", but "Pearson" and "Trapper" bare.
 */
const LOCATION_LABEL = {
  'loc-satchel': 'the Satchel', 'loc-pearson': 'Pearson', 'loc-trapper': 'Trapper',
};

/**
 * Where one material can be moved from `location`: on the Satchel,
 * each vendor that wants it -- there can be two, since Pearson and
 * Trapper both want plenty of the same pelts; on a vendor, the single
 * way back to the Satchel.  None at all for a material no vendor here
 * cares about -- a plant on the Trapper's screen, say.
 */
function moveTargets(ingredient, location, wants) {
  return VENDOR_LOCATIONS.includes(location)
    ? (wants.get(ingredient)?.has(location) ? ['loc-satchel'] : [])
    : VENDOR_LOCATIONS.filter((to) => wants.get(ingredient)?.has(to));
}

/**
 * The row's one way into a transfer: a word, and the icon of each
 * place it can go, so it says what it does before it is tapped.  An
 * outlined pill where the stepper is filled squares, so the two are
 * told apart by shape before anyone reads them.  Once something is
 * staged to move, it says how many.  Absent while there is nothing
 * here to move and nothing on its way out -- a button that could
 * only open onto disabled steppers is clutter.
 */
function moveButton(m, location, wants, available) {
  const targets = moveTargets(m.ingredient_id, location, wants);
  if (!targets.length) return '';

  const count = targets.reduce((sum, to) =>
    sum + (staged.get(moveKey(m.ingredient_id, location, to))?.delta ?? 0), 0);
  if (available <= 0 && !count) return '';
  const names = targets.map((to) => LOCATION_LABEL[to]).join(' or ');

  return `
    <button type="button" class="move-btn${count ? ' staged' : ''}"
            aria-haspopup="dialog" aria-expanded="false"
            aria-label="Transfer ${esc(m.name)} to ${esc(names)}${
              count ? ` (${count} staged)` : ''}">
      <span class="move-word">Transfer to</span>
      <span class="move-to">${targets.map((to) => icon(LOCATION_ICON[to])).join('')}</span>
      ${count ? `<span class="move-count">${count}</span>` : ''}
    </button>`;
}

/**
 * One destination in the Transfer panel: its icon and name, then a
 * stepper for how many go there.  Its "+" stops offering once there
 * is nothing left here to send -- shared across every destination,
 * since they all draw down the same stock.
 */
function moveDest(m, from, to, available) {
  const count = staged.get(moveKey(m.ingredient, from, to))?.delta ?? 0;
  const label = LOCATION_LABEL[to];
  const place = label.replace(/^the /, '');

  return `
    <li class="move-dest${count ? ' staged' : ''}">
      <span class="move-place">${icon(LOCATION_ICON[to])}<span>To ${esc(label)}</span></span>
      <span class="stepper">
        <button type="button" data-move="-1" data-to="${esc(to)}"
                ${count <= 0 ? 'disabled' : ''}
                aria-label="One fewer to ${esc(place)}">-</button>
        <output class="${count > 0 ? 'pending' : ''}"
                aria-label="${count} to ${esc(place)}">${count}</output>
        <button type="button" data-move="1" data-to="${esc(to)}"
                ${available > 0 ? '' : 'disabled'}
                aria-label="One more to ${esc(place)}">+</button>
      </span>
    </li>`;
}
