// Wipes local state. Run: npm run reset
//
//   npm run reset            empty the ledger (items, marks, tracks)
//   npm run reset -- --all   also clear saved searches and the geocode cache
//
// Works against whichever backend the app is using, so it behaves the same on
// SQLite and on the JSON fallback.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');
const all = process.argv.includes('--all');

let cleared = [];

// --- SQLite -----------------------------------------------------------------
const dbPath = path.join(dataDir, 'launchpad.db');
if (fs.existsSync(dbPath)) {
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(dbPath);

    const count = (t) => {
      try {
        return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
      } catch {
        return null;
      }
    };
    const wipe = (t) => {
      const before = count(t);
      if (before === null) return;
      db.prepare(`DELETE FROM ${t}`).run();
      cleared.push(`${t}: ${before} -> 0`);
    };

    wipe('ledger_added');
    wipe('ledger_done');
    wipe('started_tracks');
    if (all) wipe('saved_searches');

    // Keep the one-time seed flag set, so clearing does not resurrect the
    // imported progress on the next restart.
    db.prepare("INSERT INTO meta (key, value) VALUES ('seeded','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
    db.close();
    console.log(`sqlite (${path.relative(process.cwd(), dbPath)})`);
  } catch (err) {
    console.error(`Could not open the SQLite file: ${err.message}`);
    process.exitCode = 1;
  }
}

// --- JSON fallback ----------------------------------------------------------
const jsonPath = path.join(dataDir, 'launchpad.json');
if (fs.existsSync(jsonPath)) {
  const state = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  cleared.push(
    `added: ${(state.added || []).length} -> 0`,
    `done: ${Object.keys(state.done || {}).length} -> 0`,
    `tracks: ${(state.tracks || []).length} -> 0`,
  );
  state.added = [];
  state.done = {};
  state.tracks = [];
  if (all) {
    cleared.push(`searches: ${(state.searches || []).length} -> 0`);
    state.searches = [];
  }
  state.meta = { ...(state.meta || {}), seeded: '1' };
  fs.writeFileSync(jsonPath, JSON.stringify(state, null, 2));
  console.log(`json (${path.relative(process.cwd(), jsonPath)})`);
}

if (all) {
  const cache = path.join(dataDir, 'geocache.json');
  if (fs.existsSync(cache)) {
    fs.rmSync(cache);
    cleared.push('geocache: removed');
  }
}

if (cleared.length === 0) {
  console.log('Nothing to clear — no local data files found.');
} else {
  for (const line of cleared) console.log(`  ${line}`);
  console.log(`\nLedger is empty${all ? ', searches and geocode cache cleared' : ''}.`);
  console.log('Restart the server so it reloads from disk.');
}
