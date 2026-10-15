/**
 * Takes a consistent, verified snapshot of the database.
 *
 *   node scripts/backup.js            # write a snapshot, prune old ones
 *   node scripts/backup.js --list     # show what is currently held
 *   node scripts/backup.js --keep 30  # override retention
 *
 * Why not just copy the file: the database runs in WAL mode, so at any moment
 * some committed data lives in launchpad.db-wal and not yet in launchpad.db.
 * `cp` during a write gives you a torn file that may restore short, or not at
 * all. SQLite's online backup API walks the database page by page while
 * holding the right locks, so the snapshot is consistent even under live
 * traffic — and it does not need the server stopped.
 *
 * Every snapshot is opened afterwards and integrity-checked before any old one
 * is pruned. A backup nobody has verified is a guess, and the moment you find
 * out is the moment you needed it.
 *
 * Exit codes: 0 fine, 1 failed. Non-zero is what your scheduler should alert on.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dataDir = path.join(root, 'data');
const backupDir = path.join(dataDir, 'backups');

const sqlitePath = path.join(dataDir, 'launchpad.db');
const jsonPath = path.join(dataDir, 'launchpad.json');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const KEEP = Math.max(1, Number(flag('--keep', 14)) || 14);

const stampName = () => new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
const kb = (n) => `${Math.round(n / 1024)} KB`;

function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((f) => /^launchpad-.*\.(db|json)$/.test(f))
    .map((f) => {
      const full = path.join(backupDir, f);
      return { name: f, full, size: fs.statSync(full).size, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

if (args.includes('--list')) {
  const all = listBackups();
  if (!all.length) {
    console.log('No backups yet. Run: node scripts/backup.js');
    process.exit(0);
  }
  console.log(`${all.length} backup(s) in ${backupDir}:\n`);
  for (const b of all) console.log(`  ${b.name.padEnd(46)} ${kb(b.size).padStart(9)}   ${new Date(b.mtime).toISOString()}`);
  process.exit(0);
}

fs.mkdirSync(backupDir, { recursive: true });

let written = null;

if (fs.existsSync(sqlitePath)) {
  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch (err) {
    console.error(`FAILED: a launchpad.db exists but better-sqlite3 will not load (${err.code || err.message}).`);
    console.error('Do not fall back to copying the file — WAL mode makes a plain copy unsafe.');
    process.exit(1);
  }

  const dest = path.join(backupDir, `launchpad-${stampName()}.db`);
  const db = new Database(sqlitePath, { readonly: true });

  try {
    await db.backup(dest);
  } catch (err) {
    console.error(`FAILED: backup did not complete — ${err.message}`);
    db.close();
    process.exit(1);
  }
  db.close();

  // The snapshot inherits WAL mode from the live database, so anything that
  // later opens it — the integrity check below, or you after downloading it —
  // makes SQLite create -wal and -shm files beside it. Those were never
  // pruned, so they accumulated forever, and a downloaded snapshot sprouted
  // them wherever it went. A snapshot is a static file; rollback-journal mode
  // makes it one self-contained file. The live database is unaffected and
  // switches itself back to WAL if this file is ever restored.
  try {
    const flat = new Database(dest);
    flat.pragma('journal_mode = DELETE');
    flat.close();
  } catch (err) {
    console.error(`FAILED: could not finalise the snapshot — ${err.message}`);
    fs.rmSync(dest, { force: true });
    process.exit(1);
  }

  // Verify before trusting it enough to prune anything.
  const check = new Database(dest, { readonly: true });
  try {
    const integrity = check.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      console.error(`FAILED: integrity_check on the snapshot returned "${integrity}".`);
      check.close();
      fs.unlinkSync(dest);
      process.exit(1);
    }
    const users = check.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const items = check.prepare('SELECT COUNT(*) AS n FROM ledger_added').get().n;
    const done = check.prepare('SELECT COUNT(*) AS n FROM ledger_done').get().n;
    check.close();
    written = { dest, size: fs.statSync(dest).size, detail: `${users} user(s), ${items} ledger row(s), ${done} completion(s)` };
  } catch (err) {
    check.close();
    console.error(`FAILED: snapshot could not be read back — ${err.message}`);
    fs.unlinkSync(dest);
    process.exit(1);
  }
} else if (fs.existsSync(jsonPath)) {
  // The JSON store is rewritten whole, so a copy is as consistent as it gets.
  // Parse it first: copying a half-written file forward is worse than failing.
  const raw = fs.readFileSync(jsonPath, 'utf8');
  try {
    JSON.parse(raw);
  } catch (err) {
    console.error(`FAILED: launchpad.json is not valid JSON right now (${err.message}). Not backing up a torn file.`);
    process.exit(1);
  }
  const dest = path.join(backupDir, `launchpad-${stampName()}.json`);
  fs.writeFileSync(dest, raw, 'utf8');
  written = { dest, size: Buffer.byteLength(raw), detail: 'JSON store' };
} else {
  console.error(`FAILED: no database found in ${dataDir}. Has the server ever run?`);
  process.exit(1);
}

console.log(`Backed up  ->  ${path.relative(root, written.dest)}`);
console.log(`           ${kb(written.size)}, ${written.detail}`);

// Prune, newest first, only after the new snapshot verified.
const all = listBackups();
const stale = all.slice(KEEP);
const dropWithSidecars = (full) => {
  for (const f of [full, `${full}-wal`, `${full}-shm`]) fs.rmSync(f, { force: true });
};
for (const b of stale) {
  dropWithSidecars(b.full);
  console.log(`Pruned     ${b.name}`);
}

// Sidecars left behind by earlier versions of this script, which did not flatten
// snapshots and so left -wal/-shm files that were never pruned. Nothing but this
// script opens files in data/backups, and it no longer creates them, so these
// are leftovers. An empty -wal is required anyway: a non-empty one would hold
// pages not yet in its snapshot, and deleting that would lose them.
let swept = 0;
for (const f of fs.readdirSync(backupDir)) {
  const m = /^(launchpad-.*\.db)-(wal|shm)$/.exec(f);
  if (!m) continue;
  const wal = path.join(backupDir, `${m[1]}-wal`);
  const walEmpty = !fs.existsSync(wal) || fs.statSync(wal).size === 0;
  if (walEmpty) {
    fs.rmSync(path.join(backupDir, f), { force: true });
    swept++;
  }
}
if (swept) console.log(`Swept      ${swept} leftover sidecar file(s)`);
console.log(`Retained   ${Math.min(all.length, KEEP)} of ${all.length} (keep=${KEEP})`);
