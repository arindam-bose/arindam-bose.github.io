#!/usr/bin/env python3
"""
Build rdr2.db from the Notion 'RDR2 Databases' CSV export, the
campfire-recipe workbook, and a patch workbook of corrections.

Usage:
    python3 build_db.py [export_dir] [-c workbook.xlsx] [-p patch.xlsx]
                        [-o data/rdr2.db] [--check-ids data/rdr2.db]

[export_dir] is the folder holding the five exported CSVs, renamed
without Notion's hash: Animals.csv, Animal Materials.csv, Misc
Materials.csv, Craftable Items.csv, Recipe Ingredients.csv.  It
defaults to data/raw, where the workbook lives too.

The workbook holds the consumable recipes -- made at your own campfire,
as often as you have the ingredients -- and four index sheets of the
ingredients they call for.

The patch workbook is applied last, and is where the reference data is
corrected rather than in the database itself, which every build
replaces.  Its 'animals' sheet updates animals by id -- name, weapon,
bait for the fish, a wiki link -- and adds any it names that are new.
Its 'ingredient_animals' sheet is the whole of that table: the build
reports every link it adds or drops against what the other sources
said.  Its 'recipes' sheet renames recipes by id, the same way
'animals' does, without touching the id a name change would otherwise
produce.

--check-ids names an earlier build.  Every ingredient, recipe and
location id in it must still be produced, because the personal layer
stores those strings and has no other way to find its rows again.  It
is read before anything is written, so it may be the output file.

Requires: pandas, openpyxl.  Everything else is the standard library.
"""

import argparse
import datetime
import os
import re
import sqlite3
import sys

import pandas as pd

# --------------------------------------------------------------------------
# reference constants
# --------------------------------------------------------------------------

# Bumped when the shape of the generated database changes.
SCHEMA_VERSION = "3"

# where materials are stored
LOCATIONS = ["Satchel", "Trapper", "Pearson"]

# crafting station -> (kind, card colour, stock it draws from)
STATIONS = {
    "Trapper":  ("merchant", "blue",   "Trapper"),
    "Pearson":  ("merchant", "yellow", "Pearson"),
    "Fence":    ("merchant", "pink",   "Satchel"),
    "Campfire": ("campfire", "green",  "Satchel"),
}

# workbook sheet -> ingredients.source_type for the rows it lists
INGREDIENT_SHEETS = {
    "animal-ingredients":  "animal",
    "weapon-ingredients":  "ammo",
    "plant-ingredients":   "plant",
    "alcohol-ingredients": "alcohol",
}

# what part of the animal a workbook material is, from its last word;
# the Notion materials name theirs in a column of their own
BODY_PARTS = {
    "Meat": "Meat", "Mutton": "Meat", "Loin": "Meat", "Joint": "Meat",
    "Fat": "Fat", "Feather": "Feather", "Glands": "Gland",
}

# ordinal warmth scale, derived from the description text at build time.
# Keyed on the phrase itself rather than the full sentence around it, so
# the boilerplate that follows -- "pair with other warm items...", which
# has changed wording before -- can keep changing without silently
# dropping warmth_rank to NULL; see warmth_of below.
WARMTH = {
    "lightweight":     0,
    "slightly warm":   1,
    "reasonably warm": 2,
    "warm":            3,
    "very warm":       4,
}

# typos in the source data, corrected on import
TEXT_FIXES = {
    "Increases Stamina XP bounus by 10%": "Increases Stamina XP bonus by 10%",
    "Increases Heath XP by 10%":          "Increases Health XP by 10%",
}

