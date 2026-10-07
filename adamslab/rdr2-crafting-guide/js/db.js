// ============================================================
// The database, in the browser.
//
// One sql.js instance holds both layers: the read-only reference
// data shipped as data/rdr2.db, and the personal tables created
// on top of it from database/personal_schema.sql.  Keeping them
// in a single connection is what lets the queries join across
// without an ATTACH.
//
// Nothing here persists.  store.js owns that, and replays the
// ledger into this instance on startup.
// ============================================================

const REFERENCE_URL = 'data/rdr2.db';
const PERSONAL_SCHEMA_URL = 'database/personal_schema.sql';

let db = null;

/** Open the database.  Safe to await more than once. */
let opening = null;
export function open() {
  return (opening ??= boot());
}

async function boot() {
  const [SQL, bytes, schema] = await Promise.all([
    initSqlJs({ locateFile: (file) => `vendor/${file}` }),
    fetchBuffer(REFERENCE_URL),
    fetchText(PERSONAL_SCHEMA_URL),
  ]);

  db = new SQL.Database(new Uint8Array(bytes));
  db.run(schema);           // the file's queries are SQL comments; only DDL runs
  return db;
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

// ------------------------------------------------------------
// query helpers
// ------------------------------------------------------------

// sql.js wants named parameters spelled with their colon.  Callers
// pass plain keys; this adds it, so queries.js reads like the SQL.
function bindable(params) {
  if (!params) return undefined;
  if (Array.isArray(params)) return params;
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k.startsWith(':') ? k : `:${k}`, v]));
}

/** Every row, as objects. */
export function all(sql, params) {
  const stmt = db.prepare(sql);
  try {
    if (params) stmt.bind(bindable(params));
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

/** The first row, or null. */
export function one(sql, params) {
  return all(sql, params)[0] ?? null;
}

/** A statement with no result set. */
export function run(sql, params) {
  db.run(sql, bindable(params));
}

/** Run `fn` inside a transaction, rolling back if it throws. */
export function transaction(fn) {
  db.run('BEGIN');
  try {
    const result = fn();
    db.run('COMMIT');
    return result;
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
}

/** The rowid SQLite just handed out. */
export function lastInsertId() {
  return one('SELECT last_insert_rowid() AS id').id;
}
