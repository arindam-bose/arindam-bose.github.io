# rdr2-crafting-guide

What to craft in Red Dead Redemption 2, what it needs, and what you already have.

A static site with no build step: plain ES modules, [sql.js] in the browser, and
a service worker so it keeps working out of signal range. Nothing is uploaded —
the reference data is a read-only SQLite file that ships with the app, and your
own inventory lives in your browser.

[sql.js]: https://sql.js.org

## Privacy, enforced

"Nothing is uploaded" is not a promise the reader has to take on trust: the
page tells the browser to refuse anything else. Every page carries a
Content-Security-Policy as a `<meta>` tag -- GitHub Pages cannot set headers --
first in `<head>`, so it covers everything after it:

- `default-src 'self'`: the page may load and fetch from its own origin and
  nowhere else. A request to any other server is blocked by the browser and
  shows in its console.
- `script-src` adds `'wasm-unsafe-eval'`, which lets sql.js compile its
  WebAssembly and nothing more -- JavaScript `eval` stays blocked -- and the
  SHA-256 hash of the one inline script, the theme line in `<head>`. Change a
  byte of that script and it stops running: recompute the hash (sha256 of the
  text between the tags, base64), update the policy, and rerun
  `scripts/build_pages.py`, which copies both into every search page. The other early
  scripts are files (`js/mode-toggle-early.js`, `js/file-protocol.js`) so they
  need no hash.
- `style-src` allows inline styles, for the progress bars' `style="width:…"`.
  A style can still only load from this origin.
- `object-src`, `base-uri` and `form-action` are all `'none'`.

`<meta name="referrer" content="no-referrer">` keeps the page's address out of
the `Referer` header when a link leads off the site. Those links -- the wiki
pages, the acknowledgements, Buy me a coffee -- are plain anchors that open in a
new tab; nothing from another site is embedded, so nothing is contacted until
one is followed. `frame-ancestors` cannot be set from a meta tag, so it is not.

## Two layers

**Reference** — `data/rdr2.db`, built from a Notion export and the
campfire-recipe workbook by `scripts/build_db.py`. Recipes, ingredients, the
animals each one comes from, the weapon that leaves each pelt unspoiled, and
which station crafts what. Read-only, rebuilt from source rather than edited.

Recipes come in two kinds. A **one-time** recipe is made once at Pearson, the
Trapper or the Fence, and is tracked: crafted, skipped, still wanted. A
**repeatable** one (`recipes.repeatable = 1`) is made at your own campfire as
often as you have the ingredients; it is shown, never crafted or ticked off,
and its `price_cents` is what the recipe itself costs to buy. A repeatable
recipe may take alternatives -- any one sage will do -- which
`recipe_ingredients` records as rows sharing a `slot`.

**Personal** — `database/personal_schema.sql`, created at runtime in the same
sql.js connection so the two can be joined without an `ATTACH`. It is an
append-only `ledger`: current stock is `SUM(delta)`, an undo is a `DELETE`, and
a mis-entry is fixed with a correcting row. IndexedDB holds those rows between
visits and replays them on startup.

Demand is per **station**, stock is per **location** — the Fence sells from its
own counter but draws on your Satchel.

## Running it

Any static server, from the repository root:

    python3 -m http.server 8000

then open <http://localhost:8000>. It needs to be served over HTTP rather than
opened as a file, because the modules and the database are fetched. The
security policy is in the page itself, so a local server enforces it exactly as
the live site does.

## Rebuilding the database

    pip install pandas openpyxl
    python3 scripts/build_db.py --check-ids data/rdr2.db

Its sources live in `data/raw/`: the five Notion CSVs, the campfire-recipe
workbook, `consumable_recipes_rdr2.xlsx`, and the patch workbook,
`rdr2_patch.xlsx`. Pass a folder to read the CSVs from elsewhere, `-c` for
another campfire workbook and `-p` for another patch.

Corrections go in the patch, never in `rdr2.db` — every build replaces the
database, so an edit made there is lost on the next one. The patch is applied
last. Its `animals` sheet updates animals by id: name, the weapon that leaves
the pelt unspoiled, the `bait` or lure that catches a fish, and a wiki `link`.
An animal's id stays put when its name changes (`animal-bear` is the Grizzly
Bear). Its `ingredient_animals` sheet is the whole of that table, and the build
lists every link it adds or drops against the other sources. Its `recipes`
sheet does the same for a recipe's name alone, by id — `recipe-explosive-slug`
keeps its id when the sheet renames it to Explosive Shotgun Slug, since the id
is derived from the name only at the CSV import a step earlier, and a patch
applied after that must not shift what the personal layer already has pinned
to it. `--check-ids` names the build being replaced: every ingredient,
recipe and location id in it must survive, because the personal layer stores
those strings, and the build fails if one is gone.

