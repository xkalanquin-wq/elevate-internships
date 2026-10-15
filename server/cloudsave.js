// Keeps the SQLite database alive on a host with no persistent disk.
//
// Render's free plan (and similar) gives the app a fresh, empty filesystem on
// every restart, redeploy and wake-from-sleep. Without this, every account
// would vanish the first time the server went idle for fifteen minutes.
//
// So the whole database file is copied to Cloudflare Workers KV:
//   * on boot, before SQLite opens, the latest copy is downloaded
//   * while running, it is uploaded shortly after anything changes
//   * on shutdown (SIGTERM), it is uploaded one last time
//   * once a day, a dated copy is kept for 14 days as a backup
//
// KV's free tier allows 1,000 writes a day. Saves are at most one per
// SAVE_EVERY_MS (two minutes), so even a server that is busy around the clock
// stays near 720, plus the daily backup.
//
// Enabled only when all three CF_* variables are set. Locally, with none of
// them, this module does nothing and the database stays in ./data as before.

const ACCOUNT = process.env.CF_ACCOUNT_ID?.trim();
const NAMESPACE = process.env.CF_KV_NAMESPACE_ID?.trim();
const TOKEN = process.env.CF_API_TOKEN?.trim();

const LIVE_KEY = 'launchpad.db';
const SAVE_EVERY_MS = 2 * 60 * 1000;
const DAILY_TTL_SECONDS = 14 * 24 * 60 * 60;
const KV_VALUE_LIMIT = 25 * 1024 * 1024;

export const cloudSaveEnabled = () => Boolean(ACCOUNT && NAMESPACE && TOKEN);

const valueUrl = (key, query = '') =>
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${NAMESPACE}/values/${encodeURIComponent(key)}${query}`;

async function kvGet(key) {
  const res = await fetch(valueUrl(key), {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    // 404 means "no such key" (code 10009) on a first boot — but a mistyped
    // namespace is also a 404 (code 10013), and that must not pass as empty.
    if (res.status === 404 && !/10013|namespace/i.test(body)) return null;
    throw new Error(`GET ${key}: HTTP ${res.status} ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function kvPut(key, bytes, ttlSeconds) {
  const query = ttlSeconds ? `?expiration_ttl=${ttlSeconds}` : '';
  const res = await fetch(valueUrl(key, query), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' },
    body: bytes,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`PUT ${key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/**
 * Downloads the saved database. Returns the bytes, or null on a first-ever
 * boot when nothing has been saved yet.
 *
 * Any other failure throws, and the caller refuses to start. Starting empty
 * after a failed download would be the worst outcome: the first save would
 * then overwrite every real account with a blank database.
 */
export async function restore() {
  const bytes = await kvGet(LIVE_KEY);
  if (bytes && bytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3') {
    throw new Error(`saved copy is not a SQLite database (${bytes.length} bytes)`);
  }
  return bytes;
}

/**
 * Starts the save loop. `snapshot()` returns the database as a Buffer and
 * `changes()` a counter that grows with every write, so an idle server makes
 * no requests at all.
 */
export function startSaving({ snapshot, changes, beforeSave }) {
  let savedAt = changes();
  let lastDaily = '';
  let inFlight = null;

  const save = async (reason) => {
    // Lets in-memory tallies (visit counts) reach the database before it is copied.
    try {
      beforeSave?.();
    } catch (err) {
      console.warn(`[cloudsave] beforeSave failed: ${err.message}`);
    }
    const now = changes();
    const today = new Date().toISOString().slice(0, 10);
    const dirty = now !== savedAt;
    const dailyDue = lastDaily !== today;
    if (!dirty && !dailyDue) return;

    const bytes = snapshot();
    if (bytes.length > KV_VALUE_LIMIT) {
      console.error(`[cloudsave] FAILED: database is ${bytes.length} bytes, over the 25 MiB KV limit`);
      return;
    }
    try {
      if (dirty) {
        await kvPut(LIVE_KEY, bytes);
        savedAt = now;
      }
      if (dailyDue) {
        await kvPut(`backup/launchpad-${today}.db`, bytes, DAILY_TTL_SECONDS);
        lastDaily = today;
      }
      console.log(`[cloudsave] saved ${Math.round(bytes.length / 1024)} KB (${reason}${dailyDue ? ', daily backup' : ''})`);
    } catch (err) {
      // One greppable prefix, the same convention as [backup] FAILED.
      console.error(`[cloudsave] FAILED: ${err.message}`);
    }
  };

  const run = (reason) => {
    if (!inFlight) inFlight = save(reason).finally(() => (inFlight = null));
    return inFlight;
  };

  // The first run a minute after boot writes the day's backup.
  setTimeout(() => run('startup'), 60 * 1000).unref();
  setInterval(() => run('changes'), SAVE_EVERY_MS).unref();

  // Render sends SIGTERM before sleeping, redeploying or restarting, and waits
  // up to 30 seconds. That is the last chance to keep recent writes.
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[cloudsave] ${signal} — saving before exit`);
    await inFlight;
    await save('shutdown');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log('[cloudsave] on — database is copied to Cloudflare KV every 2 minutes when it changes');
}