SCHEMA = """
PRAGMA foreign_keys = ON;

-- Stamped at build time so the app can say which reference data it
-- is showing, and an export can record which build it came from.
CREATE TABLE meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

-- Every id is a prefixed slug derived from the row's name: stable across
-- rebuilds, self-describing wherever it turns up loose (URLs, the personal
-- layer's ledger, logs).

CREATE TABLE weapons (
    id    TEXT PRIMARY KEY,          -- weapon-sniper-rifle
    name  TEXT NOT NULL UNIQUE
);

-- An animal is hunted with a weapon, or -- a fish -- caught with a bait
-- or lure; bait is free text ("River lures, Worm, Cricket").  The id
-- stays put when a name is corrected (animal-bear is the Grizzly Bear).
CREATE TABLE animals (
    id         TEXT PRIMARY KEY,     -- animal-bear
    name       TEXT NOT NULL UNIQUE,
    weapon_id  TEXT REFERENCES weapons(id),
    bait       TEXT,
    link       TEXT                  -- the animal's wiki page
);

-- where materials are stored
CREATE TABLE locations (
    id    TEXT PRIMARY KEY,          -- loc-satchel
    name  TEXT NOT NULL UNIQUE
);

-- where crafting happens; each station draws from one stock
CREATE TABLE stations (
    id           TEXT PRIMARY KEY,   -- station-trapper
    name         TEXT NOT NULL UNIQUE,
    kind         TEXT NOT NULL,
    color        TEXT,
    location_id  TEXT NOT NULL REFERENCES locations(id)
);

CREATE TABLE sets (
    id        TEXT PRIMARY KEY,      -- set-the-desperado
    name      TEXT NOT NULL UNIQUE,
    set_type  TEXT NOT NULL CHECK (set_type IN ('merchant','outfit','camp_area'))
);

-- things you collect
CREATE TABLE ingredients (
    id           TEXT PRIMARY KEY,   -- ing-perfect-beaver-pelt
    name         TEXT NOT NULL UNIQUE,
    source_type  TEXT NOT NULL
                 CHECK (source_type IN ('animal','misc','plant','ammo','alcohol')),
    quality      TEXT CHECK (quality IN ('Perfect','Legendary')),
    body_part    TEXT
);

-- which animals a material comes from: one for a pelt, a dozen for fat
CREATE TABLE ingredient_animals (
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    animal_id      TEXT NOT NULL REFERENCES animals(id),
    PRIMARY KEY (ingredient_id, animal_id)
);

-- things you craft.  A one-time recipe is made once at a merchant and
-- tracked; a repeatable one is made at your own campfire as often as
-- you like, and is only ever shown -- never crafted, never ticked off.
-- For those, price_cents is the one-time cost of buying the recipe.
CREATE TABLE recipes (
    id           TEXT PRIMARY KEY,   -- recipe-billy-vest
    name         TEXT NOT NULL UNIQUE,
    category     TEXT,
    station_id   TEXT REFERENCES stations(id),
    set_id       TEXT REFERENCES sets(id),
    price_cents  INTEGER NOT NULL DEFAULT 0,
    description  TEXT,
    warmth_rank  INTEGER,            -- derived from description at build time
    repeatable   INTEGER NOT NULL DEFAULT 0 CHECK (repeatable IN (0,1))
);

-- A recipe asks for its ingredients in slots.  Rows sharing a slot are
-- interchangeable -- any one sage will do -- and carry the slot's qty,
-- which must be taken all of one kind.  A slot with one row is a plain
-- ingredient, which is every slot of every one-time recipe.
CREATE TABLE recipe_ingredients (
    recipe_id      TEXT NOT NULL REFERENCES recipes(id),
    slot           INTEGER NOT NULL CHECK (slot > 0),
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    qty            INTEGER NOT NULL CHECK (qty > 0),
    PRIMARY KEY (recipe_id, ingredient_id)
);

CREATE INDEX idx_ingredients_source ON ingredients(source_type);
CREATE INDEX idx_ia_animal          ON ingredient_animals(animal_id);
CREATE INDEX idx_recipes_category   ON recipes(category);
CREATE INDEX idx_recipes_station    ON recipes(station_id);
CREATE INDEX idx_ri_slot            ON recipe_ingredients(recipe_id, slot);
CREATE INDEX idx_ri_ingredient      ON recipe_ingredients(ingredient_id);
"""

# --------------------------------------------------------------------------
# parsing helpers
# --------------------------------------------------------------------------

# Notion exports relations as:  Name (https://app.notion.com/p/Slug-hex?pvs=21)
RELATION_RE = re.compile(r"([^,][^(]*?)\s*\(https?://[^)]+\)")


def parse_relation(cell):
    """Return the linked page names in a Notion relation cell."""
    if pd.isna(cell):
        return []
    return [m.strip() for m in RELATION_RE.findall(str(cell))]


def clean(text):
    """Normalise curly apostrophes so 'Trapper's' matches everywhere."""
    if pd.isna(text):
        return None
    return str(text).replace("\u2019", "'").strip()