The build stamps a `meta` table with the date and schema version, which every
export records.

The CSVs are the Notion export with the hash taken off each name:
`Animals.csv`, `Animal Materials.csv`, `Misc Materials.csv`,
`Craftable Items.csv`, `Recipe Ingredients.csv`. Ids are slugs
derived from names (`ing-perfect-beaver-pelt`), so they survive rows being
added, removed or reordered — which matters, because the personal layer stores
those strings.

After a rebuild, or any change to the images or fonts, bump the release in
`js/version.js` — its `number` names the offline cache in `sw.js`, and Settings
shows it with its `date` as the tool version. The database, the wasm runtime,
the fonts and the artwork are cached hard — they are big and only ever replaced
wholesale — while app code is served network-first, so edits show up on reload
without a bump.

## Search pages

The app lives behind a `#` in the address and builds every card in the
browser, which a search engine sees as one empty page. So every material and
every recipe also gets a plain HTML page of its own, written from `rdr2.db`:

    python3 scripts/build_pages.py            # after every rebuild of rdr2.db
    python3 scripts/build_pages.py --check    # exit 1 if any page is stale

That writes `materials/<slug>/` and `recipes/<slug>/` — the slug is the id
without its prefix, so `ing-perfect-beaver-pelt` is
`materials/perfect-beaver-pelt/` — the A–Z lists `materials/` and `recipes/`,
and `sitemap.xml`. Like the database, they are generated and committed; never
edit one by hand. Each carries the facts the app's dialog does, in the app's
own stylesheet, and an "Open in the crafting guide" link to the same card in
the app (`#/materials/<id>`). Their only script is the theme line, which the
generator copies out of `index.html` along with the Content-Security-Policy
that allows it by hash, so the two never drift apart. Every link in them is
relative; the one absolute address, for canonical links and the sitemap, is
`SITE_URL` at the top of the script.

A material's or recipe's page keeps a reading width. The two A–Z lists take
the app's full width instead, in as many columns as fit, each as wide as the
longest name in its list so every name stays on one line; only on a phone does
the longest recipe wrap.

The service worker leaves these pages out of the offline cache. Offline, one
that was never loaded redirects to its card in the app instead.

## Hosting

The site is served from a folder of the user-site repository,
`arindam-bose/arindam-bose.github.io`, at `/adamslab/rdr2-crafting-guide/`,
beside the other tools under `adamslab/`. Three things follow from sharing
that domain:

- Search engines read `robots.txt` only at the root of a domain, so the
  sitemap is announced from the user-site repository's own `robots.txt`
  (`Sitemap: https://arindam-bose.github.io/adamslab/rdr2-crafting-guide/sitemap.xml`),
  one line per tool, and submitted in Google Search Console under a URL-prefix
  property for `https://arindam-bose.github.io/`.
- GitHub Pages uses one `404.html`, at the root of that repository, for every
  missing address on the domain -- this folder cannot have its own.
- Every tool shares one browser origin, so one localStorage, one IndexedDB and
  one cache storage. Everything this one keeps is named for it -- `rdr2:` keys,
  the `rdr2-personal` database, `rdr2-crafting-v*` caches -- and its service
  worker deletes only its own old caches, never another tool's. A new tool
  under `adamslab/` needs the same care.

