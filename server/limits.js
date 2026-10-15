// Daily caps on the outside services that have a free allowance or a cost,
// so a traffic spike (or a bug) can never run past a free tier or run up a
// bill:
//
//   adzuna    Adzuna API requests. Free tier: 250 a day.        ADZUNA_DAILY_CAP, default 240
//   email     Emails sent. Resend free plan: 100 a day.          EMAIL_DAILY_CAP, default 95
//             Bulk mail (reminders, weekly email, alerts to the
//             owner) stops at 80% so password resets and
//             confirmations always have room.
//   suggest   "Suggest more" (Claude API, paid per use).        SUGGEST_DAILY_CAP, default 50
//
// Days are UTC, like the services' own counters. Counts are kept in memory
// and saved to the database's meta table, so a restart does not reset them.

const DEFAULTS = { adzuna: 240, email: 95, suggest: 50 };
const ENV = { adzuna: 'ADZUNA_DAILY_CAP', email: 'EMAIL_DAILY_CAP', suggest: 'SUGGEST_DAILY_CAP' };
const BULK_SHARE = 0.8;

let persist = null;
let state = { day: '', used: {} };

const today = () => new Date().toISOString().slice(0, 10);

export function capFor(name) {
  const raw = Number(process.env[ENV[name]]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULTS[name];
}

function roll() {
  const d = today();
  if (state.day !== d) state = { day: d, used: {} };
}

/** Loads today's counts from the database. Call once at startup. */
export function configureLimits({ getMeta, setMeta }) {
  persist = { getMeta, setMeta };
  try {
    const saved = JSON.parse(getMeta('limits.v1') || 'null');
    if (saved?.day === today() && saved.used && typeof saved.used === 'object') state = saved;
  } catch {
    /* start from zero */
  }
}

let saveTimer = null;
function save() {
  if (!persist || saveTimer) return;
  // Batched: a burst of calls is one write.
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      persist.setMeta('limits.v1', JSON.stringify(state));
    } catch (err) {
      console.error(`[limits] could not save counts: ${err.message}`);
    }
  }, 5_000);
  saveTimer.unref?.();
}

/**
 * Uses one unit of `name` if today's cap allows it. `bulk: true` may only use
 * the first 80% of the cap. Returns true when the call may go ahead.
 */
export function take(name, { bulk = false } = {}) {
  roll();
  const cap = capFor(name);
  const limit = bulk ? Math.floor(cap * BULK_SHARE) : cap;
  const used = state.used[name] || 0;
  if (used >= limit) {
    if (used === limit) console.warn(`[limits] ${name} reached its daily cap of ${limit}${bulk ? ' for bulk use' : ''}`);
    return false;
  }
  state.used[name] = used + 1;
  save();
  return true;
}

/** Today's use and caps, for /owner. */
export function usage() {
  roll();
  return Object.keys(DEFAULTS).map((name) => ({ name, used: state.used[name] || 0, cap: capFor(name) }));
}

/** For tests. */
export function resetLimits() {
  state = { day: today(), used: {} };
}
