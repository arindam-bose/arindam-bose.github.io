// ============================================================
// Settings — where your data lives, and how to move it.
//
// The whole personal layer is a browser's worth of rows in
// IndexedDB: private, and gone if you clear site data.  Export
// is therefore not a nicety, it is the backup -- taken here or
// from the masthead's Back up button, both through backup.js.
//
// Import replaces rather than merges.  A ledger id counts up per
// device, so two devices' rows cannot be told apart; merging them
// would double anything imported twice.  One device is the source
// of truth and the other receives.
// ============================================================

import * as store from '../store.js';
import * as theme from '../theme.js';
import { esc, plural, icon, stationIcon, stationColour, money } from '../render.js';
import * as backup from '../backup.js';
import { toast } from '../toast.js';
import { ledgerDialog } from './ledger.js';
import { aboutDialog, howToDialog } from './guide.js';

// The sources the reference data was built from, credited in the order
// they were leaned on.  `source` is the site or the author; `title` is
// what the page calls itself.
const REFERENCES = [
  { source: 'IGN',
    title: 'Red Dead Redemption 2 Guide',
    url: 'https://www.ign.com/wikis/red-dead-redemption-2' },
  { source: 'RDR2 Map',
    title: 'Interactive Map of Red Dead Redemption 2 Locations',
    url: 'https://rdr2map.com/' },
  { source: 'Contributors to Red Dead Wiki',
    title: 'Red Dead Redemption 2 | Red Dead Wiki | Fandom',
    url: 'https://reddead.fandom.com/wiki/Red_Dead_Redemption_2' },
  { source: 'RankedBoost',
    title: 'Red Dead Redemption 2 Wiki Guides and Walkthroughs | Database',
    url: 'https://rankedboost.com/red-dead-redemption-2/wiki-guides/' },
  { source: 'RDR2.org',
    title: 'Red Dead Redemption 2 Wiki',
    url: 'https://www.rdr2.org/wiki/' },
  { source: 'u/JimmyJames86',
    title: 'RDR2 Hunting and Crafting Guide (story mode)',
    url: 'https://www.reddit.com/r/reddeadredemption/comments/kunnbu/rdr2_hunting_and_crafting_guide_story_mode/' },
];

// The three faces the page sets type in, each named in its own face
// (`face` picks the class), with where it came from and the licence
// it is used under.  Hand-built HTML rather than another `url`/`title`
// pair like REFERENCES above: a licence line reads as a phrase with a
// couple of links in it, not a single link with a caption.
const FONT_CREDITS = [
  { name: 'Marston', face: 'display',
    html: 'By Neale Davidson, from <a href="https://www.pixelsagas.com" target="_blank" rel="noopener noreferrer">Pixel Sagas</a>, under the Pixel Sagas Freeware Fonts EULA' },
  { name: 'RDR Lino Regular', face: 'heading',
    html: 'From <a href="http://www.onlinewebfonts.com" target="_blank" rel="noopener noreferrer">Web Fonts</a>, under CC BY 4.0' },
  { name: 'FB Remington', face: 'body',
    html: 'From <a href="https://www.dafont.com/fb_remington.font" target="_blank" rel="noopener noreferrer">DaFont</a>, free for professional use' },
];

// recipes.category is stored singular -- "Boot", not "Boots" -- so the
// Recipes page filter reads as one kind of thing.  A tally here is a
// count of several, so this page pluralises on the way out instead;
// irregular ones (a word ending in a consonant then "y") are listed,
// everything else just takes an "s".  A category already plural (a
// campfire one, such as "Hunting Accessories", though byCategory does
// not show those today) is left alone rather than doubled up.
const CATEGORY_PLURAL = {
  Accessory: 'Accessories',
};

/**
 * A release date as "5 Oct 2026".  The version file writes a bare day,
 * which a browser reads as midnight UTC, so it is shown in UTC too --
 * in local time it would land on the day before, west of Greenwich.
 */