## Layout

    index.html            shell: masthead, tabs, toast, footer
    materials/, recipes/  the search pages, generated (see Search pages)
    sitemap.xml           every one of them, generated
    app.css               one layout for phone and desktop, and the theme
    data/rdr2.db          reference data, read-only, built from data/raw/
    data/raw/             its sources: the Notion CSVs, the campfire
                          workbook and the patch workbook
    scripts/build_db.py   the build
    scripts/build_pages.py  the search pages, from the build
    fonts/
      marston/            Marston, the display face, with its licence
      fb_remington/       FB Remington, the body face
      rdr2_lino_regular/  RDR Lino Regular, the heading face
    images/               the logo and the favicons cut from it, the cover
                          art, and the station, tab, quality and coffee
                          icons, each in a parchment and a leather
                          colourway; images/icons/_source/ (not committed)
                          holds them at full size, to cut them again
    database/
      personal_schema.sql the personal layer's DDL, and the four queries
    js/
      db.js               open sql.js, create the personal tables
      store.js            ledger writes, IndexedDB, export/import, crafting
      queries.js          every read, as functions
      render.js           card and material-detail templates, and the
                          pieces they share (quality stars, station icons)
      dialog.js           the detail dialog every card opens: close
                          button, Esc, backdrop, repaint on a store change
      nav.js              the address: which page, and which card is open
      prefs.js            localStorage, guarded: theme, location, last export
      views/materials.js  "Where to go if you have these items"
      views/material-dialog.js
                          a material, opened -- the one dialog Materials
                          and Inventory both open
      views/inventory.js  entry: pick a location, search, tap +/-, and
                          the Transfer panel
      views/recipes.js    the catalogue, and the recipe dialog you craft in
      views/settings.js   stats, backup and restore, reset, About, and
                          the Support tile
      views/ledger.js     the history, as a dialog opened from Settings
      views/guide.js      About and How to use, as dialogs from Settings
      views/toolbar.js    search, chips, sort and pager, shared by the two
                          galleries
      toast.js            the undo toast, which follows an open dialog
      theme.js            parchment or leather, remembered per device
      main.js             boot and hash routing
      backup.js           backups: download, restore, and when one is due
      version.js          the release number and date, read by sw.js too
      mode-toggle-early.js
                          sets the mode switch before main.js has loaded
      file-protocol.js    explains why the page will not run from file://
    vendor/               sql.js, vendored so nothing is fetched from a CDN
    sw.js                 offline cache

## Look

### The colours