def parse_price(cell):
    """'$40.00' -> 4000 ; blank or '$0.00' -> 0"""
    if pd.isna(cell):
        return 0
    digits = re.sub(r"[^0-9.]", "", str(cell))
    return int(round(float(digits) * 100)) if digits else 0


def unbullet(text):
    """
    Notion writes a multi-line buff as a bulleted list, indenting every item
    after the first: '\u2022 A\n  \u2022 B'.  Keep the list and drop the
    typography, one item per line with no marker.

    The bullet is a character the app cannot set -- the page is typed in a
    typewriter face with a typewriter's 152 glyphs -- and it was never
    content in the first place.  The Recipes page puts markers back as a
    <ul>, which is what this always was.
    """
    if "\u2022" not in text:
        return text
    return "\n".join(part for part in
                     (p.strip() for p in text.split("\u2022")) if part)


def warmth_of(text):
    """The WARMTH phrase this text contains, longest first so "slightly
    warm" wins over the bare "warm" inside it -- sorted here rather than
    trusted to WARMTH's own order, which is free to change."""
    lowered = text.lower()
    for phrase in sorted(WARMTH, key=len, reverse=True):
        if phrase in lowered:
            return WARMTH[phrase]
    return None


def parse_description(buff):
    """
    Keep the Notion 'Buff' text, less its bullet characters, and derive an
    ordinal warmth rank where one applies.  The text stays the single source
    of truth; the rank is recomputed on every build.
    """
    if pd.isna(buff) or not str(buff).strip():
        return None, None
    text = str(buff).strip()
    text = TEXT_FIXES.get(text, text)
    text = unbullet(text)
    return text, warmth_of(text)


def mkid(prefix, name):
    """('ing', 'Perfect Beaver Pelt') -> 'ing-perfect-beaver-pelt'.

    Derived from the name rather than a counter, so ids survive rows being
    added, removed or reordered in the source CSVs.  The personal layer
    lives in a different database file and cannot use foreign keys against
    these rows, so it stores these strings."""
    slug = re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", name.lower())).strip("-")
    return f"{prefix}-{slug}"


def classify_set(name, categories):
    """merchant collection / wearable outfit / camp area"""
    if name.endswith("Collection"):
        return "merchant"
    if categories == {"Camp"}:
        return "camp_area"
    return "outfit"


# one line of a workbook recipe:  '2x (Blackcurrant / Golden Currant)'
SLOT_RE = re.compile(r"^(\d+)\s*x\s+(.+)$")


def balanced(text):
    """Every bracket closes, and none closes before it opens."""
    depth = 0
    for ch in text:
        depth += {"(": 1, ")": -1}.get(ch, 0)
        if depth < 0:
            return False
    return depth == 0


def closes_at_end(text):
    """'(A / B)' -> True ; '(A) / (B)' -> False: the first bracket's pair
    is the last character, so the brackets wrap the whole of it."""
    depth = 0
    for i, ch in enumerate(text):
        depth += {"(": 1, ")": -1}.get(ch, 0)
        if depth == 0:
            return i == len(text) - 1
    return False


def parse_slots(cell):
    """
    '1x Arrow + 2x (Eagle Feather / Hawk Feather)'
        -> [(1, ['Arrow']), (2, ['Eagle Feather', 'Hawk Feather'])]

    Returns (slots, problems); a part that does not parse is reported
    rather than guessed at.
    """
    slots, problems = [], []
    for part in str(cell).split("+"):
        part = " ".join(part.split())
        if not part:
            continue
        m = SLOT_RE.match(part)
        if not m:
            problems.append(part)
            continue
        # Brackets around the whole choice go; any inside a name stay.
        # A bracket left open or closed twice is a typo in the sheet, and
        # would otherwise end up inside a name, so it is reported too.
        choice = m.group(2).strip()
        if not balanced(choice):
            problems.append(part)
            continue
        if choice.startswith("(") and closes_at_end(choice):
            choice = choice[1:-1]
        options = [clean(o) for o in choice.split("/")]
        slots.append((int(m.group(1)), [o for o in options if o]))
    return slots, problems


def split_list(cell):
    """'a, b, c' -> ['a', 'b', 'c'] ; blank -> []"""
    if pd.isna(cell):
        return []
    return [clean(x) for x in str(cell).split(",") if clean(x)]