function released(day) {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return day ?? 'unknown';
  return at.toLocaleDateString(undefined,
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function pluralCategory(category) {
  if (!category) return category;
  const words = category.split(' ');
  const last = words.pop();
  const plural = last.endsWith('s') ? last : CATEGORY_PLURAL[last] ?? `${last}s`;
  return [...words, plural].join(' ');
}

export function mount(root) {
  root.innerHTML = `
    <div class="settings">
      <section class="panel">
        <h3>Personalize and General</h3>
        <p class="note">
          <strong>Personalize</strong> folds in what you own: cards show what
          you have against what a vendor wants, recipes can be crafted, and
          anything crafted or skipped drops out of the way.<br>
          <strong>General</strong> ignores all of it and shows the reference
          data whole - every recipe, every material, every quantity.</p>
        <div class="panel-actions">
          <button type="button" class="ghost-btn" id="s-mode"></button>
        </div>
      </section>

      <section class="panel">
        <h3>Appearance</h3>
        <p class="note">Remembered on this device only, since
          the right one depends on where you are reading it.</p>
        <div class="segmented" role="tablist" id="s-theme">
          ${theme.THEMES.map((t) => `
            <button type="button" role="tab" data-theme="${esc(t.id)}"
                    aria-selected="false">${esc(t.label)}</button>`).join('')}
        </div>
      </section>

      <section class="panel">
        <h3>Take it with you</h3>
        <p class="note">Everything you have logged, as one text file. Keep it
          somewhere safe - clearing this site's data erases the original.</p>
        <p class="note" id="s-last"></p>
        <div class="panel-actions">
          <button type="button" class="more-btn" id="s-download">Download</button>
          <button type="button" class="ghost-btn" id="s-copy">Copy to clipboard</button>
        </div>
      </section>

      <section class="panel">
        <h3>Bring it back</h3>
        <p class="note">Reading a file <strong>replaces</strong> what is on this
          device. Nothing is written until you confirm.</p>
        <div class="panel-actions">
          <label class="ghost-btn file-btn">Upload a file
            <input type="file" id="s-file" accept=".json,application/json" hidden>
          </label>
          <button type="button" class="ghost-btn" id="s-paste-toggle"
                  aria-expanded="false" aria-controls="s-paste-box">Paste instead</button>
        </div>
        <div class="paste" id="s-paste-box" hidden>
          <textarea id="s-paste" rows="4" spellcheck="false"
                    placeholder="Paste the contents of an export…"></textarea>
          <button type="button" class="ghost-btn" id="s-read">Read this</button>
        </div>
        <div id="s-preview"></div>
      </section>

      <section class="panel">
        <h3>Offline</h3>
        <p class="note" id="s-offline">Checking…</p>
        <p class="note" id="s-kept" hidden></p>
        <div class="panel-actions">
          <button type="button" class="ghost-btn" id="s-update">Check for updates</button>
        </div>
      </section>

      <section class="panel danger">
        <h3>Erase everything</h3>
        <p class="note">Removes every ledger entry and every recipe you have
          marked. The reference data is untouched. This cannot be undone -
          download a copy first.</p>
        <div class="panel-actions" id="s-danger">
          <button type="button" class="ghost-btn" id="s-reset">Erase my data</button>
        </div>
      </section>

      <section class="panel">
        <h3>About</h3>
        <dl class="facts" id="s-about"></dl>
      </section>

      <!-- A plain link, not the site's own widget or button image: those
           load from its servers, which this page's policy blocks and its
           promise rules out.  Nothing is fetched until it is tapped. -->
      <section class="panel support">
        <h3>Support the guide</h3>
        <p class="note">The guide is free, with no ads, no accounts and
          nothing tracked, and it will stay that way. If it saved you a
          ride back to Valentine, a coffee keeps it going.</p>
        <div class="panel-actions">
          <a class="coffee-btn" href="https://buymeacoffee.com/arindambose"
             target="_blank" rel="noopener noreferrer">
            <span class="icon icon-coffee" aria-hidden="true"></span>
            Buy me a coffee
          </a>
          <small class="coffee-note">Opens buymeacoffee.com in a new tab</small>
        </div>
      </section>

      <section class="panel panel-wide">
        <h3>Your stats</h3>
        <dl class="facts" id="s-facts"></dl>

        <p class="list-label card-label">By vendor</p>
        <div class="demands" id="s-by-vendor"></div>

        <p class="list-label card-label">By category</p>
        <div class="stat-grid" id="s-by-category"></div>
      </section>

      <section class="panel panel-wide">
        <h3>Acknowledgements</h3>
        <p class="note">Where the reference data came from. None of this is
          mine; the guide is only the table they add up to.</p>
        <div class="ack-groups">
          <div>
            <p class="list-label">Reference data</p>
            <ul class="refs">
              ${REFERENCES.map((r) => `
                <li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"
                       ><strong>${esc(r.source)}</strong><small>${esc(r.title)}</small></a></li>`).join('')}
            </ul>
          </div>
          <div>
            <p class="list-label">Fonts used</p>
            <ul class="credits">
              ${FONT_CREDITS.map((f) => `
                <li><strong class="face-${esc(f.face)}">${esc(f.name)}</strong>
                    <small>${f.html}</small></li>`).join('')}
            </ul>
          </div>
        </div>
      </section>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const preview = $('#s-preview');
  const ledger = ledgerDialog();
  const about = aboutDialog();
  const howTo = howToDialog();

  $('#s-facts').addEventListener('click', (event) => {
    if (event.target.closest('[data-ledger]')) ledger.open();
  });

  // The About tile: the two pages of words, then the release this is.
  // Nothing here moves with the store, so it is filled once, not on
  // every update.
  const { number, date } = self.APP_VERSION ?? {};
  $('#s-about').innerHTML = facts([
    ['About this tool', '', 'about'],
    ['How to use this tool', '', 'howto'],
    ['Tool version', number ? `v${number}, updated ${released(date)}` : 'unknown'],
  ]);
  $('#s-about').addEventListener('click', (event) => {
    if (event.target.closest('[data-about]')) about.open();
    else if (event.target.closest('[data-howto]')) howTo.open();
  });
  let pending = null;          // text waiting for a confirmed import

  // ---- the file itself ------------------------------------------------

  // Both mark the backup taken, and the page hears it through the
  // subscription below, the same as from the masthead button.
  $('#s-download').addEventListener('click', backup.download);
  $('#s-copy').addEventListener('click', backup.copy);

  $('#s-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    offer(await file.text(), file.name);
    event.target.value = '';            // so the same file can be picked twice
  });

  // A button beside Choose a file rather than a disclosure under it, so
  // the tile's controls stay on one line, level with its neighbours'.
  const pasteToggle = $('#s-paste-toggle');
  function showPaste(open) {
    $('#s-paste-box').hidden = !open;
    pasteToggle.setAttribute('aria-expanded', String(open));
    if (open) $('#s-paste').focus();
  }
  pasteToggle.addEventListener('click', () =>
    showPaste(pasteToggle.getAttribute('aria-expanded') !== 'true'));

  $('#s-read').addEventListener('click', () => {
    const text = $('#s-paste').value.trim();
    if (text) offer(text, 'pasted text');
  });

  /** Say what the file holds, and what replacing would cost. */
  function offer(text, source) {
    const found = store.inspectImport(text);
    const now = store.stats();

    if (found.fatal) {
      pending = null;
      preview.innerHTML = `<div class="verdict bad">
        <p>${esc(found.fatal)}</p></div>`;
      return;
    }

    pending = text;
    const when = found.exported_at
      ? new Date(found.exported_at).toLocaleDateString()
      : 'an unknown date';

    preview.innerHTML = `
      <div class="verdict">
        <p><strong>${esc(source)}</strong> holds
          ${found.ledger} ${found.ledger === 1 ? 'entry' : 'entries'} and
          ${found.targets} marked ${found.targets === 1 ? 'recipe' : 'recipes'},
          exported ${esc(when)}.</p>
        <p>This device has ${now.entries} ${now.entries === 1 ? 'entry' : 'entries'}
          and ${now.made + now.skipped} marked. All of it will be replaced.</p>
        ${found.problems.length
          ? `<ul class="problems">${found.problems
              .map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
          : ''}
        <div class="panel-actions">
          <button type="button" class="more-btn" id="s-confirm">Replace my data</button>
          <button type="button" class="ghost-btn" id="s-cancel">Cancel</button>
        </div>
      </div>`;
  }

  preview.addEventListener('click', async (event) => {
    if (event.target.id === 's-cancel') {
      pending = null;
      preview.innerHTML = '';
    } else if (event.target.id === 's-confirm' && pending) {
      let found;
      try {
        found = await backup.restore(pending);
      } catch (err) {
        console.error(err);
        toast(`That backup could not be loaded: ${err?.message ?? err}`);
        return;
      }
      pending = null;
      preview.innerHTML = '';
      $('#s-paste').value = '';
      showPaste(false);
      toast(`Restored ${found.ledger} ${found.ledger === 1 ? 'entry' : 'entries'}.`);
    }
  });

  // ---- appearance -----------------------------------------------------

  const themeBar = $('#s-theme');

  function paintThemeButtons() {
    const on = theme.current();
    for (const button of themeBar.querySelectorAll('button')) {
      button.setAttribute('aria-selected', String(button.dataset.theme === on));
    }
  }

  themeBar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-theme]');
    if (!button) return;
    theme.set(button.dataset.theme);
    paintThemeButtons();
  });

  paintThemeButtons();

  // ---- mode, offline, erase -------------------------------------------

  // The masthead switch repaints itself off the same store change.
  $('#s-mode').addEventListener('click', () => store.setPersonal(!store.isPersonal()));

  $('#s-update').addEventListener('click', async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (!registration) return toast('Offline caching is not running.');
    await registration.update();
    toast('Checked. Any update installs on the next reload.');
  });

  // Erasing asks twice, in place, rather than through a dialog box.
  $('#s-danger').addEventListener('click', async (event) => {
    if (event.target.id === 's-reset') {
      event.currentTarget.innerHTML = `
        <span class="state-label">Erase ${store.stats().entries} entries?</span>
        <button type="button" class="ghost-btn" id="s-reset-no">Keep it</button>
        <button type="button" class="more-btn danger-btn" id="s-reset-yes">Erase</button>`;
    } else if (event.target.id === 's-reset-no') {
      resetDanger();
    } else if (event.target.id === 's-reset-yes') {
      await store.reset();
      resetDanger();
      toast('Erased.');
    }
  });

  function resetDanger() {
    $('#s-danger').innerHTML =
      '<button type="button" class="ghost-btn" id="s-reset">Erase my data</button>';
  }

  // ---- what the page reports -------------------------------------------

  function update() {
    const s = store.stats();

    $('#s-facts').innerHTML = facts([
      ['Ledger entries', s.entries, 'ledger'],
      ['Materials held', s.materials
        ? `${plural(s.materials, 'kind')} in ${plural(s.held, 'place')}`
        : 'nothing yet'],
      ['Recipes crafted', `${s.made}/${s.vendorRecipes}`],
      ['Recipes skipped', s.skipped],
      ['Spent crafting', money(s.spentCents)],
      ['Outfits completed', `${s.outfitsDone} of ${s.outfits}`],
    ]);

    $('#s-by-vendor').innerHTML = s.byVendor.map((v) => progressRow(v.station, v.made, v.total,
      { colour: stationColour(v.color), mark: icon(stationIcon(v.station_id)) })).join('');

    $('#s-by-category').innerHTML = s.byCategory.map((c) =>
      progressRow(pluralCategory(c.category), c.made, c.total)).join('');

    const last = backup.lastSaved();
    const { count } = backup.status();
    $('#s-last').textContent = (last
      ? `Last backed up ${last.toLocaleString()}.`
      : 'Never backed up from this device.')
      + (count ? ` ${plural(count, 'change')} since.` : '');

    $('#s-mode').textContent = store.isPersonal()
      ? 'Switch to General' : 'Switch to Personalize';


    reportOffline();
    reportKept();
    ledger.refresh();
  }

  async function reportOffline() {
    const target = $('#s-offline');
    if (!('serviceWorker' in navigator)) {
      target.textContent = 'This browser cannot cache the app for offline use.';
      return;
    }
    const names = await caches.keys();
    const mine = names.filter((n) => n.startsWith('rdr2-'));

    target.textContent = navigator.serviceWorker.controller
      ? `Cached and ready to use without a signal${
          mine.length ? ` (${mine[0]})` : ''}.`
      : 'Not cached yet - reload once while online.';
  }

  async function reportKept() {
    const target = $('#s-kept');
    const kept = await backup.kept();
    target.hidden = kept === null;
    target.textContent = kept
      ? 'This browser has agreed to keep your data until you clear it yourself.'
      : 'This browser may clear your data on its own -- if the site goes '
        + 'unvisited for a while, or space runs low -- so keep a backup.';
  }

  // A term with an `opens` becomes the button that opens its dialog.
  function facts(pairs) {
    return pairs.map(([term, value, opens]) => `
      <div>
        <dt>${opens
          ? `<button type="button" class="fact-open" data-${esc(opens)}
                     aria-haspopup="dialog">${esc(term)}</button>`
          : esc(term)}</dt>
        <dd>${esc(value)}</dd>
      </div>`).join('');
  }

  /**
   * A labelled count against its total, with a bar -- the same shape
   * a material card's vendor demand takes, reused here for a made/total
   * tally instead of a have/needed one.  `mark` is the vendor's own
   * icon, where there is one to show.
   */
  function progressRow(label, made, total, { colour = '', mark = '' } = {}) {
    const pct = total ? Math.round((made / total) * 100) : 0;
    return `
      <div class="demand ${colour}">
        <span class="station">${mark}${esc(label)}:</span>
        <span class="qty"><span class="${made ? 'have' : ''}">${made}</span>/${total}</span>
        <span class="bar" role="img"
              aria-label="${made} of ${total} crafted for ${esc(label)}"
          ><i style="width:${pct}%"></i></span>
      </div>`;
  }

  const unsubscribe = backup.subscribe(update);

  update();
  return {
    update,
    destroy() {
      unsubscribe();
      ledger.destroy();
      about.destroy();
      howTo.destroy();
    },
  };
}
