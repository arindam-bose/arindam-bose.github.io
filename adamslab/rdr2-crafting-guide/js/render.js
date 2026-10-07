// ============================================================
// Card templates.
//
// Everything here returns an HTML string and touches no state,
// so a view is a query plus a join of these.  Anything from the
// database goes through esc() on the way in.
// ============================================================

import * as nav from './nav.js';

/**
 * A name that is also somewhere to go: the recipes on a material's
 * card, the materials on a recipe's.  A real anchor with a real
 * href, so it can be middle-clicked, copied, and tabbed to, and so
 * the page it lands on can be arrived at cold from a bookmark.
 */
export function crossLink(route, id, text) {
  return `<a class="xlink" href="${esc(nav.href(route, id))}">${esc(text)}</a>`;
}

/**
 * A name that leads off the site -- an animal's wiki page -- in a new
 * tab, drawn like a cross-link.  Only a web address becomes a link: the
 * value comes from a spreadsheet, and a `javascript:` one would run.
 */
export function webLink(url, text) {
  if (!/^https?:\/\//i.test(url ?? '')) return esc(text);
  return `<a class="xlink" href="${esc(url)}" target="_blank" rel="noopener noreferrer"
            title="${esc(text)} on the Red Dead wiki">${esc(text)}</a>`;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** The stamp of stars itself: grey for Perfect, gold for Legendary. */
function stars(quality, label) {
  const named = label
    ? `role="img" aria-label="${esc(quality)}" title="${esc(quality)}"`
    : 'aria-hidden="true"';
  return `<span class="stars stars-${esc(quality.toLowerCase())}" ${named}></span>`;
}

/**
 * Quality as the game marks it, beside a material's name wherever one
 * is listed -- a card, a recipe's ingredients, an inventory row: the
 * stars alone, labelled, so a screen reader still says which.
 */
export function qualityStars(quality) {
  return quality ? stars(quality, true) : '';
}

/** The stars with the quality written out after them, for a dialog's facts. */
export function qualityLabel(quality) {
  return quality ? `${stars(quality, false)}${esc(quality)}` : '';
}

/**
 * A station as a chip, in the station's own colour -- the one its
 * stripe and demand rows use.  Only for a station with no icon: see
 * stationMark.
 */
function stationBadge(name, colour) {
  if (!name) return '';
  return `<span class="badge station ${stationColour(colour)}">${esc(name)}</span>`;
}

/**
 * A card's name with whatever trails it -- the stars, a station, a
 * state -- held to its last word, so a name that fills its line takes
 * that word down with them rather than leaving them on a line alone.
 */
export function nameWith(name, trailing) {
  if (!trailing) return esc(name);
  const cut = name.lastIndexOf(' ') + 1;
  return `${esc(name.slice(0, cut))}<span class="keep">${
    esc(name.slice(cut))}${trailing}</span>`;
}

/** "1 material", "2 materials". */
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "$40.00" from a recipe's price in cents. */
export function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * A station's colour, as the database spells it.  Guarded because it
 * reaches the stylesheet as a class name, and only these four have a
 * rule behind them.
 */
export function stationColour(colour) {
  return ['blue', 'yellow', 'pink', 'green'].includes(colour) ? colour : '';
}

/**
 * The icon that matches a station's id: the filter chips, the demand
 * rows, a recipe's card and its dialog.  Guarded the same way as
 * stationColour: an id with no icon behind it draws no icon rather
 * than a broken one.
 */
export function stationIcon(id) {
  return { 'station-pearson': 'pearson', 'station-trapper': 'trapper',
           'station-fence': 'fence', 'station-campfire': 'campfire' }[id];
}

/**
 * A station by its icon alone, where a recipe's card once named it in
 * a chip: labelled, so a screen reader and a hover still say which.
 * A station with no icon keeps the chip.
 */
export function stationMark(id, name, colour) {
  const which = stationIcon(id);
  if (!which) return stationBadge(name, colour);
  return `<span class="icon icon-${which} station-mark" role="img"
            aria-label="${esc(name)}" title="${esc(name)}"></span>`;
}

/** A station in a dialog's facts: its icon, then its name in plain type. */
export function stationLabel(id, name) {
  return name ? `${icon(stationIcon(id))}${esc(name)}` : '';
}

/**
 * A station's or a place's icon, beside its name: on a chip or a tab,
 * a demand row, a dialog's facts.  The image itself is swapped by theme
 * in CSS -- parchment or leather -- so this only ever names which one,
 * not where it lives.
 */
export function icon(name) {
  if (!name) return '';
  return `<span class="icon icon-${name}" aria-hidden="true"></span>`;
}

/** What a material is, as a dialog's kicker names it. */
const KIND_LABEL = {
  animal: 'Animal material',
  plant: 'Plant',
  ammo: 'Ammo & throwables',
  alcohol: 'Liquor',
  misc: 'Misc. item',
};

/**
 * How many recipes a material card lists before it offers the rest.
 * Only five materials in the reference data go past this.
 */
const USAGE_SHOWN = 6;

/**
 * One material: what it goes into and which stations still want it.
 * Where it comes from and the verdict live in the detail view, which
 * the whole card opens.
 *
 *   material = { ingredient_id, material, quality, source_type,
 *                body_part, animals: [...], demands: [...],
 *                usage: [...] }
 *
 * `personal` decides whether the card talks about what you have,
 * `expanded` whether its "used in" list is showing every entry, and
 * `done` whether it gets the checkbox Recipes stamps a crafted card
 * with -- nothing is outstanding for it, and something still tracks it.
 */
export function materialCard(material, { personal, expanded = false, done = false }) {
  const { material: name, quality } = material;

  // The Campfire never needs anything, so it is never among these.
  const open = material.demands.filter((d) => d.needed > 0);
  const fire = personal && material.demands.find((d) => d.campfire);

  // The name is a real button, so the card opens from the keyboard
  // too; a click anywhere else on the card is forwarded to it.  The
  // stars sit inside it, for the reason a recipe card's station does.
  return `
    <article class="card material" data-ingredient="${esc(material.ingredient_id)}">
      <div class="card-title">
        <h3><button type="button" class="card-open" data-open
              aria-haspopup="dialog">${nameWith(name, qualityStars(quality))}</button></h3>
        ${done ? doneMark('Done') : ''}
      </div>

      ${usedIn(material.usage, personal, expanded)}

      ${open.length ? `
        <p class="list-label card-label">Vendors</p>
        <div class="demands">${open.map((d) => demandRow(d, personal)).join('')}</div>`
        : ''}

      ${fire ? `
        <p class="list-label card-label">Campfire</p>
        <div class="demands">${campfireRow(fire)}</div>` : ''}
    </article>`;
}

/**
 * What a campfire recipe asks of you: nothing in particular.  All the
 * row can say is how many you hold where the fire cooks from.
 */
function campfireRow(d) {
  return `
    <div class="demand ${stationColour(d.color)}">
      <span class="station">${icon('campfire')}${esc(heldAt(d.location_id, d.location))}:</span>
      <span class="qty">${d.have}</span>
      <span></span>
    </div>`;
}

// ------------------------------------------------------------
// detail dialogs
//
// The pieces every dialog body is built from, so the three that
// exist -- a material, a recipe, the ledger -- are laid out alike.
// ------------------------------------------------------------

/**
 * A dialog's heading: a kicker over the title, anything that belongs
 * in the corner (the recipe's want switch), and the close button that
 * dialog.js listens for.
 */
export function detailHead(kicker, title, aside = '') {
  return `
    <header class="detail-head">
      <div>
        <p class="detail-kicker">${esc(kicker)}</p>
        <h2 id="detail-title">${esc(title)}</h2>
      </div>
      ${aside}
      <button type="button" class="detail-close" data-close
              aria-label="Close">&times;</button>
    </header>`;
}

/**
 * The grid of facts under a heading.  Values are HTML, already
 * escaped, since some of them are tags; a pair with no value is
 * left out rather than shown empty.
 */
export function traits(pairs) {
  const shown = pairs.filter(([, value]) => value);
  if (!shown.length) return '';
  return `
    <dl class="traits">
      ${shown.map(([label, value]) => `
        <div class="trait"><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join('')}
    </dl>`;
}

/** A captioned block of a dialog; nothing at all when it has no body. */
export function detailSection(title, body) {
  if (!body) return '';
  return `
    <section class="detail-section">
      <h3 class="list-label">${esc(title)}</h3>
      ${body}
    </section>`;
}

// ------------------------------------------------------------
// locations
//
// The Satchel is a bag, so things are in it; the Trapper and
// Pearson are people, so things are with them.  Every screen that
// names a location says it the same way.
// ------------------------------------------------------------

const SATCHEL = 'loc-satchel';

/** "the Satchel", "Pearson" -- a location as the object of a sentence. */
export function placeName(id, name) {
  return id === SATCHEL ? `the ${name}` : name;
}

/** "In the Satchel", "With Pearson" -- where something is being held. */
export function heldAt(id, name) {
  return `${id === SATCHEL ? 'In' : 'With'} ${placeName(id, name)}`;
}

/**
 * The same material, opened: every fact the database has about it, laid
 * out for reading rather than scanning, with a stepper per station so
 * what you just brought in can be logged without leaving the page.
 */
export function materialDetail(material, { personal }) {
  const { material: name, quality, source_type, body_part, animals } = material;
  const isAnimal = source_type === 'animal';

  // A pelt comes off one animal, and its weapon or bait sits in the
  // facts beside it.  Fat, meat and the common feathers come off a
  // dozen, each taken its own way, so they get a list instead: one
  // merged "Weapon" line could not say which animal wants which.
  const [only] = animals.length === 1 ? animals : [];
  const facts = isAnimal
    ? [['Animal', only && webLink(only.link, only.name)],
       ['Quality', qualityLabel(quality)],
       ['Type', esc(body_part)],
       ['Weapon', only && esc(only.weapon)],
       ['Bait', only && esc(only.bait)]]
    : source_type === 'misc'
      ? [['Source', 'Found out in the world'], ['Quality', qualityLabel(quality)]]
      : [];

  // Stations with nothing left to make still show in personal mode --
  // faded, as "needs no more" -- because you may be holding some there
  // to sell.  The Campfire shows only then: it needs nothing, so all
  // it has to say is what you hold.
  const demands = personal
    ? material.demands
    : material.demands.filter((d) => d.needed > 0);
  const fire = demands.some((d) => d.campfire);
  const stockTitle = !fire ? 'Vendors'
    : demands.length > 1 ? 'Vendors and campfire' : 'Campfire';

  return `
    ${detailHead(KIND_LABEL[source_type] ?? 'Material', name)}
    ${traits(facts)}
    ${detailSection('Animals', animals.length > 1 && `
      <ul class="detail-list detail-animals">
        ${animals.map(animalLine).join('')}
      </ul>`)}
    ${detailSection('Recipes used in', material.usage.length && `
      <ul class="detail-list detail-recipes">
        ${material.usage.map((u) => recipeLine(u, personal)).join('')}
      </ul>`)}
    ${detailSection(stockTitle, demands.length && `
      <div class="detail-stock">
        ${demands.map((d) => stockLine(d, personal)).join('')}
      </div>`)}
    ${detailSection('Comments', verdict(material, personal))}`;
}

/** One animal a material comes from, and how to take it. */
function animalLine(a) {
  const how = a.bait ? `Bait: ${a.bait}` : a.weapon;
  return `
    <li>
      <span class="what">${webLink(a.link, a.name)}</span>
      ${how ? `<span class="how">${esc(how)}</span>` : ''}
    </li>`;
}

/** "2x for " when a recipe takes more than one of this; nothing for one. */
function forQty(qty) {
  return qty > 1 ? `${qty}x for ` : '';
}

/** One recipe in the detail view, with its state spelled out. */
function recipeLine(u, personal) {
  // Crafted and not crafted are the checkbox, exactly as Recipes
  // stamps a card once it is made; Skipped keeps the word Recipes
  // uses for the same state everywhere else, since there is no
  // skipped icon to stand in for it.
  const [state, label] = !personal || u.state === 'campfire' ? ['plain', '']
    : u.state === 'done' ? ['made', '']
    : u.state === 'skipped' ? ['retired', 'Skipped']
    : ['open', ''];

  const mark = state === 'made' ? checkbox(true)
    : state === 'open' ? checkbox(false)
    : label ? `<span class="state">${label}</span>` : '';

  // Unlike forQty elsewhere, the amount always shows here: a bare name
  // in this list reads as though the amount were left out rather than
  // being 1, where the card's own tile stays tight on room instead.
  return `
    <li class="${state}">
      <span class="what">${u.qty}x for ${
        crossLink('recipes', u.recipe_id, u.recipe)}
        <small>${esc(u.station)}</small></span>
      ${mark}
    </li>`;
}

/** The checkbox standing in for "Crafted" / "Not crafted", the same
    size as `doneMark` draws in a card's corner -- just checked or not. */
function checkbox(done) {
  return `<span class="icon ${done ? 'icon-crafted' : 'icon-uncrafted'} crafted-mark"
            role="img" aria-label="${done ? 'Crafted' : 'Not crafted'}"></span>`;
}

/**
 * The same checked/unchecked box, sized instead to sit inline with a
 * line of text: a material's used-in list and a recipe's ingredient
 * list both stamp have/short or made/open this way, decorative since
 * the row it sits in already says which one it is.
 */
export function markIcon(done) {
  return `<span class="mark icon ${done ? 'icon-crafted' : 'icon-uncrafted'}"
            aria-hidden="true"></span>`;
}

/**
 * The checked box stamped in a card's corner once the thing it names
 * is done -- a recipe crafted, a material finished with -- in place
 * of a text badge.  `label` is what a screen reader says, since the
 * mark itself is always the same checked box either way.
 */
export function doneMark(label) {
  return `<span class="icon icon-crafted crafted-mark" role="img"
            aria-label="${esc(label)}" title="${esc(label)}"></span>`;
}

/**
 * One station in the detail view: what it asks for, what you hold where
 * it draws from, and a stepper that writes straight to that location.
 * The Fence is the odd one -- it sells at its own counter but spends
 * from your Satchel -- so the location is named whenever it differs.
 * The row carries only its location; the view knows the material.
 */
function stockLine(d, personal) {
  const colour = stationColour(d.color);
  const place = placeName(d.location_id, d.location);
  const where = d.location && d.location !== d.station
    ? `<small class="from">from your ${esc(d.location)}</small>` : '';

  if (!personal) {
    return `
      <div class="stock-line demand ${colour}">
        <span class="stock-text"><span class="station">${icon(stationIcon(d.station_id))}${esc(d.station)}</span>
          needs ${d.needed}${where}</span>
      </div>`;
  }

  // The Campfire takes any amount, so it is never short or retired.
  const enough = d.campfire || d.have >= d.needed;
  const retired = !d.campfire && d.needed === 0;
  const needs = retired ? 'needs no more' : `needs ${d.needed}`;

  // The Campfire is not a vendor wanting something from you: it is you,
  // cooking with what is in your Satchel.  So it reads as something to
  // do, with your own count -- "Use it in Campfire, have 3 / in your
  // Satchel" -- rather than "Campfire uses it, has 3".
  const [lead, says, from] = d.campfire
    ? [`Use it in ${esc(d.station)}`, ', have',
       `<small class="from">in your ${esc(d.location)}</small>`]
    : [esc(d.station), ` ${needs}, has`, where];

  return `
    <div class="stock-line demand ${colour}${retired ? ' retired' : ''}"
         data-location="${esc(d.location_id)}">
      <span class="stock-text"><span class="station">${icon(stationIcon(d.station_id))}${lead}</span>${says}
        <span class="${enough ? 'have' : 'short'}">${d.have}</span>${from}</span>
      <span class="stepper">
        <button type="button" data-delta="-1" data-key="${esc(d.station_id)}-less"
                ${d.have <= 0 ? 'disabled' : ''}
                aria-label="One fewer with ${esc(place)}">-</button>
        <button type="button" class="add" data-delta="1" data-key="${esc(d.station_id)}-more"
                aria-label="Add one to ${esc(place)}">+ Add to ${esc(d.location)}</button>
      </span>
    </div>`;
}

/**
 * The Comments line in the detail view, carried over from the formula the
 * Notion table used.  Two numbers decide it:
 *
 *   totalNeeded  what the recipes you still intend to make ask for.
 *                A made or skipped recipe stops asking, so this falls
 *                to zero once you are finished with a material.
 *   moreNeeded   totalNeeded minus what you are holding.  Negative
 *                means you have more than anything still wants.
 *
 * Both sum across the station rows above it, so the line can never
 * contradict them.  Each station draws on its own
 * location -- the Fence on your Satchel, the Trapper on the Trapper --
 * so nothing is counted twice.
 *
 * Animal materials and misc items had separate formulas in Notion and
 * keep them here: only animals get the "done with this item" case, and
 * the two word a surplus differently.
 */
function verdict(material, personal) {
  // Without a personal layer there is no "have", so there is nothing
  // to weigh what the stations want against.
  if (!personal) return '';

  // Only vendors are weighed.  The Campfire asks for no set amount,
  // and it cooks from the Satchel the Fence also draws on, so counting
  // its row would count the same stock twice.
  const vendors = material.demands.filter((d) => !d.campfire);
  if (!vendors.length) {
    return '<p class="hint">No vendor wants this. It goes into campfire recipes, as many as you care to make.</p>';
  }

  const totalNeeded = vendors.reduce((n, d) => n + d.needed, 0);
  const have = vendors.reduce((n, d) => n + d.have, 0);
  const moreNeeded = totalNeeded - have;
  const animal = material.source_type === 'animal';
  const fish = material.animals.length > 0 && material.animals.every((a) => a.bait);

  // A material the campfire also uses is never finished with, and a
  // surplus of it is better cooked than sold.  That holds for a plant
  // or a supply as much as for a pelt, so the fire is asked first.
  const fire = material.demands.some((d) => d.campfire);

  const [state, words] =
    fire && totalNeeded === 0
      ? ['enough', 'No vendor needs more. It still goes into campfire recipes.']
    : animal && totalNeeded === 0
      ? ['done', "You are done with this item, you don't need more!!"]
    : moreNeeded === 0
      ? ['enough', 'You have what you need!']
    : moreNeeded > 0
      ? ['short', fish ? 'You need to go fishing!'
                : animal ? 'You need to go hunting!' : 'You need to go find it!']
    : fire
      ? ['spare', 'You have more than any vendor needs. The rest can go on the fire.']
    : animal
      ? ['spare', "You're already golden! If you have more, sell them to Butcher!!"]
      : ['spare', 'You may sell the rest!'];

  return `<p class="hint ${state}">${words}</p>`;
}

/** The recipes a material goes into, each with its tick or cross. */
function usedIn(usage = [], personal, expanded = false) {
  if (!usage.length) return '';

  const shown = expanded ? usage : usage.slice(0, USAGE_SHOWN);
  const rest = usage.length - shown.length;
  const over = usage.length > USAGE_SHOWN;

  const line = (u) => {
    const state = !personal || u.state === 'campfire' ? 'plain'
      : u.state === 'done' ? 'made'
      : u.state === 'skipped' ? 'retired'
      : 'open';
    // Made and open are the same checkbox the card corners use, checked
    // or not; retired and plain have no such icon, so they stay type --
    // each alone in a .mark span with its own font stack, so the
    // typewriter face not having them is contained, unlike a gap in the
    // middle of a word.
    const mark = state === 'made' ? markIcon(true)
      : state === 'open' ? markIcon(false)
      : `<span class="mark" aria-hidden="true">${{ retired: '\u2013', plain: '\u00b7' }[state]}</span>`;

    return `<li class="${state}">
      ${mark}
      <span class="what">${forQty(u.qty)}${
        crossLink('recipes', u.recipe_id, u.recipe)}</span>
    </li>`;
  };

  // Rare -- five materials reach it -- but on those five the tail is
  // most of the list, and a card ending in "and 6 more" with no way to
  // read them is the card failing at its one job.
  const toggle = !over ? '' : `
    <li class="more">
      <button type="button" class="more-link" data-expand
              aria-expanded="${expanded}">${
        expanded ? 'Show fewer' : `and ${rest} more`}</button>
    </li>`;

  // Captioned: with a single entry -- which is every misc material,
  // each feeding exactly one talisman -- an unlabelled line under the
  // demand rows reads as another demand row, not as a list.
  return `
    <p class="list-label card-label">Used in</p>
    <ul class="used-in">
      ${shown.map(line).join('')}
      ${toggle}
    </ul>`;
}

/**
 * One station's demand for this material, and how close you are:
 * "Pearson: 0/2", the station's colour down the left edge.
 */
function demandRow(d, personal) {
  const colour = stationColour(d.color);

  if (!personal) {
    return `
      <div class="demand ${colour}">
        <span class="station">${icon(stationIcon(d.station_id))}${esc(d.station)}:</span>
        <span class="qty">${d.needed}</span>
        <span></span>
      </div>`;
  }

  const enough = d.have >= d.needed;
  const pct = d.needed ? Math.min(100, Math.round((d.have / d.needed) * 100)) : 100;

  return `
    <div class="demand ${colour}">
      <span class="station">${icon(stationIcon(d.station_id))}${esc(d.station)}:</span>
      <span class="qty">
        <span class="${enough ? 'have' : 'short'}">${d.have}</span>/${d.needed}
      </span>
      <span class="bar ${enough ? '' : 'short'}"
            role="img" aria-label="${d.have} of ${d.needed} for ${esc(d.station)}"
        ><i style="width:${pct}%"></i></span>
    </div>`;
}

/**
 * How many cards a gallery shows before you ask for more.  Both
 * galleries run to three figures, and a phone rendering 255 cards
 * to show you the first four is work nobody asked for.
 */
export const PAGE = 20;

/** The control under a gallery.  Absent when everything fits. */
export function pager(shown, total) {
  if (total <= PAGE) return '';

  const next = Math.min(PAGE, total - shown);

  return `
    <div class="pager">
      <span class="pager-count">${Math.min(shown, total)} of ${total}</span>
      ${next > 0
        ? `<button type="button" class="more-btn" data-page="more" data-key="page-more"
             >Show ${next} more</button>`
        : ''}
      ${shown > PAGE
        ? '<button type="button" class="ghost-btn" data-page="less" data-key="page-less">Show less</button>'
        : ''}
    </div>`;
}

export function empty(message) {
  return `<p class="empty">${esc(message)}</p>`;
}

export function errorBox(err) {
  return `
    <div class="error">
      <h2>That didn't load.</h2>
      <p>${esc(err.message || err)}</p>
    </div>`;
}
