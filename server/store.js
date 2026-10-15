// Key/value + row storage. Tries better-sqlite3; falls back to a JSON file
// when the native module is unavailable (common on Windows without build tools).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudSaveEnabled, restore as restoreFromCloud } from './cloudsave.js';
import { PREMIUM_ENABLED } from './features.js';
import { open as unseal, seal } from './seal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const sqlitePath = path.join(dataDir, 'launchpad.db');
const jsonPath = path.join(dataDir, 'launchpad.json');

// On a host with no persistent disk the file is missing on every boot, so pull
// the saved copy down before SQLite opens (and would create an empty one).
// Only when the file is absent: a local database is never overwritten.
if (cloudSaveEnabled() && process.env.STORE_BACKEND !== 'json' && !fs.existsSync(sqlitePath)) {
  try {
    const bytes = await restoreFromCloud();
    if (bytes) {
      for (const f of [`${sqlitePath}-wal`, `${sqlitePath}-shm`]) fs.rmSync(f, { force: true });
      fs.writeFileSync(sqlitePath, bytes);
      console.log(`[cloudsave] restored ${Math.round(bytes.length / 1024)} KB from Cloudflare KV`);
    } else {
      console.log('[cloudsave] no saved copy yet — starting with an empty database');
    }
  } catch (err) {
    // Refuse to start rather than start empty: an empty database would be
    // saved over the real one within minutes. The host restarts us and the
    // download is retried.
    console.error(`[cloudsave] FATAL: could not restore the database: ${err.message}`);
    process.exit(1);
  }
}

let backend = 'json';
let db = null;

