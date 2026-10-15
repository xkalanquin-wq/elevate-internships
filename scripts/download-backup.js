// Downloads the live database from Cloudflare KV to this computer, so a copy
// exists outside Cloudflare. Run it about once a month:
//
//   npm run backup:download               -> Documents/Elevate Internships backups
//   npm run backup:download -- --out D:\backups
//   npm run backup:download -- --list     (show the daily copies Cloudflare holds)
//   npm run backup:download -- --daily 2026-09-20   (a dated daily copy instead)
//
// Reads CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID and CF_API_TOKEN from a .env file
// in the project folder (or the environment). It only ever reads from
// Cloudflare; nothing is uploaded or changed there.
//
// Each download is checked before it is kept: it must be a SQLite file that
// passes PRAGMA integrity_check and has a users table.

import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ACCOUNT = process.env.CF_ACCOUNT_ID?.trim();
const NAMESPACE = process.env.CF_KV_NAMESPACE_ID?.trim();
const TOKEN = process.env.CF_API_TOKEN?.trim();

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] || '';
};

if (!ACCOUNT || !NAMESPACE || !TOKEN) {
  console.error('Set CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID and CF_API_TOKEN in a .env file in this folder first (see DEPLOY.md).');
  process.exit(1);
}

const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${NAMESPACE}`;
const headers = { Authorization: `Bearer ${TOKEN}` };

async function listDaily() {
  const res = await fetch(`${base}/keys?prefix=${encodeURIComponent('backup/')}&limit=1000`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Listing failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json.result || []).map((k) => k.name).sort();
}

async function download(key) {
  const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, { headers, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Download of ${key} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function check(file) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`integrity check said: ${integrity}`);
    const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    return { users };
  } finally {
    db.close();
  }
}

try {
  if (args.includes('--list')) {
    const keys = await listDaily();
    console.log(keys.length ? keys.join('\n') : 'No daily copies found.');
    process.exit(0);
  }

  const daily = flag('--daily');
  if (daily !== null && !/^\d{4}-\d{2}-\d{2}$/.test(daily)) throw new Error('Use --daily YYYY-MM-DD.');
  const key = daily ? `backup/launchpad-${daily}.db` : 'launchpad.db';

  const outDir = flag('--out') || path.join(os.homedir(), 'Documents', 'Elevate Internships backups');
  fs.mkdirSync(outDir, { recursive: true });

  const bytes = await download(key);
  if (bytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3') throw new Error(`${key} is not a SQLite database.`);

  const stamp = daily || new Date().toISOString().slice(0, 10);
  const file = path.join(outDir, `launchpad-${stamp}.db`);
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, bytes);
  try {
    const { users } = await check(tmp);
    fs.renameSync(tmp, file);
    console.log(`Backed up ${Math.round(bytes.length / 1024)} KB (${users} account${users === 1 ? '' : 's'}) to:\n  ${file}`);
    console.log('It holds personal data (emails and password hashes), so keep it somewhere private.');
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`The download failed its check and was not kept: ${err.message}`);
  }
} catch (err) {
  console.error(`Backup FAILED: ${err.message}`);
  process.exit(1);
}