def load(export_dir, stem):
    """Load one exported CSV by name: 'Animals' -> Animals.csv."""
    path = os.path.join(export_dir, stem + ".csv")
    if not os.path.exists(path):
        sys.exit(f"error: no {stem}.csv in {export_dir}")
    return pd.read_csv(path)


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

def build(export_dir, consumables, patch, out_path):
    animals_df  = load(export_dir, "Animals")
    animal_mat  = load(export_dir, "Animal Materials")
    misc_mat    = load(export_dir, "Misc Materials")
    craftable   = load(export_dir, "Craftable Items")
    ing_rows    = load(export_dir, "Recipe Ingredients")

    if os.path.dirname(out_path):
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if os.path.exists(out_path):
        os.remove(out_path)

    db = sqlite3.connect(out_path)
    db.executescript(SCHEMA)
    warnings, added = [], []

    # ---- meta ---------------------------------------------------------
    db.executemany("INSERT INTO meta(key, value) VALUES (?,?)", [
        ("schema_version", SCHEMA_VERSION),
        ("built_at", datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d")),
        ("source", "Notion 'RDR2 Databases' export"
                   + (f" + {os.path.basename(consumables)}" if consumables else "")
                   + (f" + {os.path.basename(patch)}" if patch else "")),
    ])

    # ---- weapons ------------------------------------------------------
    db.executemany("INSERT INTO weapons(id, name) VALUES (?,?)",
                   [(mkid("weapon", w), w)
                    for w in sorted({w.strip()
                                     for w in animals_df["Weapon"].dropna()})])
    weapon_id = dict(db.execute("SELECT name, id FROM weapons"))

    # ---- animals ------------------------------------------------------
    db.executemany(
        "INSERT INTO animals(id, name, weapon_id) VALUES (?,?,?)",
        [(mkid("animal", clean(r["Animal Name"])), clean(r["Animal Name"]),
          weapon_id.get(str(r["Weapon"]).strip()))
         for _, r in animals_df.iterrows()])
    animal_id = dict(db.execute("SELECT name, id FROM animals"))

    # ---- locations and stations ---------------------------------------
    db.executemany("INSERT INTO locations(id, name) VALUES (?,?)",
                   [(mkid("loc", n), n) for n in LOCATIONS])
    location_id = dict(db.execute("SELECT name, id FROM locations"))
    db.executemany(
        "INSERT INTO stations(id, name, kind, color, location_id) "
        "VALUES (?,?,?,?,?)",
        [(mkid("station", n), n, k, c, location_id[loc])
         for n, (k, c, loc) in STATIONS.items()])
    station_id = dict(db.execute("SELECT name, id FROM stations"))

    # ---- sets ----------------------------------------------------------
    craftable["_set"] = craftable["Set"].map(clean)
    for name, cats in craftable.groupby("_set")["Category"].apply(set).items():
        db.execute("INSERT INTO sets(id, name, set_type) VALUES (?,?,?)",
                   (mkid("set", name), name, classify_set(name, cats)))
    set_id = dict(db.execute("SELECT name, id FROM sets"))

    # ---- ingredients: animal materials ---------------------------------
    for _, r in animal_mat.iterrows():
        name = clean(r["Material Name"])
        quality = r.get("Quality")
        db.execute(
            "INSERT INTO ingredients(id, name, source_type, quality, "
            "body_part) VALUES (?,?,'animal',?,?)",
            (mkid("ing", name), name,
             quality if quality in ("Perfect", "Legendary") else None,
             clean(r.get("Body Part"))))
        for source in parse_relation(r.get("Animals")):
            aid = animal_id.get(clean(source))
            if aid is None:
                warnings.append(f"{name!r}: unknown animal {source!r}")
                continue
            db.execute("INSERT OR IGNORE INTO ingredient_animals"
                       "(ingredient_id, animal_id) VALUES (?,?)",
                       (mkid("ing", name), aid))

    # ---- ingredients: misc ----------------------------------------------
    db.executemany(
        "INSERT INTO ingredients(id, name, source_type) VALUES (?,?,'misc')",
        [(mkid("ing", clean(r["Item Name"])), clean(r["Item Name"]))
         for _, r in misc_mat.iterrows()])
    ingredient_id = dict(db.execute("SELECT name, id FROM ingredients"))

    # ---- recipes ---------------------------------------------------------
    price_col = next(c for c in craftable.columns if c.strip() == "Price")
    for _, r in craftable.iterrows():
        description, warmth = parse_description(r.get("Buff"))
        db.execute(
            "INSERT INTO recipes(id, name, category, station_id, set_id, "
            "price_cents, description, warmth_rank) VALUES (?,?,?,?,?,?,?,?)",
            (mkid("recipe", clean(r["Item Name"])),
             clean(r["Item Name"]), clean(r.get("Category")),
             station_id.get(clean(r.get("Merchant"))),
             set_id.get(clean(r.get("Set"))),
             parse_price(r[price_col]), description, warmth))
    recipe_id = dict(db.execute("SELECT name, id FROM recipes"))

    # ---- recipe_ingredients ----------------------------------------------
    # Notion has no alternatives, so each ingredient is a slot of its own,
    # numbered in the order the export first lists it.
    pairs = {}
    for _, r in ing_rows.iterrows():
        recipe = clean(r["Recipe Name"])
        rid = recipe_id.get(recipe)
        if rid is None:
            warnings.append(f"ingredient row: unknown recipe {recipe!r}")
            continue
        names = (parse_relation(r.get("Animal Materials"))
                 + parse_relation(r.get("Misc. Materials")))
        if not names:
            warnings.append(f"{recipe!r}: ingredient row names no material")
            continue
        qty = 1 if pd.isna(r["Amount Needed"]) else int(r["Amount Needed"])
        for n in names:
            iid = ingredient_id.get(clean(n))
            if iid is None:
                warnings.append(f"{recipe!r}: unknown ingredient {n!r}")
                continue
            pairs[(rid, iid)] = pairs.get((rid, iid), 0) + qty

    slots = {}
    rows = []
    for (rid, iid), q in pairs.items():
        slots[rid] = slots.get(rid, 0) + 1
        rows.append((rid, slots[rid], iid, q))
    db.executemany(
        "INSERT INTO recipe_ingredients(recipe_id, slot, ingredient_id, qty) "
        "VALUES (?,?,?,?)", rows)

    # The patch is read before the campfire workbook, though applied
    # after it, so that the workbook can name an animal by either name
    # it has had: "Bear" as Notion knows it, or "Grizzly Bear" as the
    # patch renames it.  Both are the one animal, animal-bear.
    book = load_patch(patch) if patch else None
    aliases = {}
    if book is not None:
        for _, r in book["animals"].iterrows():
            if blank(r.get("id")) and blank(r.get("name")):
                aliases[blank(r.get("name"))] = blank(r.get("id"))

    fresh = set()                 # ids the workbook made that the patch names
    if consumables:
        build_consumables(db, consumables, animal_id, aliases,
                          station_id["Campfire"], warnings, added, fresh)

    notes = []
    if added:
        notes.append(f"the campfire workbook added {len(added)} animals: "
                     + ", ".join(sorted(added)))
    if book is not None:
        apply_patch(db, book, warnings, notes, fresh)

    db.commit()
    return db, warnings, notes


def blank(value):
    """A spreadsheet cell as a value: None for empty, trimmed text otherwise."""
    if value is None or pd.isna(value):
        return None
    return str(value).strip() or None


def load_patch(path):
    """The patch workbook's two sheets, or a clean exit if one is missing."""
    book = pd.read_excel(path, sheet_name=None, dtype=str)
    for sheet in ("animals", "ingredient_animals", "recipes"):
        if sheet not in book:
            sys.exit(f"error: no {sheet!r} sheet in {path}")
    return book


def apply_patch(db, book, warnings, notes, fresh=frozenset()):
    """
    Apply the patch workbook: corrections made by hand, kept as a source
    so that a rebuild keeps them.  See the module docstring.

    `fresh` are animals the campfire workbook had to add bare, under the
    id the patch gives them: they are the patch's new animals, and are
    reported as that, though their rows already exist.
    """
    # ---- animals: update by id, insert what is new -------------------------
    known = {i: n for i, n in db.execute("SELECT id, name FROM animals")}
    weapons = {i for (i,) in db.execute("SELECT id FROM weapons")}
    seen = set()
    for _, r in book["animals"].iterrows():
        aid, name = blank(r.get("id")), blank(r.get("name"))
        if not aid or not name:
            continue
        seen.add(aid)
        weapon, bait, link = (blank(r.get(c)) for c in ("weapon_id", "bait", "link"))
        if weapon and weapon not in weapons:
            warnings.append(f"{name!r}: unknown weapon {weapon!r}, left blank")
            weapon = None
        if not weapon and not bait:
            warnings.append(f"{name!r}: neither a weapon nor a bait")
        if aid in known:
            if aid in fresh:
                notes.append(f"new animal {name!r} ({aid})")
            elif known[aid] != name:
                notes.append(f"renamed {known[aid]!r} -> {name!r} ({aid})")
            db.execute("UPDATE animals SET name = ?, weapon_id = ?, bait = ?, "
                       "link = ? WHERE id = ?", (name, weapon, bait, link, aid))
        else:
            notes.append(f"new animal {name!r} ({aid})")
            db.execute("INSERT INTO animals(id, name, weapon_id, bait, link) "
                       "VALUES (?,?,?,?,?)", (aid, name, weapon, bait, link))
    for aid in sorted(set(known) - seen):
        warnings.append(f"{known[aid]!r} ({aid}) is not in the patch: "
                        "no bait or link")

    # ---- ingredient_animals: the patch is the whole table -------------------
    animals = {i for (i,) in db.execute("SELECT id FROM animals")}
    ingredients = {i for (i,) in db.execute("SELECT id FROM ingredients")}
    links = set()
    for _, r in book["ingredient_animals"].iterrows():
        iid, aid = blank(r.get("ingredient_id")), blank(r.get("animal_id"))
        if not iid or not aid:
            continue
        if iid not in ingredients or aid not in animals:
            warnings.append(f"link {iid} -> {aid}: unknown "
                            f"{'ingredient' if iid not in ingredients else 'animal'}")
            continue
        links.add((iid, aid))

    before = set(db.execute("SELECT ingredient_id, animal_id FROM ingredient_animals"))
    for iid, aid in sorted(links - before):
        notes.append(f"link added: {iid} <- {aid}")
    for iid, aid in sorted(before - links):
        warnings.append(f"link dropped: {iid} <- {aid}")
    db.execute("DELETE FROM ingredient_animals")
    db.executemany("INSERT INTO ingredient_animals(ingredient_id, animal_id) "
                   "VALUES (?,?)", sorted(links))

    # ---- recipes: rename by id, id itself untouched -------------------------
    known_recipes = {i: n for i, n in db.execute("SELECT id, name FROM recipes")}
    for _, r in book["recipes"].iterrows():
        rid, name = blank(r.get("id")), blank(r.get("name"))
        if not rid or not name:
            continue
        if rid not in known_recipes:
            warnings.append(f"recipe patch: unknown id {rid!r}")
            continue
        if known_recipes[rid] != name:
            notes.append(f"renamed {known_recipes[rid]!r} -> {name!r} ({rid})")
            db.execute("UPDATE recipes SET name = ? WHERE id = ?", (name, rid))


def build_consumables(db, path, animal_id, aliases, campfire, warnings, added,
                      fresh):
    """
    Add the workbook's campfire recipes and the ingredients they call for.

    Ingredients are matched by name, so a material both kinds of recipe
    use -- Eagle Feather -- stays the one row, keeps its id, and only
    gains any source animals the workbook adds.  Animals the Notion
    export never listed (fish, crabs, the odd bird) are added bare, with
    no weapon, and reported, so a misspelling shows up as a new animal
    rather than going unnoticed.
    """
    book = pd.read_excel(path, sheet_name=None, dtype=str)
    if "consumable-recipes" not in book:
        sys.exit(f"error: no 'consumable-recipes' sheet in {path}")

    ingredient_id = dict(db.execute("SELECT name, id FROM ingredients"))
    used_in = {}                  # ingredient name -> recipe names, per index
    known_as = {aid: name for name, aid in animal_id.items()}   # id -> a name

    # ---- ingredients ----------------------------------------------------
    for sheet, source_type in INGREDIENT_SHEETS.items():
        if sheet not in book:
            sys.exit(f"error: no {sheet!r} sheet in {path}")
        df = book[sheet]
        name_col = "animal_produce" if "animal_produce" in df else "name"
        for _, r in df.iterrows():
            name = clean(r[name_col])
            if not name:
                continue
            used_in[name] = set(split_list(r.get("recipes_used_in")))
            iid = ingredient_id.get(name)
            if iid is None:
                iid = mkid("ing", name)
                part = None
                if source_type == "animal":
                    part = BODY_PARTS.get(name.split()[-1])
                    if part is None:
                        warnings.append(f"{name!r}: no body part for its last word")
                db.execute(
                    "INSERT INTO ingredients(id, name, source_type, body_part) "
                    "VALUES (?,?,?,?)", (iid, name, source_type, part))
                ingredient_id[name] = iid
            else:
                have = db.execute("SELECT source_type FROM ingredients "
                                  "WHERE id = ?", (iid,)).fetchone()[0]
                if have != source_type:
                    warnings.append(f"{name!r}: already a {have} material, "
                                    f"{sheet} calls it {source_type}")
            for animal in split_list(r.get("animals_to_source_from")):
                # Known by this name already; else by the patch, under the
                # id the patch gives it -- which may already be here under
                # its old name; else new, with an id made from the name.
                # An id made from a name can land on an animal already
                # here under another spelling ("bear", "Bear"): that is
                # taken to be the one animal, but said, since it may be
                # a typo that happens to collide.
                aid = animal_id.get(animal)
                if aid is None:
                    alias = aliases.get(animal)
                    aid = alias or mkid("animal", animal)
                    if aid not in known_as:
                        db.execute("INSERT INTO animals(id, name) VALUES (?,?)",
                                   (aid, animal))
                        known_as[aid] = animal
                        # One the patch names is the patch's to report.
                        if alias:
                            fresh.add(aid)
                        else:
                            added.append(animal)
                    elif not alias:
                        warnings.append(f"{animal!r}: taken to be "
                                        f"{known_as[aid]!r} ({aid})")
                    animal_id[animal] = aid
                db.execute("INSERT OR IGNORE INTO ingredient_animals"
                           "(ingredient_id, animal_id) VALUES (?,?)",
                           (iid, aid))

    # ---- recipes ----------------------------------------------------------
    uses = {}                     # ingredient name -> recipe ids, per recipes
    skipped = set()               # sheet ids of recipes not loaded
    for _, r in book["consumable-recipes"].iterrows():
        name = clean(r["name"])
        if not name:
            continue
        rid = mkid("recipe", name)
        if db.execute("SELECT 1 FROM recipes WHERE id = ?", (rid,)).fetchone():
            warnings.append(f"{name!r}: already a one-time recipe, skipped")
            # Its ingredients are never read, so the index rows that list
            # it must not be held against the recipe text below.
            skipped.add(clean(r.get("id")))
            continue
        description = clean(r.get("description")) or None
        db.execute(
            "INSERT INTO recipes(id, name, category, station_id, price_cents, "
            "description, repeatable) VALUES (?,?,?,?,?,?,1)",
            (rid, name, clean(r.get("category")), campfire,
             parse_price(r.get("price")), description))

        # The sheet's own ids are ignored as ids, but the index sheets
        # name recipes by them, so they are what the cross-check compares.
        sheet_id = clean(r.get("id"))
        if not sheet_id:
            warnings.append(f"{name!r}: no id in the sheet, not cross-checked")

        slots, problems = parse_slots(r["ingredients"])
        for p in problems:
            warnings.append(f"{name!r}: cannot read ingredient {p!r}")
        for slot, (qty, options) in enumerate(slots, start=1):
            for option in options:
                iid = ingredient_id.get(option)
                if iid is None:
                    warnings.append(f"{name!r}: unknown ingredient {option!r}")
                    continue
                if sheet_id:
                    uses.setdefault(option, set()).add(sheet_id)
                try:
                    db.execute(
                        "INSERT INTO recipe_ingredients"
                        "(recipe_id, slot, ingredient_id, qty) VALUES (?,?,?,?)",
                        (rid, slot, iid, qty))
                except sqlite3.IntegrityError:
                    warnings.append(f"{name!r}: {option!r} named twice")

    # ---- the index sheets and the recipe text must agree ------------------
    # The workbook says which recipes use each ingredient twice over: in
    # the recipe's own text, and in the ingredient's row.  Either can be
    # the one that is wrong, so say which way round they differ.
    for name in sorted(set(uses) | set(used_in)):
        text, index = uses.get(name, set()), used_in.get(name, set()) - skipped
        if text - index:
            warnings.append(f"{name!r}: recipes name it, its index row does "
                            f"not: {', '.join(sorted(text - index))}")
        if index - text:
            warnings.append(f"{name!r}: its index row lists recipes that do "
                            f"not name it: {', '.join(sorted(index - text))}")


def baseline_ids(path):
    """The ids an earlier build handed out, which this one must keep."""
    if not path:
        return None
    # connect() would create an empty file at a mistyped path.
    if not os.path.exists(path):
        sys.exit(f"error: --check-ids: no database at {path}")
    old = sqlite3.connect(path)
    ids = {t: {i for (i,) in old.execute(f"SELECT id FROM {t}")}
           for t in ("ingredients", "recipes", "locations")}
    old.close()
    return ids


def lost_ids(db, baseline):
    """Every baseline id this build no longer produces."""
    return [(t, i) for t, ids in baseline.items()
            for i in sorted(ids - {i for (i,) in db.execute(f"SELECT id FROM {t}")})]


def report(db, warnings, notes, lost, out_path):
    tables = ("weapons", "animals", "locations", "stations", "sets",
              "ingredients", "ingredient_animals", "recipes",
              "recipe_ingredients", "meta")
    counts = [(t, db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
              for t in tables]
    width = max(len(t) for t, _ in counts)
    print(f"built {out_path}\n")
    for table, n in counts:
        print(f"  {table:<{width}}  {n:>5}")
    for repeatable, n in db.execute("SELECT repeatable, COUNT(*) FROM recipes "
                                    "GROUP BY repeatable"):
        print(f"    {'repeatable' if repeatable else 'one-time':<{width - 2}}  {n:>5}")

    unused = db.execute("""
        SELECT name FROM ingredients
        WHERE id NOT IN (SELECT ingredient_id FROM recipe_ingredients)
    """).fetchall()
    if unused:
        print(f"\n  ingredients used by no recipe: {len(unused)}")
        for (n,) in unused[:10]:
            print(f"    - {n}")

    if notes:
        print(f"\n  notes: {len(notes)}")
        for n in notes:
            print(f"    - {n}")

    if lost is not None:
        print(f"\n  ids lost against the baseline: {len(lost)}")
        for t, i in lost[:20]:
            print(f"    ! {t}: {i}")

    print(f"\n  warnings: {len(warnings)}")
    for w in warnings[:40]:
        print(f"    ! {w}")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export_dir", nargs="?", default="data/raw",
                    help="folder holding the five exported CSVs")
    ap.add_argument("-c", "--consumables",
                    default="data/raw/consumable_recipes_rdr2.xlsx",
                    help="the campfire-recipe workbook ('' to leave it out)")
    ap.add_argument("-p", "--patch", default="data/raw/rdr2_patch.xlsx",
                    help="the corrections workbook ('' to leave it out)")
    ap.add_argument("-o", "--output", default="data/rdr2.db")
    ap.add_argument("--check-ids", metavar="DB",
                    help="an earlier build whose ids must all survive")
    args = ap.parse_args()

    # pandas only reaches for openpyxl once it opens a workbook, halfway
    # through a build; say so up front instead.
    if args.consumables or args.patch:
        try:
            import openpyxl  # noqa: F401
        except ImportError:
            sys.exit("error: reading the workbooks needs openpyxl "
                     "(pip install openpyxl)")

    # Built beside the output and swapped in only once it has succeeded
    # and kept every id, so a failed build leaves the old database as it
    # was.  The swap is a rename, so the app never sees half a file.
    baseline = baseline_ids(args.check_ids)
    staging = args.output + ".building"
    try:
        db, warnings, notes = build(args.export_dir, args.consumables,
                                    args.patch, staging)
        lost = lost_ids(db, baseline) if baseline else None
        report(db, warnings, notes, lost, args.output)
        db.close()
    except BaseException:
        if os.path.exists(staging):
            os.remove(staging)
        raise

    if lost:
        os.remove(staging)
        sys.exit(f"error: {len(lost)} ids from {args.check_ids} are gone; "
                 f"{args.output} left as it was")
    os.replace(staging, args.output)


if __name__ == "__main__":
    main()
