// ============================================================
// The personal layer's durable half.
//
// sql.js is in memory and dies with the tab, so IndexedDB holds
// the ledger and targets as plain rows and replays them on
// startup.  Only the personal tables are stored; the reference
// database is re-fetched (and service-worker cached) instead.
//
// Every write goes to SQLite first, then to IndexedDB, then
// tells the views.  The ledger is append-only, so a write is an
// INSERT and an undo is a DELETE of that one row.
// ============================================================

import * as db from './db.js';
import { craftSpend } from './queries.js';
import * as prefs from './prefs.js';

const IDB_NAME = 'rdr2-personal';
const IDB_VERSION = 1;
const LEDGER = 'ledger';
const TARGETS = 'targets';

const MODE_KEY = 'rdr2:personal-mode';

// ------------------------------------------------------------
// IndexedDB, wrapped just enough to await
// ------------------------------------------------------------

let idbPromise = null;

function idb() {
  return (idbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const conn = req.result;
      if (!conn.objectStoreNames.contains(LEDGER)) {
        conn.createObjectStore(LEDGER, { keyPath: 'id' });
      }
      if (!conn.objectStoreNames.contains(TARGETS)) {
        conn.createObjectStore(TARGETS, { keyPath: 'recipe_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function tx(stores, mode, fn) {
  return idb().then((conn) => new Promise((resolve, reject) => {
    const t = conn.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    result = fn(...stores.map((s) => t.objectStore(s)));
  }));
}

function readAll(store) {
  return idb().then((conn) => new Promise((resolve, reject) => {
    const req = conn.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// ------------------------------------------------------------
// change notification
// ------------------------------------------------------------

const listeners = new Set();

/** Call `fn` after every write.  Returns an unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  for (const fn of listeners) fn();
}

// ------------------------------------------------------------
// startup
// ------------------------------------------------------------

/** Replay the stored rows into the open sql.js instance. */
export async function hydrate() {
  const [ledger, targets] = await Promise.all([readAll(LEDGER), readAll(TARGETS)]);

  db.transaction(() => {
    for (const r of ledger) {
      db.run(
        `INSERT INTO ledger (id, ts, ingredient_id, location_id, delta, reason,
                             recipe_id, note)
         VALUES (:id, :ts, :ingredient_id, :location_id, :delta, :reason,
                 :recipe_id, :note)`,
        {
          id: r.id, ts: r.ts, ingredient_id: r.ingredient_id,
          location_id: r.location_id, delta: r.delta, reason: r.reason,
          recipe_id: r.recipe_id ?? null, note: r.note ?? null,
        });
    }
    for (const t of targets) {
      db.run(
        `INSERT INTO targets (recipe_id, state, updated_at)
         VALUES (:recipe_id, :state, :updated_at)`,
        { recipe_id: t.recipe_id, state: t.state, updated_at: t.updated_at });
    }
  });

  // Settled once, on the first load that finds no mode stored.  Data
  // with no mode can only be from back when Personalize was the
  // default, so it stays there.  A first visit is written down as
  // General -- otherwise, once it had logged something, the next load
  // would take it for one of those and switch it over unasked.
  if (prefs.get(MODE_KEY) === null) {
    const hasData = ledger.length || targets.some((t) => t.state !== 'wanted');
    prefs.set(MODE_KEY, hasData ? 'personal' : 'general');
  }

  return { ledger: ledger.length, targets: targets.length };
}

// ------------------------------------------------------------
// writes
// ------------------------------------------------------------

/**
 * Why a hand-entered change happened, as the ledger records it.  A
 * gain is logged as whatever most likely caused it -- a kill for an
 * animal material, a purchase for ammunition and liquor, loot for
 * anything else -- so the ledger still reads as a history.  Taking
 * one away is nearly always fixing a mis-entry.  Inventory's steppers
 * and a material dialog's buttons both go through this.
 */
const BOUGHT = ['ammo', 'alcohol'];

export function reasonFor(sourceType, delta) {
  if (delta < 0) return 'correction';
  if (sourceType === 'animal') return 'kill';
  return BOUGHT.includes(sourceType) ? 'buy' : 'loot';
}

/**
 * Append one ledger row.  `delta` is signed: positive for a gain,
 * negative for a spend.  Returns the stored row, whose id is what
 * `undo` takes.
 */
export async function record({ ingredient_id, location_id, delta, reason,
                               recipe_id = null, note = null }) {
  const row = db.transaction(() => {
    db.run(
      `INSERT INTO ledger (ingredient_id, location_id, delta, reason, recipe_id, note)
       VALUES (:ingredient_id, :location_id, :delta, :reason, :recipe_id, :note)`,
      { ingredient_id, location_id, delta, reason, recipe_id, note });
    return db.one('SELECT * FROM ledger WHERE id = :id', { id: db.lastInsertId() });
  });

  await tx([LEDGER], 'readwrite', (s) => s.put(row));
  changed();
  return row;
}

/**
 * Append a whole batch as one commit: one SQLite transaction and
 * one IndexedDB transaction, however many rows.  Returns the rows,
 * whose ids `undoBatch` takes.
 */
export async function recordBatch(entries) {
  if (!entries.length) return [];

  const rows = db.transaction(() => entries.map(
    ({ ingredient_id, location_id, delta, reason, recipe_id = null, note = null }) => {
      db.run(
        `INSERT INTO ledger (ingredient_id, location_id, delta, reason, recipe_id, note)
         VALUES (:ingredient_id, :location_id, :delta, :reason, :recipe_id, :note)`,
        { ingredient_id, location_id, delta, reason, recipe_id, note });
      return db.one('SELECT * FROM ledger WHERE id = :id', { id: db.lastInsertId() });
    }));

  await tx([LEDGER], 'readwrite', (s) => { for (const r of rows) s.put(r); });
  changed();
  return rows;
}

/** Take a whole commit back. */
export async function undoBatch(ids) {
  if (!ids.length) return;

  db.transaction(() => {
    for (const id of ids) db.run('DELETE FROM ledger WHERE id = :id', { id });
  });
  await tx([LEDGER], 'readwrite', (s) => { for (const id of ids) s.delete(id); });
  changed();
}

/** Remove one ledger row — the undo behind the toast. */
export async function undo(id) {
  db.run('DELETE FROM ledger WHERE id = :id', { id });
  await tx([LEDGER], 'readwrite', (s) => s.delete(id));
  changed();
}

/** Mark a recipe wanted / done / skipped. */
export async function setTarget(recipe_id, state) {
  const row = db.transaction(() => {
    db.run(
      `INSERT INTO targets (recipe_id, state) VALUES (:recipe_id, :state)
       ON CONFLICT (recipe_id)
       DO UPDATE SET state = :state, updated_at = datetime('now')`,
      { recipe_id, state });
    return db.one('SELECT * FROM targets WHERE recipe_id = :recipe_id', { recipe_id });
  });

  await tx([TARGETS], 'readwrite', (s) => s.put(row));
  changed();
  return row;
}

// ------------------------------------------------------------
// export / import / reset
// ------------------------------------------------------------

/** Everything personal, as portable JSON. */
export function exportJSON() {
  return JSON.stringify({
    format: 'rdr2-crafting-guide/personal',
    version: 1,
    exported_at: new Date().toISOString(),
    reference_build: referenceBuild(),
    ledger: db.all('SELECT * FROM ledger ORDER BY id'),
    targets: db.all('SELECT * FROM targets ORDER BY recipe_id'),
  }, null, 2);
}

/** Which reference database this was recorded against. */
function referenceBuild() {
  return db.one("SELECT value FROM meta WHERE key = 'built_at'")?.value ?? null;
}

const REASONS = ['kill', 'loot', 'buy', 'craft', 'move', 'correction'];
const TARGET_STATES = ['wanted', 'done', 'skipped'];

/**
 * Read an export without touching anything, and say what is in it.
 *
 * Three things are worth catching before the transaction rather than
 * halfway through it: a row missing a column the schema requires, a
 * `reason` its CHECK will refuse, and rows naming materials this
 * build has never heard of.  The
 * ledger stores slugs with no foreign key, so if a name is
 * corrected upstream the slug moves and those rows would import
 * silently and then never appear anywhere.
 */
export function inspectImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, fatal: `That is not JSON: ${err.message}` };
  }

  if (data?.format !== 'rdr2-crafting-guide/personal') {
    return { ok: false, fatal: 'Not a crafting-guide export.' };
  }

  const ledger = Array.isArray(data.ledger) ? data.ledger : [];
  const targets = Array.isArray(data.targets) ? data.targets : [];

  const known = (table) =>
    new Set(db.all(`SELECT id FROM ${table}`).map((r) => r.id));
  const ingredients = known('ingredients');
  const recipes = known('recipes');
  const locations = known('locations');

  const problems = [];
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // A row missing a column the schema requires would only fail once
  // the import is under way -- after the stored rows were cleared and
  // the bad ones written in their place, where they would break every
  // load after.  So the shape is checked here, before anything moves.
  const filled = (v) => typeof v === 'string' && v.length > 0;
  const rowsOf = (list) => list.filter((r) => r && typeof r === 'object');
  const malformed =
    ledger.filter((r) => !Number.isInteger(r?.id) || !filled(r.ts) || !filled(r.ingredient_id)
                      || !filled(r.location_id) || !Number.isInteger(r.delta)).length
    + targets.filter((t) => !filled(t?.recipe_id) || !TARGET_STATES.includes(t.state)
                         || !filled(t.updated_at)).length;
  if (malformed) problems.push(count(malformed, 'row is', 'rows are')
    + ' missing something the database requires');

  const badReason = ledger.filter((r) => !REASONS.includes(r?.reason)).length;
  if (badReason) problems.push(count(badReason, 'entry has', 'entries have')
    + ' a reason this version does not accept');

  const unknownIngredient =
    new Set(rowsOf(ledger).filter((r) => !ingredients.has(r.ingredient_id))
                  .map((r) => r.ingredient_id));
  if (unknownIngredient.size) {
    problems.push(count(unknownIngredient.size, 'material is', 'materials are')
      + ' not in this build of the reference data');
  }

  const unknownLocation =
    new Set(rowsOf(ledger).filter((r) => !locations.has(r.location_id))
                  .map((r) => r.location_id));
  if (unknownLocation.size) {
    problems.push(count(unknownLocation.size, 'location is', 'locations are')
      + ' not in this build');
  }

  const unknownRecipe =
    new Set(rowsOf(targets).filter((t) => !recipes.has(t.recipe_id))
                   .map((t) => t.recipe_id));
  if (unknownRecipe.size) {
    problems.push(count(unknownRecipe.size, 'recipe is', 'recipes are')
      + ' not in this build');
  }

  return {
    ok: badReason === 0 && malformed === 0,
    fatal: badReason || malformed ? 'Some entries would be rejected by the database.' : null,
    exported_at: data.exported_at ?? null,
    reference_build: data.reference_build ?? null,
    ledger: ledger.length,
    targets: targets.length,
    problems,
  };
}

/**
 * Replace everything personal with the contents of an export.
 *
 * Replace, not merge: a ledger id counts up per device, so two
 * devices' rows cannot be told apart and merging would double
 * anything imported twice.  One device is the source of truth.
 */
export async function importJSON(text) {
  const found = inspectImport(text);
  if (found.fatal) throw new Error(found.fatal);

  const data = JSON.parse(text);

  db.transaction(() => {
    db.run('DELETE FROM ledger');
    db.run('DELETE FROM targets');
  });
  await tx([LEDGER, TARGETS], 'readwrite', (l, t) => { l.clear(); t.clear(); });

  await tx([LEDGER, TARGETS], 'readwrite', (l, t) => {
    for (const r of data.ledger ?? []) l.put(r);
    for (const r of data.targets ?? []) t.put(r);
  });

  await hydrate();
  changed();
  return found;
}

/**
 * A count of what is here, for the Settings page to report.
 *
 * Campfire recipes are never crafted or ticked off (see queries.js),
 * so every count below that means "crafted" -- made, spent, the
 * category and vendor breakdowns -- is scoped to the 165 vendor
 * recipes on purpose; a campfire recipe has no such state to count.
 */
export function stats() {
  const one = (sql) => db.one(sql)?.n ?? 0;
  return {
    entries: one('SELECT COUNT(*) AS n FROM ledger'),
    held: one('SELECT COUNT(*) AS n FROM inventory WHERE qty > 0'),
    materials: one('SELECT COUNT(DISTINCT ingredient_id) AS n FROM inventory WHERE qty > 0'),
    made: one("SELECT COUNT(*) AS n FROM targets WHERE state = 'done'"),
    skipped: one("SELECT COUNT(*) AS n FROM targets WHERE state = 'skipped'"),
    vendorRecipes: one('SELECT COUNT(*) AS n FROM recipes WHERE repeatable = 0'),
    spentCents: one(`
      SELECT COALESCE(SUM(r.price_cents), 0) AS n
      FROM   recipes r
      JOIN   targets t ON t.recipe_id = r.id
      WHERE  t.state = 'done' AND r.repeatable = 0`),
    // Denominator and numerator share the same population -- outfit sets
    // with at least one vendor recipe -- so a set with none yet (or only
    // a campfire recipe, which is never marked done) can't sit forever
    // out of reach of 100%.
    outfits: one(`
      SELECT COUNT(DISTINCT s.id) AS n
      FROM   sets s
      JOIN   recipes r ON r.set_id = s.id
      WHERE  s.set_type = 'outfit' AND r.repeatable = 0`),
    outfitsDone: one(`
      SELECT COUNT(*) AS n FROM (
        SELECT   s.id
        FROM     sets s
        JOIN     recipes r ON r.set_id = s.id AND r.repeatable = 0
        LEFT JOIN targets t ON t.recipe_id = r.id
        WHERE    s.set_type = 'outfit'
        GROUP BY s.id
        HAVING   MIN(COALESCE(t.state, 'wanted') = 'done') = 1)`),
    byCategory: db.all(`
      SELECT     r.category                                       AS category,
                 COUNT(*)                                          AS total,
                 SUM(CASE WHEN t.state = 'done' THEN 1 ELSE 0 END) AS made
      FROM       recipes r
      LEFT JOIN  targets t ON t.recipe_id = r.id
      WHERE      r.repeatable = 0 AND r.category IS NOT NULL
      GROUP BY   r.category
      ORDER BY   r.category`),
    byVendor: db.all(`
      SELECT     st.id                                             AS station_id,
                 st.name                                           AS station,
                 st.color                                          AS color,
                 COUNT(*)                                          AS total,
                 SUM(CASE WHEN t.state = 'done' THEN 1 ELSE 0 END) AS made
      FROM       recipes r
      JOIN       stations st ON st.id = r.station_id
      LEFT JOIN  targets t ON t.recipe_id = r.id
      WHERE      r.repeatable = 0
      GROUP BY   st.id
      ORDER BY   made DESC`),
  };
}

/**
 * What has been written since `since` (a moment as an ISO string, or
 * null for "ever"): how many ledger rows and recipe marks are newer,
 * and the oldest of them.  Undoing a logged entry deletes its row, so
 * that comes off the count; undoing a Skip or a craft rewrites the
 * recipe's mark instead, so that still counts as one change -- erring
 * towards a backup, never away from one.
 *
 * SQLite stamps rows with datetime('now') -- UTC, "YYYY-MM-DD HH:MM:SS"
 * -- so the ISO string is cut to that same shape and the two compare
 * as text.  That makes a row written in the same second as the backup
 * count as part of it: a second is shorter than any two taps.
 */
export function changesSince(since) {
  const stamp = since ? since.slice(0, 19).replace('T', ' ') : '';
  const row = db.one(`
    SELECT COUNT(*) AS n, MIN(at) AS oldest FROM (
      SELECT ts         AS at FROM ledger  WHERE ts         > :stamp
      UNION ALL
      SELECT updated_at AS at FROM targets WHERE updated_at > :stamp)`,
    { stamp });
  return {
    count: row?.n ?? 0,
    oldest: row?.oldest ? new Date(`${row.oldest.replace(' ', 'T')}Z`) : null,
  };
}

/**
 * True when there is nothing personal here at all -- nothing to lose.
 * A recipe marked 'wanted' is what every recipe is with no mark at all
 * (a Skip undone leaves one behind), so it does not count.
 */
export function isEmpty() {
  return !db.one('SELECT 1 AS n FROM ledger LIMIT 1')
      && !db.one("SELECT 1 AS n FROM targets WHERE state <> 'wanted' LIMIT 1");
}

/** Throw the personal layer away. */
export async function reset() {
  db.transaction(() => {
    db.run('DELETE FROM ledger');
    db.run('DELETE FROM targets');
  });
  await tx([LEDGER, TARGETS], 'readwrite', (l, t) => { l.clear(); t.clear(); });
  changed();
}

// ------------------------------------------------------------
// personal vs general mode
//
// The two Notion versions, collapsed into one app: general shows
// the reference data alone, personal folds in what you have.
// ------------------------------------------------------------

// General until someone chooses otherwise.  A first visit has nothing
// logged, and Personalize with nothing logged is every card saying
// "go hunting" -- General is useful from the first second.  Someone
// who logged things back when Personalize was the default never had
// to choose it; hydrate() settles them on it, so nobody is moved.
//
// The choice is held here as well as stored, so it still takes for the
// rest of the visit in a browser that will not keep it -- blocked site
// data, some private modes -- where a write fails without a word.
let chosen = null;

export function isPersonal() {
  return (chosen ?? prefs.get(MODE_KEY)) === 'personal';
}

export function setPersonal(on) {
  chosen = on ? 'personal' : 'general';
  prefs.set(MODE_KEY, chosen);
  changed();
}

// ------------------------------------------------------------
// crafting — query 4, with persistence
//
// Spending and marking done is one SQLite transaction, mirrored
// to IndexedDB in one IndexedDB transaction.  Undo deletes the
// same rows: that is the whole point of an append-only ledger.
// ------------------------------------------------------------

/** Spend a recipe's ingredients from its station's stock, and mark it done. */
export async function craft(recipe_id) {
  const spend = craftSpend(recipe_id);
  if (!spend.length) throw new Error(`Nothing to spend for ${recipe_id}.`);

  const { rows, target } = db.transaction(() => {
    const ids = [];
    for (const s of spend) {
      db.run(
        `INSERT INTO ledger (ingredient_id, location_id, delta, reason, recipe_id)
         VALUES (:ingredient_id, :location_id, :delta, 'craft', :recipe_id)`,
        { ...s, recipe_id });
      ids.push(db.lastInsertId());
    }
    db.run(
      `INSERT INTO targets (recipe_id, state) VALUES (:recipe_id, 'done')
       ON CONFLICT (recipe_id)
       DO UPDATE SET state = 'done', updated_at = datetime('now')`,
      { recipe_id });

    return {
      rows: ids.map((id) => db.one('SELECT * FROM ledger WHERE id = :id', { id })),
      target: db.one('SELECT * FROM targets WHERE recipe_id = :recipe_id', { recipe_id }),
    };
  });

  await tx([LEDGER, TARGETS], 'readwrite', (l, t) => {
    for (const r of rows) l.put(r);
    t.put(target);
  });
  changed();
  return rows;
}

/** Put a crafted recipe back: refund the spend, mark it wanted again. */
export async function uncraft(recipe_id) {
  const { ids, target } = db.transaction(() => {
    const ids = db.all(
      `SELECT id FROM ledger WHERE recipe_id = :recipe_id AND reason = 'craft'`,
      { recipe_id }).map((r) => r.id);

    db.run(`DELETE FROM ledger WHERE recipe_id = :recipe_id AND reason = 'craft'`,
           { recipe_id });
    db.run(`UPDATE targets SET state = 'wanted', updated_at = datetime('now')
            WHERE recipe_id = :recipe_id`, { recipe_id });

    return {
      ids,
      target: db.one('SELECT * FROM targets WHERE recipe_id = :recipe_id', { recipe_id }),
    };
  });

  await tx([LEDGER, TARGETS], 'readwrite', (l, t) => {
    for (const id of ids) l.delete(id);
    if (target) t.put(target);
  });
  changed();
}
