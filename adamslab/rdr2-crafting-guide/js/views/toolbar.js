// ============================================================
// The gallery toolbar, shared by Materials and Recipes.
//
// The two screens list different things, but they list them the
// same way: a search box, chips that pick one thing, chips that
// narrow to a subset, a sort field with a direction, and a pager
// under the cards.  All of that was written twice, which is how
// the two drifted -- one grew "Show less", the other did not.
//
// Each function here is either markup or wiring, never both, so
// a view still reads as "build this, then listen for that".
// ============================================================

import { esc, icon, PAGE } from '../render.js';
import * as prefs from '../prefs.js';

// ------------------------------------------------------------
// markup
// ------------------------------------------------------------

export function searchBox(id, placeholder) {
  return `
    <div class="search-wrap">
      <input type="search" class="search" id="${esc(id)}"
             placeholder="${esc(placeholder)}"
             autocomplete="off" spellcheck="false">
      <button type="button" class="search-clear close-btn" data-clear
              tabindex="-1" aria-label="Clear search" hidden>x</button>
    </div>`;
}

/**
 * A row of chips.  `attr` is the data attribute they carry, which
 * is also the key the wiring writes on the view's state.  A chip
 * with an `icon` -- one of the merchant stations -- draws it before
 * the label; the rest, "All" included, draw none.
 *
 *   chipRow('m-stations', 'station',
 *           [{ value: '', label: 'All', pressed: true }, …])
 */
export function chipRow(id, attr, chips) {
  return `
    <div class="chips" id="${esc(id)}">
      ${chips.map((c) => `
        <button class="chip" data-${esc(attr)}="${esc(c.value)}"
                aria-pressed="${c.pressed ? 'true' : 'false'}"
          >${icon(c.icon)}${esc(c.label)}</button>`).join('')}
    </div>`;
}

/**
 * Tabs across the top of a page, each with room for a count of the
 * matches it holds.  `tabs` are { id, title, icon }, the icon optional
 * and drawn before the title.  `selected` starts chosen, the first tab
 * unless it says otherwise; `counts: false` leaves the count out, for
 * tabs that are places rather than shares of a search.
 *
 *   tabRow('r-kinds', 'kind', [{ id: 'vendor', title: 'Vendor recipes' }, …])
 */
export function tabRow(id, attr, tabs, { selected = tabs[0]?.id, counts = true } = {}) {
  return `
    <div class="segmented" role="tablist" id="${esc(id)}">
      ${tabs.map((t) => `
        <button role="tab" data-${esc(attr)}="${esc(t.id)}" aria-selected="${t.id === selected}">
          ${icon(t.icon)}${esc(t.title)}${counts ? '<span class="tab-count"></span>' : ''}</button>`).join('')}
    </div>`;
}

/**
 * The sort field and the button that reverses it.
 *
 * `current` has to be marked selected: without it the browser shows
 * whichever option happens to be first, which is not necessarily the
 * one the view is sorting by -- the control then says one thing while
 * the list does another.
 */
export function sortControl(id, sorts, label, current) {
  return `
    <div class="sort">Sort
      <select class="select" id="${esc(id)}-sort" aria-label="${esc(label)}">
        ${Object.entries(sorts).map(([value, s]) => `
          <option value="${esc(value)}"${value === current ? ' selected' : ''}
            >${esc(s.label)}</option>`).join('')}
      </select>
      <button type="button" class="sort-dir" id="${esc(id)}-dir"></button>
    </div>`;
}

// ------------------------------------------------------------
// remembering the sort
//
// How you like a list ordered is a preference, not a filter: it
// says nothing about what you are looking for, so unlike the search
// box and the chips it is worth carrying between visits.
// ------------------------------------------------------------

const sortKey = (name) => `rdr2:sort:${name}`;

/**
 * The sort last used on this screen, or `fallback` if there is none
 * we can still honour.  A stored field that no longer exists -- a
 * rename, an older build -- falls back rather than throwing.
 */
export function restoreSort(name, sorts, fallback) {
  const [sort, dir] = (prefs.get(sortKey(name)) ?? '').split(':');
  if (!Object.hasOwn(sorts, sort)) return fallback;
  return { sort, dir: dir === 'asc' || dir === 'desc' ? dir : sorts[sort].start };
}

// ------------------------------------------------------------
// wiring
//
// Each takes the view's `state` and the callback that reruns the
// list, so the view decides whether a change starts the pages
// over.  None of them render.
// ------------------------------------------------------------

