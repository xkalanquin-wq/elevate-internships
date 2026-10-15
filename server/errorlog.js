// A short log of recent errors, shown on /owner, so a problem is visible
// without digging through the host's logs.
//
// Every console.error line in the server lands here (the codebase already
// reports failures that way: "[email] send failed", "[backup] FAILED", …),
// along with crashes, unexpected route errors and errors reported by visitors'
// browsers. Repeats of the same message are counted rather than stored again.
// Messages are cut short and never include request bodies, cookies or keys.

const MAX = 60;
let entries = [];
let persist = null;
let dirty = false;

const clip = (s, n = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// API keys and tokens that might appear in an error message are masked.
const SECRET = /(sk|rk|pk|whsec)_(test|live)_[A-Za-z0-9]+|re_[A-Za-z0-9]{20,}|Bearer\s+\S+|app_key=[^&\s]+|token=[^&\s]+/g;
const scrub = (s) => s.replace(SECRET, '[hidden]');

export function logError(source, message) {
  const text = scrub(clip(message));
  if (!text) return;
  const now = new Date().toISOString();
  const same = entries.find((e) => e.source === source && e.message === text);
  if (same) {
    same.count += 1;
    same.last = now;
  } else {
    entries.unshift({ source, message: text, count: 1, first: now, last: now });
    entries = entries.slice(0, MAX);
  }
  dirty = true;
}

export const recentErrors = () => [...entries].sort((a, b) => b.last.localeCompare(a.last));

export function clearErrors() {
  entries = [];
  dirty = true;
}

/**
 * Starts capturing: console.error, unhandled promise rejections and uncaught
 * exceptions. Saved to the database every few minutes so a restart keeps them.
 */
export function startErrorLog({ getMeta, setMeta }) {
  persist = { getMeta, setMeta };
  try {
    const saved = JSON.parse(getMeta('errors.v1') || '[]');
    if (Array.isArray(saved)) entries = saved.slice(0, MAX);
  } catch {
    /* start empty */
  }

  const original = console.error.bind(console);
  console.error = (...args) => {
    original(...args);
    try {
      logError('server', args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    } catch {
      /* logging must never throw */
    }
  };

  process.on('unhandledRejection', (reason) => {
    console.error(`[crash] unhandled promise rejection: ${reason?.stack || reason}`);
  });
  process.on('uncaughtException', (err) => {
    console.error(`[crash] uncaught exception: ${err?.stack || err}`);
    flush();
    // The process is in an unknown state. SIGTERM runs the normal shutdown,
    // which saves the database to Cloudflare first; the host then restarts it.
    process.kill(process.pid, 'SIGTERM');
    setTimeout(() => process.exit(1), 20_000).unref();
  });

  setInterval(flush, 3 * 60_000).unref();
}

export function flush() {
  if (!persist || !dirty) return;
  dirty = false;
  try {
    persist.setMeta('errors.v1', JSON.stringify(entries));
  } catch {
    /* next time */
  }
}
