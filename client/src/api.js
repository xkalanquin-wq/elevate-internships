// Every request gives up after a while rather than spinning forever. A search
// asks up to eight job sources, each allowed 30 seconds, so it gets longer.
const TIMEOUT_MS = 30_000;
const SEARCH_TIMEOUT_MS = 90_000;

async function call(path, options = {}) {
  const { timeout = TIMEOUT_MS, ...rest } = options;
  let res;
  try {
    res = await fetch(path, {
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      // Older browsers without AbortSignal.timeout simply wait.
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined,
      ...rest,
    });
  } catch (cause) {
    // No answer at all: offline, the server asleep or restarting, or too slow.
    const slow = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
    const err = new Error(
      slow
        ? 'The server took too long to answer. Please try again in a moment.'
        : 'Could not reach Elevate Internships. Check your connection and try again.',
    );
    err.status = 0;
    err.offline = !slow;
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Keep the status and body so callers can tell "locked" from "broken".
    const fallback =
      res.status === 429
        ? 'Too many requests at once. Wait a minute and try again.'
        : res.status >= 500
          ? 'Something went wrong on our side. Please try again.'
          : `Request failed (${res.status})`;
    const err = new Error(json.error || fallback);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

const post = (path, body) => call(path, { method: 'POST', body: JSON.stringify(body || {}) });

/**
 * Google's "preferred sources" link for this site. Readers who choose it see
 * more of the site in Google's Top Stories. The host comes from the canonical
 * link, which the build sets from SITE_URL.
 */
export function preferredSourceUrl() {
  let host = 'elevateinternships.com';
  try {
    const href = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (href) host = new URL(href, window.location.href).hostname || host;
  } catch {
    /* keep the default */
  }
  return `https://www.google.com/preferences/source?q=${encodeURIComponent(host)}`;
}

export const api = {
  ledger: () => call('/api/ledger'),
  groups: () => call('/api/groups'),
  tracks: () => call('/api/tracks'),
  trackItems: (field) => call(`/api/track-items/${encodeURIComponent(field)}`),
  toggle: (id, done) => post('/api/ledger/toggle', { id, done }),
  clear: () => post('/api/ledger/clear'),
  add: (cert) => post('/api/ledger/add', cert),
  addTrack: (field) => post('/api/ledger/add-track', { field }),
  removeTrack: (field) => post('/api/ledger/remove-track', { field }),
  remove: (id) => post('/api/ledger/remove', { id }),
  stats: () => call('/api/stats'),

  // The application tracker. Every call returns the whole list, so the UI
  // never has to reconcile a partial update.
  tracker: () => call('/api/tracker'),
  trackSave: (job, status) => post('/api/tracker/save', { job, status }),
  trackStatus: (jobKey, status) => post('/api/tracker/status', { jobKey, status }),
  trackNote: (jobKey, note) => post('/api/tracker/note', { jobKey, note }),
  trackRemove: (jobKey) => post('/api/tracker/remove', { jobKey }),
  trackDates: (jobKey, dates) => post('/api/tracker/dates', { jobKey, ...dates }),
  reminders: () => call('/api/reminders'),
  setReminders: (enabled) => post('/api/reminders', { enabled }),
  digest: () => call('/api/digest'),
  setDigest: (enabled) => post('/api/digest', { enabled }),

  // Premium, notifications and alerts.
  premium: () => call('/api/premium'),
  premiumCheckout: () => post('/api/premium/checkout'),
  premiumConfirm: (sessionId) => post('/api/premium/confirm', { sessionId }),
  push: (endpoint) => call(`/api/push${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ''}`),
  pushSubscribe: (subscription) => post('/api/push/subscribe', { subscription }),
  pushUnsubscribe: (endpoint) => post('/api/push/unsubscribe', { endpoint }),
  pushTest: () => post('/api/push/test'),
  setAlerts: (enabled) => post('/api/alerts', { enabled }),

  majors: () => call('/api/majors'),
  major: (id) => call(`/api/majors/${encodeURIComponent(id)}`),
  site: () => call('/api/site'),

  // Accounts. The session is an httpOnly cookie, so there is no token to hold
  // here — `credentials: same-origin` on every call is what carries it.
  me: () => call('/api/auth/me'),
  signup: (body) => post('/api/auth/signup', body),
  login: (body) => post('/api/auth/login', body),
  logout: () => post('/api/auth/logout'),
  changePassword: (body) => post('/api/auth/password', body),
  authConfig: () => call('/api/auth/config'),
  forgot: (email, website = '') => post('/api/auth/forgot', { email, website }),
  resetPassword: (body) => post('/api/auth/reset', body),
  sendVerification: () => post('/api/auth/send-verification'),
  verifyEmail: (token) => post('/api/auth/verify', { token }),
  importGuest: (body) => post('/api/auth/import', body),
  deleteAccount: (email) => post('/api/auth/delete', { email }),

  ownerStatus: () => call('/api/owner/status'),
  ownerLogin: (passcode) => post('/api/owner/login', { passcode }),
  ownerLogout: () => post('/api/owner/logout'),
  search: (query) => call('/api/search', { method: 'POST', body: JSON.stringify(query || {}), timeout: SEARCH_TIMEOUT_MS }),
  suggest: (query) => post('/api/suggest', query),
  checkUrl: (url) => post('/api/check-url', { url }),
};