The palette is the five colours of the game's key art —
[#bd081a, #feac01, #b90303, #020002, #fffeff][palette] — declared verbatim at
the top of `app.css` as `--rdr-*`. Everything either theme paints is derived
from them.

There are two themes off that one palette. **Parchment** is the default: the
palette's white aged into paper, its black used as ink. **Leather** is the same
five colours after dark — that black warmed towards hide, that white warmed
towards parchment. Neither theme uses the raw pair, because pure `#020002`
under pure `#fffeff` is a glare to read a long list on.

Only the tokens at the top of `app.css` change between them. Nothing further
down the file knows which theme is on, which is the point of the split.

Then two signals, kept apart in both themes: **amber** is the one colour that
asks for a press — buttons, the lit tab, anything staged — and **red** only
ever means trouble, a material you are short of or data about to be thrown
away.

The line that keeps this working is that **red and amber are never decoration**.
Everything else warm on the page — `--ink-name` for the name of a material or a
recipe, `--ink-label` for the USED IN / LOCATIONS / INGREDIENTS captions, the
station stripes and icons, the hover edge — is chrome, and chrome never carries
status. A
name is a name whether or not you own the thing. Spend red on a heading and the
red count on a vendor's demand row below it stops meaning *you are short of
this*.

Each signal is two tokens, because a colour that fills a shape and a colour
that draws a word are not the same colour:

| | fills | draws |
|---|---|---|
| parchment | `--accent` `#feac01` | `--accent-text` `#8a5600` |
| leather | `--accent` `#feac01` | `--accent-text` `#feac01` |
| parchment | `--danger` `#bd081a` | `--danger-text` `#b90303` |
| leather | `--danger` `#bd081a` | `--danger-text` `#ec6a5a` |

Amber on paper is 1.4:1 and unreadable, so parchment draws with an ochre and
keeps the amber for button fills, where near-black sits on it at 8.9:1. The red
runs the other way: the raw palette red reads fine on paper and is 2.9:1 on
leather, so only leather needs a lit variant. Every colour that sets text
clears 4.5:1 against the surface it sits on, in both themes.

The station stripes are the one place colour is asked to identify rather than
to signal, and three warm hues at 3px are harder to tell apart than the blue,
yellow and pink they replaced. They are picked to separate in lightness as well
as hue — no two are closer than 1.26:1 — and, more to the point, the station is
always named in words beside its stripe. The colour reinforces the label; it is
never the only thing carrying it. Each station also has its own icon — a
stamped medallion, drawn in two colourways so its disc always matches the
text beside it — which stands in for the station's name after a recipe card's
title, and leads it on a demand row and in a dialog. Quality is drawn the
game's way, as a stamp of stars: grey for Perfect, gold for Legendary.
The Campfire takes a fourth, a muted sage, kept clear of the green of a tick so
that "made at your own fire" never reads as "you have enough".

The theme is a preference rather than data, so it lives in `localStorage` and
is per device — the same person reads this on a bright phone outdoors and a
dark screen at night. `index.html` applies it inline before the first paint,
after the stylesheet has loaded, so the choice never flashes and the script can
read the theme's own `--bg` back out of the CSS instead of keeping a second
copy of it. It is the one inline script, allowed by its hash — see Privacy,
enforced, before editing it.

### The lettering

Three faces, in three tiers. [Marston] by Neale Davidson is the loudest and the
rarest: the site's own name, a page's title and the tab bar. [RDR Lino Regular]
sets everything that reads as a header or a control rather than prose — a
card's name, a dialog's title, a section's caption, the switches and every
button's label. Both are caps-only display faces, so neither ever sets prose.
[FB Remington] by Fred Brutus sets everything else, which on these screens is
mostly numbers: `3/3`, `2x Oregano`, `$14.95`. It is monospaced, so those
columns line up on their own. All three are free, and all are vendored under
`fonts/`.

FB Remington ships one weight and no italic, so the browser synthesises both.
That is the right trade here rather than a compromise: a real Remington had one
weight too, and emphasis was struck twice over the same spot.

Its character set is a typewriter's, which is to say 152 codepoints. It has no
`×`, `✓`, `·`, `−`, `—` or `•`. A browser fills a gap like that from the next
font in the stack, which puts a second typeface inside `2× Oregano` at a
different width and weight — so nothing here asks for one. The app types what
the machine could type:

| was | is | where |
|---|---|---|
| `·` | `-` | separators: `Pearson - Sep 22, 12:49 AM` in the ledger |
| `×` | `x` | quantities: `2x Oregano` |
| `−` | `-` | the stepper, a negative delta |
| `—` | `--` | prose |

That costs nothing — the one `·` left is in `document.title`, which the browser
draws in its own font — and the page reads as one face throughout.

Made and open take the same checked or unchecked box the card's own corner
mark stamps — a small image, swapped by theme, not a character the font would
have to have — so a have/short ingredient or a used-in recipe never depends on
a glyph FB Remington lacks. Retired and plain have no such icon and stay as
type, each alone in a `.mark` span, `aria-hidden`: `–` for retired, `·` outside
personal mode, with the colour beside it already carrying the meaning where
one still applies. A gap there is contained in a way a gap mid-word is not, so
`.mark` gets its own stack rather than whatever the browser would otherwise
fall back to. The `×` on a dialog's close button is the same kind of thing, an
icon with an `aria-label`, and takes the same stack.

The last `•` was not the app's to type: seven saddles carried their five stat
lines as a Notion bulleted list, bullet characters and all, inside a single
`description`. That was a list pretending to be a paragraph. `build_db.py` now
strips the markers and stores one item per line, and the Recipes card renders a
multi-line description as a real `<ul>` whose marker is a CSS hyphen. The recipe
dialog goes one step further and splits each line at its colon, so the stat and
its value sit in two columns: `Stamina Drain Rate … -50%`. The
reference data is ASCII throughout apart from two non-breaking spaces, which
the font has.

The rule that assigns the two faces is the last thing in `app.css` on purpose:
every control in the file sets `font: inherit` to match the page rather than
the operating system, and that shorthand resets the family, so anything
assigned earlier loses.

[palette]: https://www.color-hex.com/color-palette/72703
[Marston]: https://www.pixelsagas.com/
[RDR Lino Regular]: http://www.onlinewebfonts.com
[FB Remington]: https://www.dafont.com/fb-remington.font

## State

All four screens work end to end.

### General and Personalize

A first visit opens in **General**: the reference data whole, useful before
anything is logged, rather than every card saying *You need to go hunting!*
over an empty ledger. **Personalize** folds in what you have. The first load
that finds no mode stored writes one down — General for a new visitor;
Personalize for a device that already holds data from before General was the
default, so nobody is switched over unasked. The choice is also held in memory,
so it still takes for the visit where storage is blocked.

General hides every personal control on Materials and Recipes, which leaves
Inventory as the one place a newcomer can log something. So the first save
there, in General, brings an invitation into Personalize above the list —
*Make the guide yours* — with *Not now*, which is remembered. Turning it on
shows the one-time note on where the data lives, the first moment it applies.

The masthead switch shows both words on a wide screen. On a phone it shows
only the one in force, small above the track, and the Back up button beside it
takes the same shape — its word above an outline the size of the track — with
a rule between them. The switch's tooltip names the mode it is in, then what a
tap does.

### The page around it

The cover art is shown full height on the first page of a visit, and settles
to a strip from the first change of tab, for the rest of the visit: it has been
seen, and the page under it is what you came for. Opening a card does not
count as moving on. The footer sits at the foot of the window however little a
page holds.

### Cards and dialogs

Both galleries are for scanning; the detail lives in a dialog. Clicking a card
anywhere — or its name, which is a real button, so the keyboard gets there too
— opens a native modal `<dialog>` with a close button, closed also by Esc or a
click on the backdrop. A click that ends a text selection does not open it:
that is someone copying a name. The dialog is shared (`js/dialog.js`) and
repaints whenever the store changes, keeping focus on the button just pressed,
so it never shows stale numbers. Its buttons act one at a time: a write
repaints the dialog only once it has reached IndexedDB, so until then a second
tap is ignored rather than crafting twice or taking stock below zero. The undo
toast moves inside an open dialog —
a modal sits in the top layer and makes the rest of the page inert, so a toast
left outside could be neither seen nor pressed.

### Cross-links

Every recipe named on the Materials page, and every material named on the
Recipes page and on Inventory's rows, is a link: tapping **Bear Batwing Chaps** on a
pelt's card lands on Recipes with that recipe already open, and tapping
**Perfect Bear Pelt** inside it comes straight back. They are real anchors
with real `href`s, so they can be middle-clicked, copied and tabbed to, and
drawn as the text around them with the underline turned most of the way down:
a card can carry a dozen, and a dozen loud links would be a page of blue.

A material named on Inventory opens its card there, at `#/inventory/<id>`,
rather than on Materials, so shutting it leaves you on your unsaved batch. It is
the same dialog either way (`views/material-dialog.js`). On Inventory its counts
include what is staged and not yet saved, as the rows do — its own steppers
write at once, and a `-` read off the saved count alone could take a stock
below zero once the batch lands.

What makes that work is that an open dialog is part of the address.
`#/recipes/<id>` is a page and a card, and every dialog in the app opens by
going there — including one opened by tapping a card on the page you are
already on, so there is one way in rather than two that can drift apart. The
address is also the way out: Back closes an open dialog, and closing one takes
the card out of the address without moving you off the page you are looking
at. Shutting a recipe you reached from a material is being done with that
recipe, not asking to be sent back to the material.

That leaves two ways to drop the card, and the history entry decides. Each one
the app pushes remembers what was underneath it. If that is the same page with
nothing open — a card tapped on the page you were already on — the entry is
handed back, because writing over it would leave it pointing where it already
pointed and Back would be a press that does nothing, once per card opened.
Anything else — a cross-link from the other page, a bookmark opened cold — is
written over in place: you stay put, and the entry left behind is a real one,
since what is beneath it is a different page. An id nothing answers to — a
stale bookmark, a recipe dropped from the reference data — leaves the page up
and quietly takes itself back out of the address.

### Materials

A material card is two captioned lists. **Used in** names the recipes it goes
into, ticked off as you make them, with the quantity spelled out when a recipe
takes more than one — `2x for Legendary Alligator Gambler's Hat`. Six are
shown; the five materials that go into more ask for the rest with a link, and
an opened list survives a rerender. **Vendors** has a row per vendor that
still wants it — `Pearson: 0/2` — with that vendor's colour down the left edge
and a progress bar on the right.

The dialog adds what the card leaves out: the animal, quality, type and the
weapon that leaves it unspoiled — or, for a fish, the bait or lure that
catches it. A material that comes off several animals (fat, the meats, Flight
Feather) lists them instead, each with its own weapon or bait. Every animal's
name links to its page on the Red Dead wiki, in a new tab. Then every recipe with a Crafted / Not crafted /
Skipped tag; each vendor's demand against what you hold where it draws from — the
Fence names your Satchel — and the verdict, *You need to go hunting!* and its
siblings. The dialog's own copy of the recipe list spells out `1x` too, unlike
the card's: a bare name there reads as though the amount were left off rather
than being one, where the card stays tight on room for a list that can run to
a dozen recipes. Each station row has `-` and `+ Add to Trapper` buttons. These write
at once, one ledger row per tap with an undo toast, rather than staging a
batch as Inventory does: here you are logging one thing and looking straight
at the result. In personal mode a station with nothing left to make still
shows, as *needs no more*, since you may be holding some there to sell.

The tabs are Animal Materials, Plants and Supplies — a hunting trip, a walk,
and a shop or a detour — each carrying the count that matches the current
filters, so a search that landed on another tab is visible rather than lost.
Supplies holds ammunition and throwables, liquor, and the misc items. The
category filter lists the animal parts (Pelt, Hide, Meat, Fat, Feather, …) and
the three kinds of supply, which have no part; picking a category also
switches to the tab its materials are on.

A material used in campfire recipes gets a **Campfire** block on its card
showing how many you hold in the Satchel, and a Campfire row in the dialog —
*Use it in Campfire, have 3 / in your Satchel*, worded as something to do with
your own count rather than as a vendor asking — with the same `-` /
`+ Add to Satchel` buttons. The Campfire never *needs*
anything, so it adds nothing to the verdict, and a material used only there
is never Still needed or Done: it shows under All, always.

### Recipes

Two tabs: **Vendor recipes**, made once and worked towards, and **Campfire**,
made at your own fire as often as you have the ingredients. Each tab carries
its count of the current matches, and has its own categories. The vendor chips
and the Ready / Crafted chips only appear on the vendor tab.

A campfire recipe is only ever looked up. It has no switch and no Craft
button, is never crafted or skipped, and its price is labelled *Recipe*: it is
what the recipe cost to buy, once. Where it takes any one of several
ingredients the line reads `2x ANY OF Blackcurrant (1) / Golden Currant (0) /
Prairie Poppy (2)`, with how many of each you hold in the Satchel; the tick
means one of them alone covers the amount, since a slot cannot be made up from
a mix.

A vendor recipe card has its name with its vendor's icon, its price, its buff and an
**Ingredients** list with have/need tallies. A crafted or skipped recipe is
dimmed, carries a dashed *Crafted* or *Skipped* tag, and sorts to the bottom.
The card has no buttons.

The dialog lays out the type, vendor, set and price, the description, the
ingredients, and the two things you can do:

- **Craft** spends the ingredients from the station's own stock and marks the
  recipe done, as one commit with undo. It is always present and disabled when
  it cannot be used, with the reason written beside it — what is still
  missing, or that the recipe is made or skipped — rather than in a tooltip a
  phone cannot show.
- **The switch** in the corner reads *Skip / Want it* while a recipe is not
  made, and *Put back / Crafted* once it is. Skipping retires a recipe without
  spending anything — only the target's state is written. Putting back refunds
  the ingredients and wants the recipe again.

Once a recipe is crafted its ingredient list drops the checkboxes and
tallies: the ingredients were spent making it, and a row of them still marked
short under something already made reads as a shortfall.

A recipe that is done or skipped stops asking for its materials, so it drops out
of the Materials screen. Demand is per station, so that only removes the demand
at *that* station: a material two recipes want still shows for the other one.

### Filtering and sorting

Both galleries share one toolbar: the search box on a row of its own, then a
category dropdown, the stations in the order Pearson, Trapper, Fence, the
personal filters, and the sort, all left-aligned, with the count on the right.
The Materials search matches a material's name, and the animals it comes from
from the start of a word, so *wolf* finds Big Game Meat as well as the wolf
pelts and *perch* finds Flaky Fish Meat, while *ox* finds Prime Beef Joint
through the Ox without dragging in Stringy Meat through the Fox. Inventory's
search follows the same rule. The Recipes search also reads sets,
vendors, buffs and ingredients.
In personal mode Materials filters to **Still needed** or **Done** — a
material whose recipes are all crafted or skipped moves to Done rather than
vanishing — and Recipes to **Ready to craft** or **Crafted**.

Sorting is a field and a direction rather than a list of every combination:
Materials by what is still needed, quality or name; Recipes by name or by how
many items they swallow. Both open on name, A–Z. The direction button says what it does — "Most
first", "Legendary first", "A-Z" — each field starts in the direction you
nearly always want, and the choice is remembered per screen.

Both galleries show 20 cards at a time, with Show more adding another 20 and
Show less returning to the first 20. Changing a filter, a tab or the sort starts
the list over at 20; a store change — crafting something — does not, so you keep
your place.

### Inventory

Inventory lists what you are holding at the selected location first — *In the
Satchel*, *With Trapper*, *With Pearson*, each with a count of the rows under
it — then what you logged recently, so it reads as a stock list rather than
only a search box. Each row also reports how many have passed through your
hands there and how many went into crafting, read from `inventory_totals` — the
same ledger as `inventory`, without the balance's habit of dropping rows that
netted to zero. `qty <= gathered` holds by construction, since one sums every
delta and the other only the positive ones.

Inventory stages rather than writes. Steppers adjust a pending batch; Save
commits the lot as one SQLite transaction and one IndexedDB transaction, one
ledger row per material and location however many taps went into it. Undo works
at the level of the commit. Staged edits survive a tab switch — a dot appears on
the Inventory tab — and the browser warns before you close the page with any
outstanding.

A material a vendor wants can be handed over rather than counted twice. Its row
carries a **Transfer to** button — an outlined pill with the icon of each place
it can go, where the stepper is filled squares, so the two are told apart by
shape before anyone reads them; on a phone it sits under the name, a row's width
from the stepper. It opens a small panel (a sheet along the bottom on a phone)
naming the material, where it is moving from and how many are there, with a
labelled stepper per destination: from the Satchel to whichever of Pearson and
the Trapper want it, or from a vendor back to the Satchel. The Fence gets none —
it spends straight from the Satchel. A transfer stages like any other change and
saves as two ledger rows, one out and one in, both `move`; sending some back
before saving cancels against what is already staged rather than piling up. The
button only shows while there is something to move or something on its way out.

A plus is recorded as the thing that most likely caused it (`kill` for an animal
material, `loot` otherwise); a minus as a `correction`, since that is nearly
always what it is. The same rule (`store.reasonFor`) holds for the buttons in a
material's dialog, and every screen names a location the same way: *in the
Satchel*, *with Pearson*.

### Settings and the ledger

**Your stats** is a scoreboard over the same ledger and targets: materials
held, recipes crafted against the 165 that can be, recipes skipped, money
spent crafting, and how many of the sixteen wearable outfits are complete —
every piece in a set crafted, not just started. Below that, two breakdowns
with a bar each, by vendor and by category. All of it, the outfit count
included, only ever counts the one-time vendor recipes: a campfire recipe has
no crafted/not-crafted state to tally (see Two layers, above), so it sits
outside every number on this panel. Categories are stored singular (`Boot`,
not `Boots`) so the Recipes filter reads as one kind of thing; this panel
pluralises them back on the way out, since a tally is a count of several.

The ledger opens as a dialog from the *Ledger entries* count in Settings — it is
the one thing here that grows without limit, and a page that is mostly history
buries the controls underneath it. It lists what changed, where, when and why,
newest first and paged, with the recipe named on a crafting row. An entry naming
a material this build does not know is shown with its raw slug and flagged,
rather than quietly disappearing. It is read-only: the ledger is append-only by
design, so a mis-entry is corrected with another row or undone from the toast at
the time, not edited afterwards.

Settings is also where the personal layer can be moved. **Take it with you**
says when this device was last backed up and how many changes have been made
since. Export writes the whole ledger as a JSON file, named for the moment it
was taken on the reader's own clock — `rdr2_inventory_2026-10-05_18-36-09.json`,
the time hyphenated since Windows refuses a colon, and to the second so two
backups on one day never overwrite each other — the balances are derived from it, so exporting only the
balances would lose the history behind "8 gathered - 1 crafted". A
copy-to-clipboard button sits beside it, because `<a download>` is unreliable on
iOS, and a paste box sits beside the file picker for the same reason.

Import **replaces** rather than merges, and says so before it writes: a ledger
id counts up per device, so two devices' rows cannot be told apart and merging
would double anything imported twice. One device is the source of truth. A file
is inspected first — a `reason` the schema's CHECK would refuse is caught before
the transaction rather than halfway through it, and rows naming materials this
build does not know are reported rather than swallowed, since the ledger stores
slugs with no foreign key.

**Support the guide**, beside About, is the one tile lit in the accent and
holds the one filled button on the page: *Buy me a coffee*, a plain link to
buymeacoffee.com in a new tab. Not that site's widget or button image — those
load from its servers, which the policy blocks and the privacy promise rules
out.
