// Guest mode: a ledger that works before anyone signs up.
//
// Kept in localStorage with the same shape the server returns, so the Ledger
// and Stats components do not need to know which one they are reading. On
// sign-in the contents can be imported into the real account.
//
// Every access is wrapped: localStorage throws in private mode and in some
// embedded browsers, and losing a guest ledger should never break the page.

const KEY = 'cl-guest-ledger';

const EMPTY = { items: [], done: {}, tracks: [] };

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY };
  }
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable; the session still works in memory until reload */
  }
  return state;
}

export const hasGuestData = () => {
  const s = read();
  return s.items.length > 0 || Object.keys(s.done).length > 0 || readTracker().length > 0;
};

export const guestCount = () => read().items.length;

export function clearGuest() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(TRACKER_KEY);
  } catch {
    /* nothing to do */
  }
}

// ---- Guest application tracker ---------------------------------------------
// Same shape as /api/tracker returns, so the Tracker component cannot tell the
// two apart. Moved into the account on sign-in with everything else.

const TRACKER_KEY = 'cl-guest-tracker';

// Same rule as the server: the first time an internship reaches Applied or
// beyond, remember when, for the "applied this week" count.
const AFTER_APPLYING = ['applied', 'interviewing', 'offer'];
const stampApplied = (row, status) => {
  if (AFTER_APPLYING.includes(status) && !row.appliedAt) row.appliedAt = new Date().toISOString();
};

function readTracker() {
  try {
    const raw = localStorage.getItem(TRACKER_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeTracker(list) {
  try {
    localStorage.setItem(TRACKER_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  return guestTracker();
}

export const guestTracker = () => [...readTracker()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

export function guestTrackSave(job, status) {
  const list = readTracker();
  const now = new Date().toISOString();
  const key = job.url;
  const existing = list.find((j) => j.jobKey === key);
  if (existing) {
    if (status) {
      existing.status = status;
      stampApplied(existing, status);
    }
    existing.updatedAt = now;
    return writeTracker(list);
  }
  const row = {
    jobKey: key,
    url: job.url,
    title: job.title,
    company: job.company,
    location: job.location || '',
    source: job.source || '',
    remote: Boolean(job.remote),
    postedAt: job.postedAt || null,
    note: '',
    deadline: job.deadline || '',
    status: status || 'saved',
    createdAt: now,
    updatedAt: now,
  };
  stampApplied(row, row.status);
  list.push(row);
  return writeTracker(list);
}

export function guestTrackUpdate(jobKey, changes) {
  const list = readTracker();
  const row = list.find((j) => j.jobKey === jobKey);
  if (row) {
    Object.assign(row, changes, { updatedAt: new Date().toISOString() });
    if (changes.status) stampApplied(row, changes.status);
  }
  return writeTracker(list);
}

export const guestTrackRemove = (jobKey) => writeTracker(readTracker().filter((j) => j.jobKey !== jobKey));

/** Mirrors the /api/ledger response so components can share one shape. */
export function guestLedger(groups) {
  const s = read();
  return { groups, items: s.items, done: s.done, tracks: s.tracks, backend: 'guest', guest: true };
}

export function guestAdd(item) {
  const s = read();
  if (!s.items.some((i) => i.id === item.id)) s.items.push({ ...item, addedAt: new Date().toISOString() });
  return write(s);
}

export function guestAddTrack(field, items) {
  const s = read();
  for (const item of items) {
    if (!s.items.some((i) => i.id === item.id)) s.items.push({ ...item, addedAt: new Date().toISOString() });
  }
  if (!s.tracks.includes(field)) s.tracks.push(field);
  return write(s);
}

export function guestRemove(id) {
  const s = read();
  s.items = s.items.filter((i) => i.id !== id);
  delete s.done[id];
  return write(s);
}

export function guestToggle(id, done) {
  const s = read();
  if (done) s.done[id] = new Date().toISOString();
  else delete s.done[id];
  return write(s);
}

export function guestClearDone() {
  const s = read();
  s.done = {};
  return write(s);
}

/** Payload for /api/auth/import when a guest signs up. */
export const guestPayload = () => ({ ...read(), tracked: readTracker() });

/** Stats computed locally, matching the server's /api/stats shape. */
export function guestStats(groups) {
  const { items, done, tracks } = read();
  const completed = items.filter((i) => done[i.id]);
  const hoursDone = completed.reduce((n, i) => n + (i.hours || 0), 0);
  const hoursLeft = items.filter((i) => !done[i.id]).reduce((n, i) => n + (i.hours || 0), 0);

  const byGroup = {};
  for (const item of items) {
    const name = groups.find((g) => g.id === item.group)?.name || item.group;
    byGroup[name] = byGroup[name] || { total: 0, done: 0, hours: 0 };
    byGroup[name].total += 1;
    byGroup[name].hours += item.hours || 0;
    if (done[item.id]) byGroup[name].done += 1;
  }

  const byProvider = {};
  for (const i of items) byProvider[i.provider] = (byProvider[i.provider] || 0) + 1;

  const byDay = {};
  for (const iso of Object.values(done)) {
    const d = String(iso).slice(0, 10);
    if (d) byDay[d] = (byDay[d] || 0) + 1;
  }

  return {
    guest: true,
    totals: {
      items: items.length,
      completed: completed.length,
      percent: items.length ? Math.round((completed.length / items.length) * 100) : 0,
      hoursDone,
      hoursLeft,
      tracks: tracks.length,
      searches: 0, // search history is only kept for an account
    },
    byGroup,
    byProvider: Object.entries(byProvider).sort((a, b) => b[1] - a[1]).slice(0, 8),
    byDay,
    topTerms: [],
    recentSearches: [],
    recentlyCompleted: completed
      .map((i) => ({ title: i.title, provider: i.provider, at: done[i.id], hours: i.hours }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 6),
  };
}