export function wireSearch(input, state, onChange) {
  input.addEventListener('input', () => {
    state.search = input.value.trim().toLowerCase();
    onChange();
  });
  wireClear(input);
}

/**
 * The × beside a search box: shown only once there is something to
 * clear.  A click empties the box and fires a real `input` event
 * rather than calling back into the view directly, so it runs
 * through the exact same listener a keystroke would have -- state
 * and all -- instead of a second path that could clear the box
 * without clearing `state.search` to match.  Exported on its own for
 * Inventory, which wires its search box by hand instead of through
 * `wireSearch`.
 */
export function wireClear(input) {
  const clear = input.parentElement.querySelector('[data-clear]');
  if (!clear) return;

  const sync = () => { clear.hidden = !input.value; };
  input.addEventListener('input', sync);

  clear.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });

  sync();
}

/** Pick exactly one.  An empty value means "no filter". */
export function wirePicker(el, attr, state, onChange) {
  el.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;

    state[attr] = chip.dataset[attr] || null;
    for (const c of el.children) {
      c.setAttribute('aria-pressed', String(c === chip));
    }
    onChange();
  });
}

/** Make `value` the chosen tab, on screen and in the state. */
export function selectTab(el, attr, state, value) {
  state[attr] = value;
  for (const t of el.children) {
    t.setAttribute('aria-selected', String(t.dataset[attr] === value));
  }
}

/** Pick a tab.  `onChange` runs only when the tab actually changes. */
export function wireTabs(el, attr, state, onChange) {
  el.addEventListener('click', (event) => {
    const tab = event.target.closest(`[data-${attr}]`);
    if (!tab || tab.dataset[attr] === state[attr]) return;
    selectTab(el, attr, state, tab.dataset[attr]);
    onChange();
  });
}

/**
 * Share the matches out between the tabs: each tab shows how many it
 * holds, so a search that landed on another tab is visible rather than
 * lost.  Returns the counts, keyed by tab id.
 */
export function countTabs(el, attr, tabs, items, tabOf) {
  const counts = {};
  for (const t of tabs) {
    counts[t.id] = items.filter((x) => tabOf(x) === t.id).length;
    el.querySelector(`[data-${attr}="${t.id}"] .tab-count`).textContent = counts[t.id];
  }
  return counts;
}

/**
 * What an empty tab says when the matches are on the others --
 * "Nothing here -- 8 under Campfire." -- or '' when there are none.
 */
export function elsewhere(tabs, current, counts) {
  const others = tabs.filter((t) => t.id !== current && counts[t.id]);
  return others.length
    ? `Nothing here -- ${others.map((t) => `${counts[t.id]} under ${t.title}`).join(', ')}.`
    : '';
}

/**
 * Narrow to a subset, where tapping the pressed chip goes back to
 * everything.  `state[attr]` is the chip's value, or 'all'.
 */
export function wireToggles(el, attr, state, onChange) {
  el.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;

    state[attr] = state[attr] === chip.dataset[attr] ? 'all' : chip.dataset[attr];
    for (const c of el.children) {
      c.setAttribute('aria-pressed', String(c.dataset[attr] === state[attr]));
    }
    onChange();
  });
}

/**
 * The sort field and its direction.  Choosing a field also sets the
 * direction that field is nearly always wanted in.
 */
export function wireSort(root, id, sorts, state, onChange, name) {
  const remember = () => prefs.set(sortKey(name), `${state.sort}:${state.dir}`);

  root.querySelector(`#${id}-sort`).addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.dir = sorts[state.sort].start;
    remember();
    onChange();
  });

  root.querySelector(`#${id}-dir`).addEventListener('click', () => {
    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    remember();
    onChange();
  });
}

/**
 * Say what the direction does rather than draw an arrow you have to
 * interpret: "Most first", "Legendary first", "A-Z".
 */
export function paintDir(button, sorts, state) {
  const { ways } = sorts[state.sort];
  button.textContent = `${state.dir === 'asc' ? '↑' : '↓'} ${ways[state.dir]}`;
  button.title = `Sorted ${ways[state.dir].toLowerCase()} -- click to reverse`;
}

/** Show more, show less.  `state.shown` is how many are on screen. */
export function wirePager(el, state, update) {
  el.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button) return;

    if (button.dataset.page === 'more') {
      state.shown += PAGE;
      update();
    } else {
      state.shown = PAGE;
      update();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

/** The comparator for `state`, with the direction folded in. */
export function comparator(sorts, state) {
  const flip = state.dir === 'asc' ? 1 : -1;
  return (a, b) => flip * sorts[state.sort].fn(a, b);
}
