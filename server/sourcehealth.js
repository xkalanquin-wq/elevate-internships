// Whether the job sources and email are working, for an uptime monitor.
//
// /api/health only says the server answers. A revoked or mistyped key does
// not stop it answering: searches quietly lose that source, and a reset email
// quietly never arrives. This keeps the latest result for each source, taken
// from real searches and sends, and /api/health/sources fails when a source
// the operator can fix is failing.
//
// Only Adzuna, USAJOBS and email can fail the check — each depends on a key
// set in the host's settings. The free feeds and employer boards are recorded
// for the owner too, but when one of those is down there is nothing to do
// except wait, so they never raise an alert.

const ALERTING = new Set(['Adzuna', 'USAJOBS', 'Email']);

// Two failures in a row with no success between is worth an email — but only
// failures the operator can do something about: a refused key (401/403), a
// bad request (400) or a used-up quota (429). A busy or down service (5xx, no
// answer in time, network errors) is the other side's problem; Adzuna gives
// runs of 503s on some days. Those are shown to the owner and never alert,
// and they neither add to nor clear a streak of real failures.
const FAILS_BEFORE_ALERT = 2;
const THEIR_SIDE = /HTTP 5\d\d|did not answer in time|abort|timed? ?out|fetch failed|terminated|ECONN|ENOTFOUND|EAI_AGAIN|socket/i;

// With no searches, a source is checked with a small known-good query at most
// this often: 8 a day, well inside Adzuna's 250 calls a day.
const PROBE_EVERY_MS = 3 * 60 * 60_000;
// While a source is failing, re-check it sooner, so a fixed key clears the
// alert within about one monitor interval rather than three hours.
const PROBE_FAILING_EVERY_MS = 10 * 60_000;
// A failed send is only evidence for a while. Email has no probe (it would
// mean sending someone a message), so without this one failure would keep
// the check red until the next real send.
const EMAIL_FAILURE_COUNTS_FOR_MS = 24 * 60 * 60_000;

const state = new Map(); // name -> { ok, at, message, fails, lastOkAt }
const probes = new Map(); // name -> { configured(), run() -> { ok, message } }
const probing = new Map(); // name -> startedAt of a probe in flight
const lastProbeAt = new Map();

/** Record one attempt. `message` is kept only for the owner's view. */
export function recordSource(name, ok, message = '') {
  const prev = state.get(name);
  const now = Date.now();
  const text = ok ? '' : String(message || 'Failed').slice(0, 200);
  const theirs = !ok && THEIR_SIDE.test(text);
  state.set(name, {
    ok,
    theirs,
    at: now,
    message: text,
    fails: ok ? 0 : theirs ? prev?.fails || 0 : (prev?.fails || 0) + 1,
    lastOkAt: ok ? now : prev?.lastOkAt ?? null,
  });
}

/**
 * Record a whole search from its notes: a source with an error note failed,
 * one that was skipped (no key) is not recorded, and the rest succeeded.
 */
export function recordSearch(sourceNames, notes) {
  for (const name of sourceNames) {
    const mine = notes.filter((n) => n.source === name);
    if (mine.some((n) => n.level === 'skipped')) continue;
    const err = mine.find((n) => n.level === 'error');
    recordSource(name, !err, err?.message);
  }
}

/** Register the check used when a source has not been tried for a while. */
export function registerProbe(name, { configured, run }) {
  probes.set(name, { configured, run });
}

function failing(name) {
  const s = state.get(name);
  if (!s || s.ok || s.fails < FAILS_BEFORE_ALERT) return false;
  if (name === 'Email' && Date.now() - s.at > EMAIL_FAILURE_COUNTS_FOR_MS) return false;
  return true;
}

function probeIfDue(name) {
  const probe = probes.get(name);
  if (!probe || !probe.configured() || probing.has(name)) return;
  const s = state.get(name);
  // Only a fixable failure is re-checked early. Probing a service that is down
  // on its side every ten minutes would only spend its daily quota.
  const every = s && !s.ok && !s.theirs ? PROBE_FAILING_EVERY_MS : PROBE_EVERY_MS;
  const last = Math.max(s?.at || 0, lastProbeAt.get(name) || 0);
  if (Date.now() - last < every) return;

  probing.set(name, Date.now());
  lastProbeAt.set(name, Date.now());
  Promise.resolve()
    .then(() => probe.run())
    .then((r) => recordSource(name, r.ok, r.message))
    .catch((err) => recordSource(name, false, err?.message || String(err)))
    .finally(() => probing.delete(name));
}

/**
 * The public answer: ok or not, nothing else. Which integrations exist and
 * why one fails is for the owner (see sourceDetail), not for anyone probing.
 * Also starts any probe that is due, in the background — the answer never
 * waits on a third party, so the monitor's request stays fast.
 */
export function sourceHealth() {
  for (const name of probes.keys()) probeIfDue(name);
  const down = [...ALERTING].filter(failing);
  return { ok: down.length === 0, failing: down.length };
}

/** Everything recorded, with the error messages, for the owner. */
export function sourceDetail() {
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  return Object.fromEntries(
    [...state.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, s]) => [
        name,
        {
          status: failing(name)
            ? 'failing'
            : s.ok
              ? 'ok'
              : s.theirs
                ? 'down on their side (no alert)'
                : 'error (not yet alerting)',
          alerts: ALERTING.has(name),
          lastTried: iso(s.at),
          lastWorked: iso(s.lastOkAt),
          ...(s.ok ? {} : { error: s.message, failuresInARow: s.fails }),
        },
      ]),
  );
}