/** Per-table CREATE statements, reused by the migration when rebuilding. */
const SCHEMA_FOR = {
  ledger_done: `CREATE TABLE ledger_done (
      user_id INTEGER NOT NULL DEFAULT 0,
      item_id TEXT NOT NULL,
      done_at TEXT NOT NULL,
      PRIMARY KEY (user_id, item_id)
    )`,
  ledger_added: `CREATE TABLE ledger_added (
      user_id INTEGER NOT NULL DEFAULT 0,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    )`,
  started_tracks: `CREATE TABLE started_tracks (
      user_id INTEGER NOT NULL DEFAULT 0,
      field TEXT NOT NULL,
      started_at TEXT NOT NULL,
      PRIMARY KEY (user_id, field)
    )`,
  saved_searches: `CREATE TABLE saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  /* Internships the person opened an apply link for.
     `applied_at` is when they clicked, not when an employer received
     anything — this app cannot see the other side of that link, and the
     reporting is careful to say so. */
  applications: `CREATE TABLE applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      job_key TEXT NOT NULL,
      title TEXT,
      company TEXT,
      source TEXT,
      applied_at TEXT NOT NULL
    )`,
  /* The application tracker: internships a person chose to follow, and which
     stage each is at. Separate from `applications`, which is the automatic
     record of apply clicks — this one is what the person says happened. */
  tracked_jobs: `CREATE TABLE tracked_jobs (
      user_id INTEGER NOT NULL,
      job_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, job_key)
    )`,
};

/** Rows created before accounts existed. */
export const LEGACY_USER = 0;

try {
  // STORE_BACKEND=json forces the fallback, for testing or when the native
  // module misbehaves on a given machine.
  if (process.env.STORE_BACKEND === 'json') throw new Error('forced by STORE_BACKEND=json');
  const { default: Database } = await import('better-sqlite3');
  db = new Database(sqlitePath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    /* Single-use, short-lived tokens for password reset and email
       verification. Only the hash is stored, as with sessions. */
    CREATE TABLE IF NOT EXISTS tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id, purpose);

    /* Federated sign-in. A user can have a password, a Google identity, or
       both; linking is by verified email. */
    CREATE TABLE IF NOT EXISTS identities (
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider, subject)
    );
    CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);

    /* Browsers that asked for notifications. The endpoint is the address the
       browser's push service gave us; keys encrypt what is sent to it. */
    CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      keys TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_id);

    /* One row per completed Stripe checkout. session_id is unique, so the
       success page and the webhook can both report the same payment and it
       is only counted once. Card details never reach this server. */
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      kind TEXT NOT NULL,
      session_id TEXT NOT NULL UNIQUE,
      payment_intent TEXT,
      amount_cents INTEGER NOT NULL,
      ref_code TEXT,
      created_at TEXT NOT NULL,
      refunded_at TEXT
    );

    /* Employer-paid listings, shown at the top of matching searches for 30
       days once the owner approves them. */
    CREATE TABLE IF NOT EXISTS sponsored (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      location TEXT,
      zip TEXT,
      lat REAL,
      lon REAL,
      remote INTEGER NOT NULL DEFAULT 0,
      majors TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      session_id TEXT,
      payment_intent TEXT,
      amount_cents INTEGER,
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      starts_at TEXT,
      ends_at TEXT
    );
  `);

  // Columns added after the users table shipped.
  {
    const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!userCols.includes('email_verified_at')) {
      db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
    }
    if (!userCols.includes('is_edu')) {
      db.exec('ALTER TABLE users ADD COLUMN is_edu INTEGER NOT NULL DEFAULT 0');
    }
    // Opt-in for deadline and interview reminder emails. Off unless the person
    // turns it on.
    if (!userCols.includes('remind_email')) {
      db.exec('ALTER TABLE users ADD COLUMN remind_email INTEGER NOT NULL DEFAULT 0');
    }
    // Opt-in for the weekly "new internships" email, and its bookkeeping:
    // when it last ran, which listings it has already sent, and the token in
    // its unsubscribe link. See server/digest.js.
    if (!userCols.includes('digest_email')) {
      db.exec('ALTER TABLE users ADD COLUMN digest_email INTEGER NOT NULL DEFAULT 0');
    }
    if (!userCols.includes('digest_state')) {
      db.exec('ALTER TABLE users ADD COLUMN digest_state TEXT');
    }
    // Premium: paid through this date (ISO). Null or past means free.
    if (!userCols.includes('premium_until')) {
      db.exec('ALTER TABLE users ADD COLUMN premium_until TEXT');
    }
    // The referral or campus-ambassador code the person signed up with.
    if (!userCols.includes('ref_code')) {
      db.exec('ALTER TABLE users ADD COLUMN ref_code TEXT');
    }
    // Premium's daily new-internship notification, and its bookkeeping
    // (see server/push.js).
    if (!userCols.includes('push_alerts')) {
      db.exec('ALTER TABLE users ADD COLUMN push_alerts INTEGER NOT NULL DEFAULT 0');
    }
    if (!userCols.includes('alert_state')) {
      db.exec('ALTER TABLE users ADD COLUMN alert_state TEXT');
    }
    // A Google-only account has no password, so the column must allow null.
    // SQLite cannot drop NOT NULL, so new rows store an empty string instead
    // and auth.js treats that as "no password set".
  }

  // --- Migrate the pre-accounts ledger tables -------------------------------
  //
  // These ran before any index is created on user_id, because the old tables
  // do not have that column yet — creating the index first is what made an
  // earlier attempt fail and silently fall back to JSON.
  //
  // The old tables keyed on item_id / field alone, which would stop two people
  // completing the same certification. SQLite cannot drop a primary key, so
  // each table is rebuilt and its rows copied across, tagged to LEGACY_USER
  // for the first account to adopt.
  const tableExists = (t) =>
    Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
  const columnsOf = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

  const rebuilds = [
    { table: 'ledger_done', cols: 'item_id, done_at' },
    { table: 'ledger_added', cols: 'id, payload, added_at' },
    { table: 'started_tracks', cols: 'field, started_at' },
    { table: 'saved_searches', cols: 'payload, created_at' },
  ];

  for (const { table, cols } of rebuilds) {
    if (!tableExists(table)) continue; // fresh install — created below
    if (columnsOf(table).includes('user_id')) continue; // already migrated

    const legacy = `${table}_legacy`;
    const migrate = db.transaction(() => {
      db.exec(`ALTER TABLE ${table} RENAME TO ${legacy}`);
      db.exec(SCHEMA_FOR[table]);
      db.exec(`INSERT INTO ${table} (user_id, ${cols}) SELECT ${LEGACY_USER}, ${cols} FROM ${legacy}`);
      db.exec(`DROP TABLE ${legacy}`);
    });

    try {
      migrate();
      const n = db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
      console.log(`[store] migrated ${table} to per-user keys (${n} rows preserved)`);
    } catch (err) {
      console.error(`[store] migration of ${table} failed: ${err.message}`);
      throw err;
    }
  }

  // Fresh installs get the tables here; the index is safe now that every
  // table is guaranteed to have user_id.
  for (const sql of Object.values(SCHEMA_FOR)) {
    db.exec(sql.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '));
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_searches_user ON saved_searches(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id)');
  // Indexes for the lookups the app makes on every request or search, so they
  // stay fast as the tables grow. Each matches a WHERE/ORDER BY below. (Recent
  // searches use idx_searches_user, which SQLite keeps in id order.)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_applications_user_job ON applications(user_id, job_key);
    CREATE INDEX IF NOT EXISTS idx_tracked_user_updated ON tracked_jobs(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_users_ref ON users(ref_code);
    CREATE INDEX IF NOT EXISTS idx_users_alerts ON users(push_alerts, premium_until);
    CREATE INDEX IF NOT EXISTS idx_payments_intent ON payments(payment_intent);
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
    CREATE INDEX IF NOT EXISTS idx_sponsored_live ON sponsored(status, starts_at, ends_at);
  `);

  // Sign-in counters live on the user row rather than in an event log. The
  // reporting only needs "how many times" and "most recently", and a count is
  // far less to hold about somebody than a timestamped record of every visit.
  const userCols = columnsOf('users');
  if (!userCols.includes('login_count')) {
    db.exec('ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0');
    console.log('[store] added users.login_count');
  }
  if (!userCols.includes('last_login_at')) {
    db.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT');
    console.log('[store] added users.last_login_at');
  }

  backend = 'sqlite';
} catch (err) {
  const reason = err.code || err.message;

  // The JSON store is a development convenience. It rewrites the whole file on
  // every write and has no transactions, so two requests landing together can
  // lose one of them — fine for one person on a laptop, not for a hosted site
  // with accounts in it.
  //
  // In production, refusing to start is the safe failure. The alternative is a
  // server that looks healthy for weeks and quietly drops writes, and by the
  // time anyone notices the lost data is gone. Setting STORE_BACKEND=json is
  // the way to say "yes, I really do want the JSON store here".
  if (process.env.NODE_ENV === 'production' && process.env.STORE_BACKEND !== 'json') {
    console.error(
      [
        '',
        '[store] FATAL: better-sqlite3 could not be loaded in production.',
        `[store] reason: ${reason}`,
        '',
        '  Refusing to start on the JSON fallback, which has no transactions and',
        '  rewrites the whole file per write — concurrent users would lose data.',
        '',
        '  Fix one of these:',
        '    * install build tools on the host so the native module compiles',
        '      (npm rebuild better-sqlite3 --build-from-source)',
        '    * or use a host image whose Node version matches a prebuilt binary',
        '    * or, if you genuinely want the JSON store, set STORE_BACKEND=json',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  console.warn(`[store] better-sqlite3 unavailable (${reason}); using JSON file at ${jsonPath}`);
}

// ---- JSON fallback helpers -------------------------------------------------
//
// The JSON backend mirrors the SQLite one, keyed by user id so both behave
// identically. Shape: { users:[], sessions:{}, byUser:{ <id>: {...} }, meta:{} }

function readJson() {
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return { users: [], sessions: {}, byUser: {}, meta: {}, nextUserId: 1, ...parsed };
  } catch {
    return { users: [], sessions: {}, byUser: {}, meta: {}, nextUserId: 1 };
  }
}

function writeJson(state) {
  const tmp = `${jsonPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, jsonPath);
}

/** Per-user bucket in the JSON backend, created on demand. */
function bucket(state, userId) {
  const key = String(userId);
  if (!state.byUser[key]) state.byUser[key] = { done: {}, added: [], tracks: [], searches: [], applications: [], tracked: [] };
  // Buckets written before these existed have no such arrays.
  if (!state.byUser[key].applications) state.byUser[key].applications = [];
  if (!state.byUser[key].tracked) state.byUser[key].tracked = [];
  return state.byUser[key];
}

// ---- Public API ------------------------------------------------------------

export const storeBackend = () => backend;

/** The whole SQLite database as one Buffer, WAL contents included. */
export const snapshotDb = () => db.serialize();

/** Rows written since this process opened the database; grows on every write. */
export const totalChanges = () => db.prepare('SELECT total_changes() AS n').get().n;

// ---- Users -----------------------------------------------------------------

export function getUserByEmail(email) {
  if (backend === 'sqlite') {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase()) || null;
  }
  const state = readJson();
  return state.users.find((u) => u.email === String(email).toLowerCase()) || null;
}

export function getUserById(id) {
  if (backend === 'sqlite') {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  }
  return readJson().users.find((u) => u.id === id) || null;
}

export function createUser({ email, name, passwordHash }) {
  const created_at = new Date().toISOString();
  if (backend === 'sqlite') {
    const info = db
      .prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(email, name || null, passwordHash, created_at);
    return getUserById(info.lastInsertRowid);
  }
  const state = readJson();
  const user = { id: state.nextUserId++, email, name: name || null, password_hash: passwordHash, created_at };
  state.users.push(user);
  writeJson(state);
  return user;
}

export function updatePassword(userId, passwordHash) {
  if (backend === 'sqlite') {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    return;
  }
  const state = readJson();
  const u = state.users.find((x) => x.id === userId);
  if (u) u.password_hash = passwordHash;
  writeJson(state);
}

export function countUsers() {
  if (backend === 'sqlite') return db.prepare('SELECT COUNT(*) c FROM users').get().c;
  return readJson().users.length;
}

/**
 * Hand rows created before accounts existed to the first account.
 * Returns how many rows moved, so the UI can say so rather than silently
 * appearing to have data from nowhere.
 */
export function claimOrphanedData(userId) {
  if (countUsers() !== 1) return 0;

  if (backend === 'sqlite') {
    let moved = 0;
    const tx = db.transaction(() => {
      for (const t of ['ledger_done', 'ledger_added', 'started_tracks', 'saved_searches']) {
        moved += db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`).run(userId, LEGACY_USER).changes;
      }
    });
    tx();
    return moved;
  }

  const state = readJson();
  const legacy = state.byUser[String(LEGACY_USER)];
  if (!legacy) return 0;
  const moved =
    Object.keys(legacy.done).length + legacy.added.length + legacy.tracks.length + legacy.searches.length;
  state.byUser[String(userId)] = legacy;
  delete state.byUser[String(LEGACY_USER)];
  writeJson(state);
  return moved;
}

// ---- Sessions --------------------------------------------------------------

export function createSession(tokenHash, userId, expiresAt) {
  const created_at = new Date().toISOString();
  if (backend === 'sqlite') {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    ).run(tokenHash, userId, expiresAt, created_at);
    // Opportunistically drop anything already expired.
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(created_at);
    return;
  }
  const state = readJson();
  state.sessions[tokenHash] = { user_id: userId, expires_at: expiresAt, created_at };
  for (const [k, v] of Object.entries(state.sessions)) {
    if (v.expires_at < created_at) delete state.sessions[k];
  }
  writeJson(state);
}

export function getSession(tokenHash) {
  if (backend === 'sqlite') {
    return db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) || null;
  }
  return readJson().sessions[tokenHash] || null;
}

export function deleteSession(tokenHash) {
  if (backend === 'sqlite') {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return;
  }
  const state = readJson();
  delete state.sessions[tokenHash];
  writeJson(state);
}

export function deleteSessionsForUser(userId) {
  if (backend === 'sqlite') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return;
  }
  const state = readJson();
  for (const [k, v] of Object.entries(state.sessions)) {
    if (v.user_id === userId) delete state.sessions[k];
  }
  writeJson(state);
}

// ---- Ledger, all scoped to a user -----------------------------------------

export function getDone(userId) {
  if (backend === 'sqlite') {
    const rows = db.prepare('SELECT item_id, done_at FROM ledger_done WHERE user_id = ?').all(userId);
    return Object.fromEntries(rows.map((r) => [r.item_id, r.done_at]));
  }
  return bucket(readJson(), userId).done;
}

export function setDone(userId, itemId, doneAt) {
  if (backend === 'sqlite') {
    if (doneAt) {
      db.prepare(
        `INSERT INTO ledger_done (user_id, item_id, done_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id, item_id) DO UPDATE SET done_at = excluded.done_at`,
      ).run(userId, itemId, doneAt);
    } else {
      db.prepare('DELETE FROM ledger_done WHERE user_id = ? AND item_id = ?').run(userId, itemId);
    }
    return getDone(userId);
  }
  const state = readJson();
  const b = bucket(state, userId);
  if (doneAt) b.done[itemId] = doneAt;
  else delete b.done[itemId];
  writeJson(state);
  return b.done;
}

export function clearDone(userId) {
  if (backend === 'sqlite') {
    db.prepare('DELETE FROM ledger_done WHERE user_id = ?').run(userId);
    return {};
  }
  const state = readJson();
  bucket(state, userId).done = {};
  writeJson(state);
  return {};
}

export function getAdded(userId) {
  if (backend === 'sqlite') {
    return db
      .prepare('SELECT payload, added_at FROM ledger_added WHERE user_id = ? ORDER BY added_at ASC')
      .all(userId)
      .map((r) => ({ ...JSON.parse(r.payload), addedAt: r.added_at }));
  }
  return bucket(readJson(), userId).added;
}

export function addItem(userId, item) {
  const addedAt = new Date().toISOString();
  if (backend === 'sqlite') {
    db.prepare(
      `INSERT INTO ledger_added (user_id, id, payload, added_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO NOTHING`,
    ).run(userId, item.id, JSON.stringify(item), addedAt);
    return getAdded(userId);
  }
  const state = readJson();
  const b = bucket(state, userId);
  if (!b.added.some((a) => a.id === item.id)) b.added.push({ ...item, addedAt });
  writeJson(state);
  return b.added;
}

export function removeItem(userId, id) {
  if (backend === 'sqlite') {
    db.prepare('DELETE FROM ledger_added WHERE user_id = ? AND id = ?').run(userId, id);
    db.prepare('DELETE FROM ledger_done WHERE user_id = ? AND item_id = ?').run(userId, id);
    return getAdded(userId);
  }
  const state = readJson();
  const b = bucket(state, userId);
  b.added = b.added.filter((a) => a.id !== id);
  delete b.done[id];
  writeJson(state);
  return b.added;
}

export function getTracks(userId) {
  if (backend === 'sqlite') {
    return db
      .prepare('SELECT field FROM started_tracks WHERE user_id = ? ORDER BY started_at ASC')
      .all(userId)
      .map((r) => r.field);
  }
  return bucket(readJson(), userId).tracks;
}

export function addTrack(userId, field) {
  if (backend === 'sqlite') {
    db.prepare(
      `INSERT INTO started_tracks (user_id, field, started_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, field) DO NOTHING`,
    ).run(userId, field, new Date().toISOString());
    return getTracks(userId);
  }
  const state = readJson();
  const b = bucket(state, userId);
  if (!b.tracks.includes(field)) b.tracks.push(field);
  writeJson(state);
  return b.tracks;
}

export function removeTrack(userId, field) {
  if (backend === 'sqlite') {
    db.prepare('DELETE FROM started_tracks WHERE user_id = ? AND field = ?').run(userId, field);
    return getTracks(userId);
  }
  const state = readJson();
  const b = bucket(state, userId);
  b.tracks = b.tracks.filter((t) => t !== field);
  writeJson(state);
  return b.tracks;
}

export function saveSearch(userId, payload) {
  const createdAt = new Date().toISOString();
  if (backend === 'sqlite') {
    db.prepare('INSERT INTO saved_searches (user_id, payload, created_at) VALUES (?, ?, ?)').run(
      userId,
      JSON.stringify(payload),
      createdAt,
    );
    // Only the latest 20 are ever read; keep 50 and drop the rest, so the
    // table cannot grow without end for someone who searches every day.
    db.prepare(
      `DELETE FROM saved_searches WHERE user_id = ? AND id < (
         SELECT MIN(id) FROM (SELECT id FROM saved_searches WHERE user_id = ? ORDER BY id DESC LIMIT 50)
       )`,
    ).run(userId, userId);
    return getSearches(userId);
  }
  const state = readJson();
  const b = bucket(state, userId);
  b.searches.unshift({ ...payload, createdAt });
  b.searches = b.searches.slice(0, 20);
  writeJson(state);
  return b.searches;
}

export function getSearches(userId) {
  if (backend === 'sqlite') {
    return db
      .prepare('SELECT payload, created_at FROM saved_searches WHERE user_id = ? ORDER BY id DESC LIMIT 20')
      .all(userId)
      .map((r) => ({ ...JSON.parse(r.payload), createdAt: r.created_at }));
  }
  return bucket(readJson(), userId).searches;
}

// ---- Single-use tokens (password reset, email verification) ----------------

export function createToken(tokenHash, userId, purpose, expiresAt) {
  const created_at = new Date().toISOString();
  if (backend === 'sqlite') {
    // One live token per purpose, so requesting a new link retires the old one.
    db.prepare('DELETE FROM tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
    db.prepare(
      'INSERT INTO tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(tokenHash, userId, purpose, expiresAt, created_at);
    db.prepare('DELETE FROM tokens WHERE expires_at < ?').run(created_at);
    return;
  }
  const state = readJson();
  state.tokens = state.tokens || {};
  for (const [k, v] of Object.entries(state.tokens)) {
    if (v.user_id === userId && v.purpose === purpose) delete state.tokens[k];
    else if (v.expires_at < created_at) delete state.tokens[k];
  }
  state.tokens[tokenHash] = { user_id: userId, purpose, expires_at: expiresAt, used_at: null, created_at };
  writeJson(state);
}

/** Returns the token only if it exists, matches purpose, is unused and unexpired. */
export function consumeToken(tokenHash, purpose) {
  const now = new Date().toISOString();

  if (backend === 'sqlite') {
    const row = db.prepare('SELECT * FROM tokens WHERE token_hash = ? AND purpose = ?').get(tokenHash, purpose);
    if (!row || row.used_at || row.expires_at < now) return null;
    db.prepare('UPDATE tokens SET used_at = ? WHERE token_hash = ?').run(now, tokenHash);
    return row;
  }

  const state = readJson();
  state.tokens = state.tokens || {};
  const row = state.tokens[tokenHash];
  if (!row || row.purpose !== purpose || row.used_at || row.expires_at < now) return null;
  row.used_at = now;
  writeJson(state);
  return row;
}

// ---- Email verification ----------------------------------------------------

export function markEmailVerified(userId, isEdu) {
  const now = new Date().toISOString();
  if (backend === 'sqlite') {
    db.prepare('UPDATE users SET email_verified_at = ?, is_edu = ? WHERE id = ?').run(now, isEdu ? 1 : 0, userId);
    return;
  }
  const state = readJson();
  const u = state.users.find((x) => x.id === userId);
  if (u) {
    u.email_verified_at = now;
    u.is_edu = isEdu ? 1 : 0;
  }
  writeJson(state);
}

// ---- Federated identities --------------------------------------------------

export function getIdentity(provider, subject) {
  if (backend === 'sqlite') {
    return db.prepare('SELECT * FROM identities WHERE provider = ? AND subject = ?').get(provider, subject) || null;
  }
  const state = readJson();
  return (state.identities || []).find((i) => i.provider === provider && i.subject === subject) || null;
}

export function linkIdentity(provider, subject, userId) {
  const created_at = new Date().toISOString();
  if (backend === 'sqlite') {
    db.prepare(
      'INSERT INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(provider, subject) DO NOTHING',
    ).run(provider, subject, userId, created_at);
    return;
  }
  const state = readJson();
  state.identities = state.identities || [];
  if (!state.identities.some((i) => i.provider === provider && i.subject === subject)) {
    state.identities.push({ provider, subject, user_id: userId, created_at });
  }
  writeJson(state);
}

export function identitiesForUser(userId) {
  if (backend === 'sqlite') {
    return db.prepare('SELECT provider FROM identities WHERE user_id = ?').all(userId).map((r) => r.provider);
  }
  return (readJson().identities || []).filter((i) => i.user_id === userId).map((i) => i.provider);
}

// ---- Export ----------------------------------------------------------------

/** Everything held for one person, for the data-export endpoint. */
export function exportUserData(userId) {
  const user = getUserById(userId);
  return {
    exportedAt: new Date().toISOString(),
    account: user
      ? {
          email: user.email,
          name: user.name || null,
          createdAt: user.created_at,
          emailVerifiedAt: user.email_verified_at || null,
          isEdu: Boolean(user.is_edu),
          reminderEmails: Boolean(user.remind_email),
          weeklyEmail: Boolean(user.digest_email),
          premiumUntil: user.premium_until || null,
          dailyAlerts: Boolean(user.push_alerts),
          referralCode: user.ref_code || null,
          notificationDevices: countPushSubs(userId),
          signInMethods: ['password', ...identitiesForUser(userId)].filter(
            (m) => m !== 'password' || (user.password_hash || '').length > 0,
          ),
        }
      : null,
    ledger: getAdded(userId),
    completed: getDone(userId),
    tracks: getTracks(userId),
    searches: getSearches(userId),
    trackedInternships: getTracked(userId),
    payments: paymentsForUser(userId).map((p) => ({
      kind: p.kind,
      amount: (p.amount_cents / 100).toFixed(2),
      paidAt: p.created_at,
      refundedAt: p.refunded_at || null,
    })),
  };
}

/** Deletes an account and everything attached to it. */
export function deleteUser(userId) {
  if (backend === 'sqlite') {
    const tx = db.transaction(() => {
      for (const t of ['ledger_done', 'ledger_added', 'started_tracks', 'saved_searches', 'sessions', 'tokens', 'identities', 'applications', 'tracked_jobs', 'push_subs']) {
        db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
      }
      // A payment is a sale the business has to account for, so its amount
      // and date stay; the link to the person does not.
      db.prepare('UPDATE payments SET user_id = NULL WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });
    tx();
    return;
  }
  const state = readJson();
  state.users = state.users.filter((u) => u.id !== userId);
  delete state.byUser[String(userId)];
  state.identities = (state.identities || []).filter((i) => i.user_id !== userId);
  for (const [k, v] of Object.entries(state.sessions || {})) if (v.user_id === userId) delete state.sessions[k];
  for (const [k, v] of Object.entries(state.tokens || {})) if (v.user_id === userId) delete state.tokens[k];
  state.pushSubs = (state.pushSubs || []).filter((s) => s.user_id !== userId);
  for (const p of state.payments || []) if (p.user_id === userId) p.user_id = null;
  writeJson(state);
}

// ---- Activity tracking -----------------------------------------------------

/**
 * Records a successful sign-in. A counter and a most-recent timestamp, not an
 * event log: the reporting needs "how many" and "when last", and keeping a
 * dated record of every single visit is more than that question requires.
 */
export function recordLogin(userId, at = new Date().toISOString()) {
  if (backend === 'sqlite') {
    db.prepare('UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = ? WHERE id = ?').run(at, userId);
    return;
  }
  const state = readJson();
  const u = state.users.find((x) => x.id === userId);
  if (!u) return;
  u.login_count = (u.login_count || 0) + 1;
  u.last_login_at = at;
  writeJson(state);
}

/**
 * Records that someone opened an apply link.
 *
 * `job_key` dedupes: clicking Apply on the same posting twice is one
 * internship, not two. The same posting on a different day is still one — a
 * person re-opening a tab has not applied again.
 */
export function recordApplication(userId, { jobKey, title, company, source }, at = new Date().toISOString()) {
  const key = String(jobKey || '').slice(0, 300);
  if (!key) return false;

  if (backend === 'sqlite') {
    const existing = db.prepare('SELECT 1 FROM applications WHERE user_id = ? AND job_key = ?').get(userId, key);
    if (existing) return false;
    db.prepare(
      'INSERT INTO applications (user_id, job_key, title, company, source, applied_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, key, title || null, company || null, source || null, at);
    return true;
  }

  const state = readJson();
  const b = bucket(state, userId);
  if (b.applications.some((a) => a.job_key === key)) return false;
  b.applications.push({ job_key: key, title: title || null, company: company || null, source: source || null, applied_at: at });
  writeJson(state);
  return true;
}

export function getApplications(userId) {
  if (backend === 'sqlite') {
    return db
      .prepare('SELECT job_key, title, company, source, applied_at FROM applications WHERE user_id = ? ORDER BY applied_at DESC')
      .all(userId);
  }
  return [...bucket(readJson(), userId).applications].sort((a, b) => (a.applied_at < b.applied_at ? 1 : -1));
}

// ---- Application tracker ---------------------------------------------------

export const TRACK_STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'closed'];

const trackedRow = (r) => ({
  ...JSON.parse(r.payload),
  jobKey: r.job_key,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Most recently touched first, so what you just changed is at the top. */
export function getTracked(userId) {
  if (backend === 'sqlite') {
    return db
      .prepare('SELECT job_key, payload, status, created_at, updated_at FROM tracked_jobs WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId)
      .map(trackedRow);
  }
  return bucket(readJson(), userId)
    .tracked.map(trackedRow)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function countTracked(userId) {
  if (backend === 'sqlite') return db.prepare('SELECT COUNT(*) AS n FROM tracked_jobs WHERE user_id = ?').get(userId).n;
  return bucket(readJson(), userId).tracked.length;
}

/**
 * Adds an internship, or updates one already tracked. `status` and `payload`
 * are each optional on an update, so saving a posting twice does not reset its
 * stage, and changing the stage does not wipe a note.
 */
export function upsertTracked(userId, jobKey, { payload, status, touch = true } = {}, at = new Date().toISOString()) {
  if (backend === 'sqlite') {
    const existing = db
      .prepare('SELECT payload, status, updated_at FROM tracked_jobs WHERE user_id = ? AND job_key = ?')
      .get(userId, jobKey);
    if (existing) {
      const merged = { ...JSON.parse(existing.payload), ...(payload || {}) };
      // `touch: false` is for bookkeeping the person did not do — marking a
      // reminder as sent must not show up as "updated today".
      db.prepare('UPDATE tracked_jobs SET payload = ?, status = ?, updated_at = ? WHERE user_id = ? AND job_key = ?').run(
        JSON.stringify(merged),
        status || existing.status,
        touch ? at : existing.updated_at,
        userId,
        jobKey,
      );
      return;
    }
    db.prepare(
      'INSERT INTO tracked_jobs (user_id, job_key, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, jobKey, JSON.stringify(payload || {}), status || 'saved', at, at);
    return;
  }
  const state = readJson();
  const b = bucket(state, userId);
  const row = b.tracked.find((r) => r.job_key === jobKey);
  if (row) {
    row.payload = JSON.stringify({ ...JSON.parse(row.payload), ...(payload || {}) });
    row.status = status || row.status;
    if (touch) row.updated_at = at;
  } else {
    b.tracked.push({ job_key: jobKey, payload: JSON.stringify(payload || {}), status: status || 'saved', created_at: at, updated_at: at });
  }
  writeJson(state);
}

// ---- Reminder emails -------------------------------------------------------

export function setRemindEmail(userId, on) {
  if (backend === 'sqlite') {
    db.prepare('UPDATE users SET remind_email = ? WHERE id = ?').run(on ? 1 : 0, userId);
    return;
  }
  const state = readJson();
  const u = state.users.find((x) => x.id === userId);
  if (u) u.remind_email = on ? 1 : 0;
  writeJson(state);
}

/** Everyone who asked for reminders, with the address to send them to. */
export function usersWantingReminders() {
  if (backend === 'sqlite') return db.prepare('SELECT id, email FROM users WHERE remind_email = 1').all();
  return readJson()
    .users.filter((u) => u.remind_email)
    .map((u) => ({ id: u.id, email: u.email }));
}

// ---- Weekly new-internships email -------------------------------------------

const parseState = (raw) => {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export function setDigestEmail(userId, on) {
  if (backend === 'sqlite') {
    db.prepare('UPDATE users SET digest_email = ? WHERE id = ?').run(on ? 1 : 0, userId);
    return;
  }
  const state = readJson();
  const u = state.users.find((x) => x.id === userId);
  if (u) u.digest_email = on ? 1 : 0;
  writeJson(state);
}

export function getDigestState(userId) {
  return parseState(getUserById(userId)?.digest_state);
}

export function setDigestState(userId, value) {
  const raw = JSON.stringify(value);
  if (backend === 'sqlite') {
    db.prepare('UPDATE users SET digest_state = ? WHERE id = ?').run(raw, userId);
    return;
  }
  const state = readJson();
  const u = state.users.find((x) => x.id === userId);
  if (u) u.digest_state = raw;
  writeJson(state);
}

/** Everyone who asked for the weekly email and has confirmed their address. */
export function usersWantingDigest() {
  const rows =
    backend === 'sqlite'
      ? db.prepare('SELECT id, email, digest_state FROM users WHERE digest_email = 1 AND email_verified_at IS NOT NULL').all()
      : readJson().users.filter((u) => u.digest_email && u.email_verified_at);
  return rows.map((u) => ({ id: u.id, email: u.email, state: parseState(u.digest_state) }));
}

/** The account an unsubscribe link belongs to, or null. */
export function userByDigestToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const rows =
    backend === 'sqlite'
      ? db.prepare("SELECT id, email, digest_email, digest_state FROM users WHERE digest_state LIKE '%unsub%'").all()
      : readJson().users;
  const hit = rows.find((u) => parseState(u.digest_state).unsub === token);
  return hit ? { id: hit.id, email: hit.email, enabled: Boolean(hit.digest_email) } : null;
}

export function removeTracked(userId, jobKey) {
  if (backend === 'sqlite') {
    db.prepare('DELETE FROM tracked_jobs WHERE user_id = ? AND job_key = ?').run(userId, jobKey);
    return;
  }
  const state = readJson();
  const b = bucket(state, userId);
  b.tracked = b.tracked.filter((r) => r.job_key !== jobKey);
  writeJson(state);
}

/**
 * One row per account, for the activity report. Email is included because the
 * report is for whoever operates the site; anyone exporting it is handling
 * personal data and the spreadsheet says so on its own front sheet.
 */
export function activityByUser() {
  if (backend === 'sqlite') {
    return db
      .prepare(
        `SELECT u.id,
                u.email,
                u.name,
                u.created_at,
                COALESCE(u.login_count, 0)            AS login_count,
                u.last_login_at,
                (SELECT COUNT(*) FROM ledger_done  d WHERE d.user_id = u.id) AS certifications_completed,
                (SELECT COUNT(*) FROM ledger_added a WHERE a.user_id = u.id) AS ledger_items,
                (SELECT COUNT(*) FROM applications p WHERE p.user_id = u.id) AS internships_applied,
                (SELECT MAX(done_at)    FROM ledger_done  d WHERE d.user_id = u.id) AS last_completion_at,
                (SELECT MAX(applied_at) FROM applications p WHERE p.user_id = u.id) AS last_application_at
           FROM users u
          ORDER BY u.id`,
      )
      .all();
  }

  const state = readJson();
  return state.users.map((u) => {
    const b = bucket(state, u.id);
    const doneDates = Object.values(b.done);
    const appDates = b.applications.map((a) => a.applied_at);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      created_at: u.created_at,
      login_count: u.login_count || 0,
      last_login_at: u.last_login_at || null,
      certifications_completed: doneDates.length,
      ledger_items: b.added.length,
      internships_applied: b.applications.length,
      last_completion_at: doneDates.length ? doneDates.sort().at(-1) : null,
      last_application_at: appDates.length ? appDates.sort().at(-1) : null,
    };
  });
}

/** Every completion and application as dated rows, for the trend sheet. */
export function activityEvents() {
  if (backend === 'sqlite') {
    const done = db.prepare('SELECT user_id, item_id AS ref, done_at AS at FROM ledger_done').all();
    const apps = db.prepare('SELECT user_id, job_key AS ref, applied_at AS at FROM applications').all();
    return [
      ...done.map((r) => ({ ...r, kind: 'certification' })),
      ...apps.map((r) => ({ ...r, kind: 'application' })),
    ];
  }
  const state = readJson();
  const out = [];
  for (const u of state.users) {
    const b = bucket(state, u.id);
    for (const [ref, at] of Object.entries(b.done)) out.push({ user_id: u.id, ref, at, kind: 'certification' });
    for (const a of b.applications) out.push({ user_id: u.id, ref: a.job_key, at: a.applied_at, kind: 'application' });
  }
  return out;
}

// ---- Account fields added with Premium --------------------------------------

/** Sets columns on the users row. Only the names listed here can be written. */
const USER_FIELDS = new Set(['premium_until', 'ref_code', 'push_alerts', 'alert_state']);
export function setUserFields(userId, fields) {
  const entries = Object.entries(fields).filter(([k]) => USER_FIELDS.has(k));
  if (!entries.length) return;
  if (backend === 'sqlite') {
    db.prepare(`UPDATE users SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...entries.map(([, v]) => v), userId);
    return;
  }
  const state = readJson();
  const u = state.users.find((x) => x.id === userId);
  if (u) for (const [k, v] of entries) u[k] = v;
  writeJson(state);
}

// With Premium switched off (server/features.js) nobody has it, which turns
// every perk off in one place. The stored dates are kept.
export const isPremium = (user, now = new Date()) =>
  Boolean(PREMIUM_ENABLED && user?.premium_until && new Date(user.premium_until) > now);

export function getAlertState(userId) {
  return parseState(getUserById(userId)?.alert_state);
}

/** Premium members who turned on the daily alert. */
export function usersWantingAlerts(now = new Date()) {
  const iso = now.toISOString();
  const rows =
    backend === 'sqlite'
      ? db.prepare('SELECT id, alert_state FROM users WHERE push_alerts = 1 AND premium_until > ?').all(iso)
      : readJson().users.filter((u) => u.push_alerts && u.premium_until > iso);
  return rows.map((u) => ({ id: u.id, state: parseState(u.alert_state) }));
}

// ---- Notification subscriptions ---------------------------------------------

export function addPushSub(userId, endpoint, keys) {
  const at = new Date().toISOString();
  if (backend === 'sqlite') {
    // One browser, one row. If someone else signs in on that browser and
    // turns notifications on, it becomes theirs.
    db.prepare(
      `INSERT INTO push_subs (endpoint, user_id, keys, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys`,
    ).run(endpoint, userId, seal(JSON.stringify(keys)), at);
    return;
  }
  const state = readJson();
  state.pushSubs = (state.pushSubs || []).filter((s) => s.endpoint !== endpoint);
  state.pushSubs.push({ endpoint, user_id: userId, keys: seal(JSON.stringify(keys)), created_at: at });
  writeJson(state);
}

/** Removes a subscription. With a user id, only if it is that person's. */
export function removePushSub(endpoint, userId = null) {
  if (backend === 'sqlite') {
    if (userId === null) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
    else db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(endpoint, userId);
    return;
  }
  const state = readJson();
  state.pushSubs = (state.pushSubs || []).filter((s) => !(s.endpoint === endpoint && (userId === null || s.user_id === userId)));
  writeJson(state);
}

export function pushSubsFor(userId) {
  const rows =
    backend === 'sqlite'
      ? db.prepare('SELECT endpoint, keys FROM push_subs WHERE user_id = ?').all(userId)
      : (readJson().pushSubs || []).filter((s) => s.user_id === userId);
  // The keys are stored encrypted (server/seal.js). One that cannot be opened
  // (the encryption key changed) is skipped; the browser can sign up again.
  return rows
    .map((r) => ({ endpoint: r.endpoint, keys: parseState(unseal(r.keys)) }))
    .filter((r) => r.keys.p256dh && r.keys.auth);
}

export function hasPushSub(userId, endpoint) {
  return pushSubsFor(userId).some((s) => s.endpoint === endpoint);
}

export function countPushSubs(userId = null) {
  if (backend === 'sqlite') {
    return userId === null
      ? db.prepare('SELECT COUNT(*) n FROM push_subs').get().n
      : db.prepare('SELECT COUNT(*) n FROM push_subs WHERE user_id = ?').get(userId).n;
  }
  const subs = readJson().pushSubs || [];
  return userId === null ? subs.length : subs.filter((s) => s.user_id === userId).length;
}

/** Everyone with at least one browser signed up for notifications. */
export function usersWithPush() {
  if (backend === 'sqlite') {
    return db.prepare('SELECT DISTINCT u.id, u.email FROM users u JOIN push_subs p ON p.user_id = u.id').all();
  }
  const state = readJson();
  const ids = new Set((state.pushSubs || []).map((s) => s.user_id));
  return state.users.filter((u) => ids.has(u.id)).map((u) => ({ id: u.id, email: u.email }));
}

// ---- Payments ----------------------------------------------------------------

/** Records a completed checkout. False if this session was already recorded. */
export function recordPayment({ userId = null, kind, sessionId, paymentIntent = null, amountCents, refCode = null }) {
  const at = new Date().toISOString();
  if (backend === 'sqlite') {
    const info = db
      .prepare(
        `INSERT INTO payments (user_id, kind, session_id, payment_intent, amount_cents, ref_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO NOTHING`,
      )
      .run(userId, kind, sessionId, paymentIntent, amountCents, refCode, at);
    return info.changes === 1;
  }
  const state = readJson();
  state.payments = state.payments || [];
  if (state.payments.some((p) => p.session_id === sessionId)) return false;
  state.payments.push({
    id: state.payments.length + 1,
    user_id: userId,
    kind,
    session_id: sessionId,
    payment_intent: paymentIntent,
    amount_cents: amountCents,
    ref_code: refCode,
    created_at: at,
    refunded_at: null,
  });
  writeJson(state);
  return true;
}

export function paymentByIntent(paymentIntent) {
  if (!paymentIntent) return null;
  if (backend === 'sqlite') return db.prepare('SELECT * FROM payments WHERE payment_intent = ?').get(paymentIntent) || null;
  return (readJson().payments || []).find((p) => p.payment_intent === paymentIntent) || null;
}

/** Marks a payment refunded. False if it already was. */
export function markRefunded(id, at = new Date().toISOString()) {
  if (backend === 'sqlite') {
    return db.prepare('UPDATE payments SET refunded_at = ? WHERE id = ? AND refunded_at IS NULL').run(at, id).changes === 1;
  }
  const state = readJson();
  const p = (state.payments || []).find((x) => x.id === id);
  if (!p || p.refunded_at) return false;
  p.refunded_at = at;
  writeJson(state);
  return true;
}

export function paymentsForUser(userId) {
  if (backend === 'sqlite') return db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC').all(userId);
  return (readJson().payments || []).filter((p) => p.user_id === userId).reverse();
}

/** Sales for /owner: count and net revenue by kind, and by referral code. */
export function salesSummary() {
  const rows = backend === 'sqlite' ? db.prepare('SELECT kind, amount_cents, ref_code, refunded_at, created_at FROM payments').all() : readJson().payments || [];
  const byKind = {};
  const byRef = {};
  for (const p of rows) {
    const k = (byKind[p.kind] = byKind[p.kind] || { sales: 0, refunds: 0, netCents: 0 });
    if (p.refunded_at) k.refunds += 1;
    else {
      k.sales += 1;
      k.netCents += p.amount_cents;
    }
    if (p.ref_code && p.kind === 'premium' && !p.refunded_at) byRef[p.ref_code] = (byRef[p.ref_code] || 0) + 1;
  }
  return { byKind, premiumByRef: byRef, recent: [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10) };
}

/** Premium bought since an ISO time, for the funnel on /owner: paid, and how many of those were refunded. */
export function premiumSalesSince(sinceIso) {
  const rows = backend === 'sqlite' ? db.prepare("SELECT refunded_at, created_at FROM payments WHERE kind = 'premium'").all() : (readJson().payments || []).filter((p) => p.kind === 'premium');
  const recent = rows.filter((p) => String(p.created_at) >= sinceIso);
  return { paid: recent.length, refunded: recent.filter((p) => p.refunded_at).length };
}

/** Accounts per referral code, for /owner. */
export function signupsByRef() {
  if (backend === 'sqlite') {
    return Object.fromEntries(
      db.prepare('SELECT ref_code, COUNT(*) n FROM users WHERE ref_code IS NOT NULL GROUP BY ref_code').all().map((r) => [r.ref_code, r.n]),
    );
  }
  const out = {};
  for (const u of readJson().users) if (u.ref_code) out[u.ref_code] = (out[u.ref_code] || 0) + 1;
  return out;
}

// ---- Sponsored listings --------------------------------------------------------

const SPONSORED_FIELDS = new Set([
  'status', 'session_id', 'payment_intent', 'amount_cents', 'paid_at', 'starts_at', 'ends_at',
]);

const sponsoredRow = (r) => (r ? { ...r, majors: parseState(r.majors), remote: Boolean(r.remote) } : null);

export function createSponsored(s) {
  const row = {
    status: 'unpaid',
    company: s.company,
    title: s.title,
    url: s.url,
    location: s.location || null,
    zip: s.zip || null,
    lat: s.lat ?? null,
    lon: s.lon ?? null,
    remote: s.remote ? 1 : 0,
    majors: JSON.stringify(s.majors || []),
    contact_email: s.contactEmail,
    created_at: new Date().toISOString(),
  };
  if (backend === 'sqlite') {
    const cols = Object.keys(row);
    const info = db.prepare(`INSERT INTO sponsored (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(row));
    return Number(info.lastInsertRowid);
  }
  const state = readJson();
  state.sponsored = state.sponsored || [];
  const id = state.sponsored.length + 1;
  state.sponsored.push({ id, impressions: 0, clicks: 0, ...row });
  writeJson(state);
  return id;
}

/** An identical listing submitted since `since` and not yet paid, or null. */
export function findUnpaidSponsored(s, since) {
  const iso = since.toISOString();
  const majors = JSON.stringify(s.majors || []);
  const rows =
    backend === 'sqlite'
      ? db
          .prepare(
            "SELECT id, company, title, url, zip, remote, majors, contact_email FROM sponsored WHERE status = 'unpaid' AND contact_email = ? AND url = ? AND created_at >= ? ORDER BY id DESC",
          )
          .all(s.contactEmail, s.url, iso)
      : (readJson().sponsored || []).filter((r) => r.status === 'unpaid' && r.contact_email === s.contactEmail && r.url === s.url && r.created_at >= iso).reverse();
  const hit = rows.find(
    (r) => r.company === s.company && r.title === s.title && (r.zip || null) === (s.zip || null) && Boolean(r.remote) === Boolean(s.remote) && r.majors === majors,
  );
  return hit ? hit.id : null;
}

export function getSponsored(id) {
  if (backend === 'sqlite') return sponsoredRow(db.prepare('SELECT * FROM sponsored WHERE id = ?').get(id));
  return sponsoredRow((readJson().sponsored || []).find((s) => s.id === id));
}

export function updateSponsored(id, fields) {
  const entries = Object.entries(fields).filter(([k]) => SPONSORED_FIELDS.has(k));
  if (!entries.length) return;
  if (backend === 'sqlite') {
    db.prepare(`UPDATE sponsored SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...entries.map(([, v]) => v), id);
    return;
  }
  const state = readJson();
  const s = (state.sponsored || []).find((x) => x.id === id);
  if (s) for (const [k, v] of entries) s[k] = v;
  writeJson(state);
}

/** Every listing that has been paid for, newest first (unpaid drafts are left out). */
export function listSponsored() {
  const rows =
    backend === 'sqlite'
      ? db.prepare("SELECT * FROM sponsored WHERE status != 'unpaid' ORDER BY id DESC LIMIT 200").all()
      : (readJson().sponsored || []).filter((s) => s.status !== 'unpaid').reverse();
  return rows.map(sponsoredRow);
}

/** Approved listings inside their 30 days. */
export function liveSponsored(now = new Date()) {
  const iso = now.toISOString();
  const rows =
    backend === 'sqlite'
      ? db.prepare("SELECT * FROM sponsored WHERE status = 'live' AND starts_at <= ? AND ends_at > ?").all(iso, iso)
      : (readJson().sponsored || []).filter((s) => s.status === 'live' && s.starts_at <= iso && s.ends_at > iso);
  return rows.map(sponsoredRow);
}

/** Adds to a listing's impression or click count. */
export function bumpSponsored(ids, column) {
  if (!['impressions', 'clicks'].includes(column) || !ids.length) return;
  if (backend === 'sqlite') {
    const stmt = db.prepare(`UPDATE sponsored SET ${column} = ${column} + 1 WHERE id = ?`);
    for (const id of ids) stmt.run(id);
    return;
  }
  const state = readJson();
  for (const s of state.sponsored || []) if (ids.includes(s.id)) s[column] = (s[column] || 0) + 1;
  writeJson(state);
}

// ---- Meta ------------------------------------------------------------------

function getMeta(key) {
  if (backend === 'sqlite') {
    return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  }
  return readJson().meta?.[key] ?? null;
}

function setMeta(key, value) {
  if (backend === 'sqlite') {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      value,
    );
    return;
  }
  const state = readJson();
  state.meta = { ...(state.meta || {}), [key]: value };
  writeJson(state);
}

export { getMeta, setMeta };
