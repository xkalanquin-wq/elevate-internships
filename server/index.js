import 'dotenv/config';
import express from 'express';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fetchAdzuna,
  fetchEmployerBoards,
  fetchHimalayas,
  fetchJobicy,
  fetchMuse,
  fetchRemotive,
  fetchSimplify,
  fetchUsaJobs,
  cachedListings,
  warmCaches,
} from './sources.js';
import { rankCertifications, rankJobs } from './rank.js';
import { deepLinks } from './deeplinks.js';
import { checkUrl, suggestCertifications, suggestEnabled } from './suggest.js';
import { geocodeZip } from './geo.js';
import { PREMIUM_ENABLED } from './features.js';
import { buildTrackItems, detectField } from './fields.js';
import { checkLimiter, clean, clientErrorLimiter, isSafePublicUrl, loginLimiter, payLimiter, searchLimiter, siteLimiter, suggestLimiter, writeLimiter } from './guard.js';
import {
  clearOwnerCookie,
  isOwner,
  login as ownerLogin,
  logout as ownerLogout,
  ownerConfigured,
  ownerStatus,
  passcodeMatches,
  requireOwner,
  setOwnerCookie,
} from './owner.js';
import {
  changePassword,
  currentUser,
  deleteAccount,
  exportCsv,
  exportData,
  initAuth,
  login,
  logout,
  me,
  performReset,
  requestReset,
  requireUser,
  sendVerification,
  signup,
  startSession,
  verifyEmail,
} from './auth.js';
import { googleCallback, googleEnabled, googleStart } from './google.js';
import { emailConfigured, emailProvider, sendMail } from './email.js';
import { adsCsp, configureProxyTrust, forceHttps, securityHeaders } from './security.js';
import { cloudSaveEnabled, startSaving } from './cloudsave.js';
import * as store from './store.js';
import { MAJOR_PATH, createMajors } from './majors.js';
import { isValidTimeZone, startReminders } from './reminders.js';
import { CONTENT_PATH, createContent } from './content.js';
import { catchAsyncErrors } from './asyncerrors.js';
import { applyAffiliates } from './affiliates.js';
import { createImages, llmsTxt } from './seo.js';
import { recordSearch, registerProbe, sourceDetail, sourceHealth } from './sourcehealth.js';
import { createIndexNow } from './indexnow.js';
import { createVisits } from './visits.js';
import { page as plainPage, renderLogin, renderOwner } from './ownerpage.js';
import { newUnsubToken, startDigest } from './digest.js';
import { createCommerce } from './commerce.js';
import { createPush, startAlerts } from './push.js';
import { stripeEnabled } from './stripe.js';
import { configureLimits, take, usage as limitUsage } from './limits.js';
import { logError, recentErrors, startErrorLog } from './errorlog.js';

// Recent errors for /owner, and today's use of the capped outside services.
startErrorLog({ getMeta: store.getMeta, setMeta: store.setMeta });
configureLimits({ getMeta: store.getMeta, setMeta: store.setMeta });

// Which build is live, for /api/health and /owner. Render sets RENDER_GIT_COMMIT.
const VERSION = String(process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || 'local';
const STARTED_AT = new Date().toISOString();

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(here, 'data', f), 'utf8'));

const LEDGER_ITEMS = readJson('ledger-items.json');
// Affiliate links, if any programs are configured, are swapped in here once,
// so every page and API that links to a certification uses the same link.
const CATALOG = applyAffiliates(readJson('certifications.json'), readJson('affiliates.json'));
const TRACKS = readJson('tracks.json');
const MAJORS_CONTENT = readJson('majors-content.json');

/**
 * A search with the job-title words of the major it belongs to, so the
 * ranking can favour listings that are clearly in that field (rank.js).
 * Engineering roles rank lower unless the major is a technical one or the
 * search mentions technical work. Used for live searches and for the weekly
 * email and daily alerts.
 */
const TECHNICAL_MAJORS = new Set(['mis', 'business-analytics']);
const TECHNICAL_ASK = /\b(software|engineer\w*|developer|coding|programming|computer|data science|machine learning|cyber\w*|technical|technology|it)\b/i;
const withFieldTerms = (query) => {
  const id = detectField(query, TRACKS)?.id;
  const asked = [query.major, ...(query.interests || [])].some((s) => TECHNICAL_ASK.test(String(s || '')));
  return { ...query, fieldTerms: MAJORS_CONTENT[id]?.keywords || [], demoteTechnical: !TECHNICAL_MAJORS.has(id) && !asked };
};
const rankForMajor = (jobs, query) => rankJobs(jobs, withFieldTerms(query));

// Copy shared by the server-rendered HTML and the app, and the illustration
// registry the pages add their images to (served at /images/<name>.svg).
const HUB = readJson('hub-content.json');
const images = createImages();
const majors = createMajors({ tracks: TRACKS, catalog: CATALOG, certGuides: readJson('cert-guides.json'), hub: HUB, images });
const MAJOR_IDS = majors.ids;
const majorCertifications = majors.certifications;
const majorPayload = majors.payload;
const renderMajorHtml = majors.render;

// The search pages: /internships, /career-guides and /how-it-works.
const contactEmail = () => {
  const c = String(process.env.CONTACT_EMAIL || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) ? c : null;
};
// Google AdSense. Stage one (ADSENSE_CLIENT alone) only proves the site is
// ours. Stage two, ADSENSE_ADS=on, loads Google's ad script on the no-JS
// content pages for visitors without Premium. The app itself never shows ads.
const adsenseClient = () => {
  const c = String(process.env.ADSENSE_CLIENT || '').trim();
  return /^ca-pub-\d{10,20}$/.test(c) ? c : null;
};
const adsOn = () => Boolean(adsenseClient()) && String(process.env.ADSENSE_ADS || '').trim().toLowerCase() === 'on';

const commerce = createCommerce({
  store,
  sendMail,
  contactEmail,
  siteUrl: () => process.env.SITE_URL,
  tracks: TRACKS,
  plainPage: (title, body) => plainPage(path.join(here, '..', 'dist'), title, body),
  // `visits` is created further down; this only runs once requests arrive.
  countStep: (name) => visits.count(name),
});
const push = createPush({ store, contactEmail, siteUrl: process.env.SITE_URL });

const contentPages = createContent({
  tracks: TRACKS,
  catalog: CATALOG,
  majorsContent: MAJORS_CONTENT,
  guides: readJson('guides.json'),
  interviews: readJson('interview-questions.json'),
  // A major's internship page is not tied to a place, so it lists that
  // major's live sponsored listings wherever they are.
  sponsoredForMajor: (id) =>
    store
      .liveSponsored()
      .filter((s) => s.majors.includes(id))
      .slice(0, 2)
      .map((s) => ({ title: s.title, company: s.company, location: s.location, applyUrl: `/go/s/${s.id}` })),
  adsOn,
  stripeOn: stripeEnabled,
  hub: HUB,
  images,
  cachedListings,
  rankJobs,
  contactEmail,
});

const FINDER_GROUP = { id: 'finder', name: 'Added from Finder', note: 'Certifications you picked up from a search' };

/**
 * Every group across every track, deduped by id.
 *
 * The business tracks deliberately share group ids — "Foundations" and
 * "Tooling" mean the same thing in accounting as in finance — so a plain
 * concatenation yielded eleven copies of the same group. The ledger renders a
 * section per entry, so nine items were drawn as eighty-three rows.
 */
const ALL_GROUPS = (() => {
  const byId = new Map();
  for (const track of Object.values(TRACKS)) {
    for (const group of track.groups) {
      if (!byId.has(group.id)) byId.set(group.id, group);
    }
  }
  byId.set(FINDER_GROUP.id, FINDER_GROUP);
  return [...byId.values()];
})();

// A track that names a catalog id which does not exist would silently come out
// short, so fail loudly at boot instead.
{
  const catalogIds = new Set(CATALOG.map((c) => c.id));
  const problems = [];
  for (const [field, track] of Object.entries(TRACKS)) {
    if (track.source === 'ledger-items') continue;
    for (const id of track.source) {
      if (!catalogIds.has(id)) problems.push(`${field} -> unknown catalog id "${id}"`);
    }
  }
  if (problems.length) {
    console.error('[config] track definitions are broken:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
}

const app = express();

// Transport security first, so a redirect happens before any work is done.
configureProxyTrust(app);
app.disable('x-powered-by');
app.use(forceHttps);
app.use(securityHeaders);
// gzip/brotli for pages, API answers and built files that are not already compressed.
app.use(compression());
// A ceiling per visitor across the whole site; the stricter limits on search,
// sign-in, writes and payments sit on top. Stripe's webhook is exempt.
app.use((req, res, next) => (req.path === '/api/stripe/webhook' || req.path.startsWith('/assets/') ? next() : siteLimiter(req, res, next)));

// Express 4 does not pass a rejected promise from an async route to the error
// handler; the request would hang. Every route registered below forwards it.
catchAsyncErrors(app);

// Stripe's webhook must see the raw body to check its signature, so it is
// mounted before the JSON parser.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), commerce.webhook);

app.use(express.json({ limit: '256kb' }));

// ---- Accounts --------------------------------------------------------------

app.post('/api/auth/signup', loginLimiter, signup);
app.post('/api/auth/login', loginLimiter, login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/me', me);
app.post('/api/auth/password', requireUser, loginLimiter, changePassword);

// Password reset. Both steps are rate limited, and the request step always
// answers the same way so it cannot reveal which emails have accounts.
app.post('/api/auth/forgot', loginLimiter, requestReset);
app.post('/api/auth/reset', loginLimiter, performReset);

// Email confirmation, which is also what marks an account as academic.
app.post('/api/auth/send-verification', requireUser, loginLimiter, sendVerification);
app.post('/api/auth/verify', verifyEmail);
app.get('/api/auth/verify', verifyEmail);

// Sign in with Google. Returns 400 until credentials are configured.
app.get('/api/auth/google', loginLimiter, googleStart);
app.get('/api/auth/google/callback', (req, res) => googleCallback(req, res, startSession));

// Your data, on the way out.
app.get('/api/auth/export.json', requireUser, exportData);
app.get('/api/auth/export.csv', requireUser, exportCsv);
app.post('/api/auth/delete', requireUser, loginLimiter, deleteAccount);

/** Moves a guest ledger held in the browser into the signed-in account. */
app.post('/api/auth/import', requireUser, writeLimiter, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
  const done = req.body?.done && typeof req.body.done === 'object' ? req.body.done : {};
  const tracks = Array.isArray(req.body?.tracks) ? req.body.tracks.slice(0, 20) : [];

  let imported = 0;
  for (const raw of items) {
    if (!raw?.id || !raw?.title) continue;
    store.addItem(req.user.id, {
      id: String(raw.id).slice(0, 120),
      group: ALL_GROUPS.some((g) => g.id === raw.group) ? raw.group : 'finder',
      title: clean(raw.title, 200),
      provider: clean(raw.provider, 120) || 'Unknown',
      desc: clean(raw.desc, 500),
      hours: Number(raw.hours) || 0,
      cost: ['free', 'audit', 'check', 'ref', 'paid'].includes(raw.cost) ? raw.cost : 'check',
      price: clean(raw.price, 200),
      links: Array.isArray(raw.links) ? raw.links.slice(0, 4) : [],
      field: TRACKS[raw.field] ? raw.field : undefined,
    });
    imported += 1;
  }

  // Same rule as /api/ledger/toggle: a completion only means something if the
  // item is actually on the ledger. A guest payload normally satisfies this,
  // since the browser stores items and completions together — but the payload
  // arrives from the client, so it is checked rather than trusted.
  const onLedger = new Set(store.getAdded(req.user.id).map((item) => item.id));
  for (const [id, at] of Object.entries(done)) {
    const key = String(id).slice(0, 120);
    if (typeof at === 'string' && onLedger.has(key)) store.setDone(req.user.id, key, at);
  }
  for (const field of tracks) {
    if (TRACKS[field]) store.addTrack(req.user.id, field);
  }

  // Internships tracked as a guest come across with their stage and note.
  const tracked = Array.isArray(req.body?.tracked) ? req.body.tracked.slice(0, MAX_TRACKED) : [];
  let importedJobs = 0;
  for (const raw of tracked) {
    const job = cleanTrackedJob(raw);
    if (!job || store.countTracked(req.user.id) >= MAX_TRACKED) continue;
    const status = store.TRACK_STATUSES.includes(raw.status) ? raw.status : 'saved';
    store.upsertTracked(req.user.id, job.jobKey, { payload: job.payload, status });
    importedJobs += 1;
  }

  res.json({ ...ledgerState(req.user.id), imported, importedJobs });
});

/** What sign-in options this server actually supports. */
app.get('/api/auth/config', (_req, res) => {
  res.json({ google: googleEnabled(), email: emailConfigured(), emailProvider: emailProvider() });
});

/**
 * Public, operator-supplied site details. Read at request time rather than
 * baked into the build, so changing CONTACT_EMAIL on the host takes effect on
 * the next page load without a rebuild. Only the address is exposed, and only
 * because the privacy policy has to be able to print it.
 */
app.get('/api/site', (_req, res) => {
  const contact = String(process.env.CONTACT_EMAIL || '').trim();
  res.json({ contactEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : null, ads: adsOn(), payments: stripeEnabled() });
});

// ---- Premium, payments and sponsored listings (server/commerce.js) ----------

commerce.routes(app, {
  requireUser,
  currentUser,
  payLimiter,
  writeLimiter,
  formBody: express.urlencoded({ extended: false, limit: '8kb' }),
});

// ---- Notifications (server/push.js) -----------------------------------------

const pushState = (userId, endpoint = null) => {
  const u = store.getUserById(userId);
  const state = store.getAlertState(userId);
  const premium = store.isPremium(u);
  return {
    publicKey: push.publicKey(),
    devices: store.countPushSubs(userId),
    thisDevice: endpoint ? store.hasPushSub(userId, endpoint) : null,
    premium,
    alerts: Boolean(u?.push_alerts),
    lastAlertAt: state.lastSentAt || null,
    lastJobs: premium ? state.lastJobs || [] : [],
  };
};

const cleanSubscription = (raw) => {
  const endpoint = String(raw?.endpoint || '');
  const p256dh = String(raw?.keys?.p256dh || '');
  const auth = String(raw?.keys?.auth || '');
  if (!/^https:\/\/\S{10,}$/.test(endpoint) || endpoint.length > 1000) return null;
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return null;
  // Only public push services, never an address on this server's network.
  if (!isSafePublicUrl(endpoint).ok) return null;
  return { endpoint, keys: { p256dh, auth } };
};

app.get('/api/push', requireUser, (req, res) => res.json(pushState(req.user.id, String(req.query.endpoint || '').slice(0, 1000) || null)));

app.post('/api/push/subscribe', requireUser, writeLimiter, (req, res) => {
  const sub = cleanSubscription(req.body?.subscription);
  if (!sub) return res.status(400).json({ error: 'That notification setup could not be read. Try again.' });
  if (store.countPushSubs(req.user.id) >= 10 && !store.hasPushSub(req.user.id, sub.endpoint)) {
    return res.status(400).json({ error: 'Notifications are on for 10 browsers already. Turn them off on one first.' });
  }
  store.addPushSub(req.user.id, sub.endpoint, sub.keys);
  res.json(pushState(req.user.id, sub.endpoint));
});

app.post('/api/push/unsubscribe', requireUser, writeLimiter, (req, res) => {
  const endpoint = String(req.body?.endpoint || '').slice(0, 1000);
  if (endpoint) store.removePushSub(endpoint, req.user.id);
  res.json(pushState(req.user.id));
});

app.post('/api/push/test', requireUser, payLimiter, async (req, res) => {
  const delivered = await push.sendToUser(req.user.id, {
    title: 'Notifications are on',
    body: 'You will get a reminder the day before a deadline or interview in your tracker.',
    url: '/?tab=tracker',
    tag: 'test',
  });
  res.json({ delivered });
});

/** Premium's daily new-internship alert: on or off. */
app.post('/api/alerts', requireUser, writeLimiter, (req, res) => {
  const on = Boolean(req.body?.enabled);
  if (on && !store.isPremium(store.getUserById(req.user.id))) {
    return res.status(403).json({ error: PREMIUM_ENABLED ? 'Daily alerts come with Premium.' : 'Daily alerts are not available.' });
  }
  store.setUserFields(req.user.id, { push_alerts: on ? 1 : 0 });
  res.json(pushState(req.user.id));
});

// ---- Ledger ----------------------------------------------------------------

function ledgerState(userId) {
  const added = store.getAdded(userId);
  return {
    groups: ALL_GROUPS,
    items: added,
    done: store.getDone(userId),
    tracks: store.getTracks(userId),
    backend: store.storeBackend(),
  };
}

/** Group metadata describes the catalog, not a person, so it needs no session. */
app.get('/api/groups', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ groups: ALL_GROUPS });
});

/** What a starter track contains, so guest mode can store it locally. */
app.get('/api/track-items/:field', (req, res) => {
  const track = TRACKS[req.params.field];
  if (!track) return res.status(404).json({ error: 'Unknown track.' });
  res.json({ items: buildTrackItems(track, { ledgerItems: LEDGER_ITEMS, catalog: CATALOG }) });
});

app.get('/api/ledger', requireUser, (req, res) => res.json(ledgerState(req.user.id)));

app.post('/api/ledger/toggle', requireUser, writeLimiter, (req, res) => {
  const { id, done } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });

  // Only something on your ledger can be ticked off it. Without this, any id
  // at all could be marked done: the UI never showed those rows (both the tab
  // badge and /api/stats count only real items), but they accumulated as dead
  // storage, and an authenticated caller could add them without limit.
  //
  // Un-ticking is always allowed, so a row orphaned by an earlier version can
  // still be cleared rather than being stuck forever.
  if (done) {
    const owned = store.getAdded(req.user.id).some((item) => item.id === id);
    if (!owned) return res.status(404).json({ error: 'That item is not on your ledger.' });
  }

  res.json({ done: store.setDone(req.user.id, id, done ? new Date().toISOString() : null) });
});

/**
 * Records that someone opened an apply link.
 *
 * Deliberately narrow about what it claims: the app hands you off to an
 * employer's own site and never sees what happens there, so this counts
 * applications *started*, not applications received. The reporting says the
 * same thing rather than quietly inflating the number.
 *
 * Signed out, there is nobody to attribute it to, so it is a no-op rather than
 * an error — the apply link still opens either way.
 */
app.post('/api/applications', writeLimiter, (req, res) => {
  const user = currentUser(req);
  if (!user) return res.json({ recorded: false, reason: 'signed-out' });

  const jobKey = clean(req.body?.jobKey || req.body?.url, 300);
  if (!jobKey) return res.status(400).json({ error: 'jobKey is required' });

  const recorded = store.recordApplication(user.id, {
    jobKey,
    title: clean(req.body?.title, 200),
    company: clean(req.body?.company, 160),
    source: clean(req.body?.source, 60),
  });

  res.json({ recorded, total: store.getApplications(user.id).length });
});

/** Paginated: ?limit= (1-200, default 100) and ?offset=. */
app.get('/api/applications', requireUser, (req, res) => {
  const all = store.getApplications(req.user.id);
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  res.json({ applications: all.slice(offset, offset + limit), total: all.length, limit, offset });
});

// ---- Application tracker ---------------------------------------------------
//
// What the person says happened to an internship: saved, applied,
// interviewing, offer, or closed. Keyed by the posting's URL, the same key the
// apply-click record uses, so the two line up.

const MAX_TRACKED = 500;

/** Bounds every field of a tracked internship, whatever the client sent. */
function cleanTrackedJob(raw) {
  const url = String(raw?.url || raw?.jobKey || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const title = clean(raw?.title, 200);
  if (!title) return null;
  const postedAt = raw?.postedAt && !Number.isNaN(Date.parse(raw.postedAt)) ? new Date(raw.postedAt).toISOString() : null;
  const dates = cleanDates(raw);
  return {
    jobKey: url.slice(0, 500),
    payload: {
      title,
      company: clean(raw?.company, 160) || 'Unknown',
      location: clean(raw?.location, 200),
      url: url.slice(0, 500),
      source: clean(raw?.source, 60),
      remote: Boolean(raw?.remote),
      postedAt,
      note: clean(raw?.note, 500),
      ...(dates || {}),
      appliedAt: raw?.appliedAt && !Number.isNaN(Date.parse(raw.appliedAt)) ? new Date(raw.appliedAt).toISOString() : undefined,
    },
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * An application deadline (a calendar date) and an interview (a local date
 * and time), plus the person's time zone so reminders go out on the right
 * day for them. Empty strings clear a date. Returns null if anything is
 * malformed.
 */
function cleanDates(raw) {
  const out = {};
  for (const [key, re] of [
    ['deadline', DATE_RE],
    ['interviewAt', DATETIME_RE],
  ]) {
    if (raw?.[key] === undefined) continue;
    const v = String(raw[key] || '').trim();
    if (v && !re.test(v)) return null;
    if (v && Number.isNaN(Date.parse(v))) return null;
    out[key] = v;
  }
  if (raw?.tz !== undefined) {
    const tz = String(raw.tz || '').slice(0, 64);
    if (tz && isValidTimeZone(tz)) out.tz = tz;
  }
  return out;
}

/** The first time an internship reaches Applied or beyond, remember when. */
const STAGES_AFTER_APPLYING = new Set(['applied', 'interviewing', 'offer']);
const appliedStamp = (existing, status) =>
  STAGES_AFTER_APPLYING.has(status) && !existing?.appliedAt ? { appliedAt: new Date().toISOString() } : {};

const trackerState = (userId) => ({ jobs: store.getTracked(userId), statuses: store.TRACK_STATUSES });

app.get('/api/tracker', requireUser, (req, res) => res.json(trackerState(req.user.id)));

/** Save an internship, optionally at a given stage. Saving again never resets its stage. */
app.post('/api/tracker/save', requireUser, writeLimiter, (req, res) => {
  const job = cleanTrackedJob(req.body?.job);
  if (!job) return res.status(400).json({ error: 'A job needs a title and an http(s) link.' });
  const status = req.body?.status;
  if (status !== undefined && !store.TRACK_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Unknown stage.' });
  }
  const known = store.getTracked(req.user.id).some((j) => j.jobKey === job.jobKey);
  if (!known && store.countTracked(req.user.id) >= MAX_TRACKED) {
    return res.status(400).json({ error: `You can track up to ${MAX_TRACKED} internships. Remove a few closed ones first.` });
  }
  // Re-saving a tracked internship never touches its note or dates — those
  // change through their own routes. A new one may arrive with them (the
  // "Add an internship" form sends a deadline). When it was applied to is
  // always the server's own clock, never the client's say-so.
  const { note, deadline, interviewAt, tz, appliedAt, ...payload } = job.payload;
  const existing = store.getTracked(req.user.id).find((j) => j.jobKey === job.jobKey);
  const firstSave = { ...payload, note, deadline, interviewAt, tz };
  store.upsertTracked(req.user.id, job.jobKey, {
    payload: { ...(known ? payload : firstSave), ...appliedStamp(existing, status) },
    status,
  });
  if (status === 'applied') {
    store.recordApplication(req.user.id, { jobKey: job.jobKey, title: payload.title, company: payload.company, source: payload.source });
  }
  res.json(trackerState(req.user.id));
});

app.post('/api/tracker/status', requireUser, writeLimiter, (req, res) => {
  const jobKey = String(req.body?.jobKey || '').slice(0, 500);
  const status = req.body?.status;
  if (!store.TRACK_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown stage.' });
  const job = store.getTracked(req.user.id).find((j) => j.jobKey === jobKey);
  if (!job) return res.status(404).json({ error: 'That internship is not in your tracker.' });
  store.upsertTracked(req.user.id, jobKey, { status, payload: appliedStamp(job, status) });
  // Saying you applied counts for the activity report, the same as an apply click.
  if (status === 'applied') {
    store.recordApplication(req.user.id, { jobKey, title: job.title, company: job.company, source: job.source });
  }
  res.json(trackerState(req.user.id));
});

app.post('/api/tracker/note', requireUser, writeLimiter, (req, res) => {
  const jobKey = String(req.body?.jobKey || '').slice(0, 500);
  if (!store.getTracked(req.user.id).some((j) => j.jobKey === jobKey)) {
    return res.status(404).json({ error: 'That internship is not in your tracker.' });
  }
  store.upsertTracked(req.user.id, jobKey, { payload: { note: clean(req.body?.note, 500) } });
  res.json(trackerState(req.user.id));
});

app.post('/api/tracker/dates', requireUser, writeLimiter, (req, res) => {
  const jobKey = String(req.body?.jobKey || '').slice(0, 500);
  if (!store.getTracked(req.user.id).some((j) => j.jobKey === jobKey)) {
    return res.status(404).json({ error: 'That internship is not in your tracker.' });
  }
  const dates = cleanDates(req.body);
  if (!dates) return res.status(400).json({ error: 'Those dates could not be read.' });
  store.upsertTracked(req.user.id, jobKey, { payload: dates });
  res.json(trackerState(req.user.id));
});

/**
 * Reminder emails are opt-in, per account. `available` says whether this
 * server can send email at all, so the page can be honest when it cannot.
 */
app.get('/api/reminders', requireUser, (req, res) => {
  res.json({ enabled: Boolean(store.getUserById(req.user.id)?.remind_email), available: emailConfigured() });
});

app.post('/api/reminders', requireUser, writeLimiter, (req, res) => {
  store.setRemindEmail(req.user.id, Boolean(req.body?.enabled));
  res.json({ enabled: Boolean(req.body?.enabled), available: emailConfigured() });
});

/**
 * The weekly new-internships email (server/digest.js). Confirmed addresses
 * only: otherwise anyone could sign a stranger up for weekly mail.
 */
const digestState = (userId) => {
  const u = store.getUserById(userId);
  return { enabled: Boolean(u?.digest_email), verified: Boolean(u?.email_verified_at), available: emailConfigured() };
};
app.get('/api/digest', requireUser, (req, res) => res.json(digestState(req.user.id)));
app.post('/api/digest', requireUser, writeLimiter, (req, res) => {
  const on = Boolean(req.body?.enabled);
  if (on && !store.getUserById(req.user.id)?.email_verified_at) {
    return res.status(400).json({ error: 'Confirm your email address first — then you can turn this on.' });
  }
  if (on) {
    const state = store.getDigestState(req.user.id);
    if (!state.unsub) store.setDigestState(req.user.id, { ...state, unsub: newUnsubToken() });
  }
  store.setDigestEmail(req.user.id, on);
  res.json(digestState(req.user.id));
});

app.post('/api/tracker/remove', requireUser, writeLimiter, (req, res) => {
  store.removeTracked(req.user.id, String(req.body?.jobKey || '').slice(0, 500));
  res.json(trackerState(req.user.id));
});

app.post('/api/ledger/clear', requireUser, writeLimiter, (req, res) =>
  res.json({ done: store.clearDone(req.user.id) }),
);

app.post('/api/ledger/add', requireUser, writeLimiter, (req, res) => {
  const cert = req.body || {};
  if (!cert.id || !cert.title) return res.status(400).json({ error: 'id and title are required' });

  // Bound every field, with the same limits /api/auth/import uses. This path
  // used to pass id, title, provider, desc and url through untouched, so a
  // 5000-character title was stored verbatim and rendered in full — the two
  // write paths must agree on what a ledger row may contain.
  const url = String(cert.url || '').trim();
  const safeUrl = /^https?:\/\//i.test(url) ? url.slice(0, 500) : null;

  const item = {
    id: String(cert.id).slice(0, 120),
    group: 'finder',
    title: clean(cert.title, 200),
    provider: clean(cert.provider, 120) || 'Unknown',
    desc: clean(cert.desc, 500),
    hours: Math.max(0, Math.min(10_000, Number(cert.hours) || 0)),
    cost: ['free', 'audit', 'check', 'ref', 'paid'].includes(cert.cost) ? cert.cost : 'check',
    price: clean(cert.price, 200),
    links: safeUrl ? [{ label: 'Open', url: safeUrl }] : [],
    field: TRACKS[cert.field] ? cert.field : undefined,
  };
  store.addItem(req.user.id, item);
  res.json(ledgerState(req.user.id));
});

/** Add a whole starter track — this is how the finance ledger gets created. */
app.post('/api/ledger/add-track', requireUser, writeLimiter, (req, res) => {
  const { field } = req.body || {};
  const track = TRACKS[field];
  if (!track) return res.status(400).json({ error: 'Unknown track.' });

  for (const item of buildTrackItems(track, { ledgerItems: LEDGER_ITEMS, catalog: CATALOG })) {
    store.addItem(req.user.id, item);
  }
  store.addTrack(req.user.id, field);
  res.json(ledgerState(req.user.id));
});

app.post('/api/ledger/remove-track', requireUser, writeLimiter, (req, res) => {
  const { field } = req.body || {};
  const track = TRACKS[field];
  if (!track) return res.status(400).json({ error: 'Unknown track.' });

  for (const item of buildTrackItems(track, { ledgerItems: LEDGER_ITEMS, catalog: CATALOG })) {
    store.removeItem(req.user.id, item.id);
  }
  store.removeTrack(req.user.id, field);
  res.json(ledgerState(req.user.id));
});

app.post('/api/ledger/remove', requireUser, writeLimiter, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  store.removeItem(req.user.id, id);
  res.json(ledgerState(req.user.id));
});

// ---- Finder ----------------------------------------------------------------

// The longest any one job source may hold up a search.
const SOURCE_DEADLINE_MS = 30_000;
// Listings returned by one search, and how many of them may be remote.
const MAX_RESULTS = 200;
const REMOTE_SLOTS = 60;
// The names each source reports its notes under, for /api/health/sources.
const SEARCH_SOURCES = ['Adzuna', 'USAJOBS', 'The Muse', 'Remotive', 'Jobicy', 'Employer boards', 'Simplify', 'Himalayas'];

// When nobody has searched for a while, the keyed sources are checked with one
// small fixed query (one Adzuna page) so a revoked key is still noticed.
const PROBE_QUERY = { zip: '10001', place: { city: 'New York', state: 'NY' }, radiusMiles: 25, major: '', interests: [], maxPages: 1 };
const probeWith = (name, fetcher) => async () => {
  const notes = [];
  await fetcher({ ...PROBE_QUERY }, notes);
  const err = notes.find((n) => n.source === name && n.level === 'error');
  return { ok: !err, message: err?.message };
};
registerProbe('Adzuna', {
  configured: () => Boolean(process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim()),
  run: probeWith('Adzuna', fetchAdzuna),
});
registerProbe('USAJOBS', {
  configured: () => Boolean(process.env.USAJOBS_API_KEY?.trim() && process.env.USAJOBS_EMAIL?.trim()),
  run: probeWith('USAJOBS', fetchUsaJobs),
});

function normalizeQuery(body = {}) {
  return {
    zip: clean(body.zip ?? body.location, 10).replace(/[^0-9]/g, '').slice(0, 5),
    // 150 and 200 are for college towns, where the nearest city is a drive away.
    radiusMiles: [10, 25, 50, 100, 150, 200].includes(Number(body.radiusMiles)) ? Number(body.radiusMiles) : 50,
    major: clean(body.major, 80),
    interests: (Array.isArray(body.interests) ? body.interests : [])
      .slice(0, 12)
      .map((s) => clean(s, 40))
      .filter(Boolean),
    classYear: clean(body.classYear, 20),
    term: clean(body.term, 12) || 'any',
  };
}

const SEARCH_CACHE_MS = 5 * 60_000;
const SEARCH_CACHE_MAX = 300;
const searchCache = new Map();
function cachedSearch(key, run) {
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.promise;
  const promise = run();
  searchCache.set(key, { at: Date.now(), promise });
  promise.catch(() => searchCache.delete(key));
  if (searchCache.size > SEARCH_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of searchCache) if (now - v.at >= SEARCH_CACHE_MS) searchCache.delete(k);
    while (searchCache.size > SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
  }
  return promise;
}

app.post('/api/search', searchLimiter, async (req, res) => {
  const query = normalizeQuery(req.body);

  // The client validates too, but that is a courtesy to the person typing;
  // this is the check that actually counts. Note these test the RAW body —
  // normalizeQuery truncates, so checking the cleaned value would silently
  // pass anything oversized.
  const rawMajor = String(req.body?.major ?? '');
  const rawInterests = Array.isArray(req.body?.interests) ? req.body.interests : [];

  // The ZIP has to be judged on the RAW value for the same reason as the
  // fields below. normalizeQuery strips non-digits and truncates to five, so
  // "123456" arrived here as the perfectly valid "12345" and quietly returned
  // results for Schenectady, NY. A typo must be an error, not a different town.
  //
  // ZIP+4 stays acceptable in both the forms people actually type; only the
  // leading five are used, which is all the geocoder wants anyway.
  const rawZip = String(req.body?.zip ?? req.body?.location ?? '').trim();
  const zipShape = /^(\d{5})(?:[-\s]?\d{4})?$/.exec(rawZip);

  const invalid = {};
  if (!zipShape) invalid.zip = 'Enter a 5-digit US ZIP code.';
  else if (zipShape[1] === '00000') invalid.zip = 'That is not a real ZIP code.';
  else query.zip = zipShape[1];
  if (rawMajor.length > 80) invalid.major = 'Keep the major under 80 characters.';
  else if (query.major && !/[a-z]/i.test(query.major)) invalid.major = 'That does not look like a major.';
  if (rawInterests.length > 12) invalid.interests = 'Too many interests — the maximum is 12.';

  if (Object.keys(invalid).length) {
    return res.status(400).json({ error: Object.values(invalid)[0], fields: invalid });
  }

  // Honeypot, mirrored from the form. Answer 200 with nothing rather than
  // telling a bot which check caught it.
  if (req.body?.company_website) {
    return res.json({ query, place: null, jobs: [], certifications: [], notes: [], deepLinks: [], field: null, track: null });
  }

  // Everything downstream keys off real coordinates, so resolve the ZIP first.
  const place = await geocodeZip(query.zip);
  if (!place) {
    return res.status(400).json({ error: `${query.zip} is not a ZIP code we could find.` });
  }
  query.place = place;
  query.origin = { lat: place.lat, lon: place.lon };

  // The same search from anyone within five minutes is answered from memory,
  // and identical searches arriving together share one fetch.
  const searchKey = JSON.stringify([
    query.zip,
    query.radiusMiles,
    query.major.toLowerCase(),
    [...query.interests].map((i) => i.toLowerCase()).sort(),
    query.term,
    query.classYear,
  ]);
  const { jobs, notes } = await cachedSearch(searchKey, async () => {
    const notes = [];

    // Every source gets a hard deadline, so one that never answers costs its own
    // listings and nothing else — the search still comes back.
    const withDeadline = (name, promise) => {
      let timer;
      const late = new Promise((resolve) => {
        timer = setTimeout(() => {
          notes.push({ source: name, level: 'error', message: 'Did not answer in time; skipped for this search.' });
          console.warn(`[search] ${name} missed the ${SOURCE_DEADLINE_MS / 1000}s deadline`);
          resolve([]);
        }, SOURCE_DEADLINE_MS);
      });
      return Promise.race([promise, late]).finally(() => clearTimeout(timer));
    };

    const settled = await Promise.all([
      withDeadline('Adzuna', fetchAdzuna(query, notes)),
      withDeadline('USAJOBS', fetchUsaJobs(query, notes)),
      withDeadline('The Muse', fetchMuse(query, notes)),
      withDeadline('Remotive', fetchRemotive(query, notes)),
      withDeadline('Jobicy', fetchJobicy(query, notes)),
      withDeadline('Employer boards', fetchEmployerBoards(query, notes)),
      withDeadline('Simplify', fetchSimplify(query, notes)),
      withDeadline('Himalayas', fetchHimalayas(query, notes)),
    ]);
    recordSearch(SEARCH_SOURCES, notes);

    const { jobs: ranked, dropped } = rankForMajor(settled.flat(), query);

    // Remote feeds are large and always fresh, so on score alone they can fill
    // the page in a smaller city and push out the internships people can
    // actually commute to. Remote roles get at most a third of the slots
    // unless there are not enough local ones to fill the rest.
    const local = ranked.filter((j) => !j.remote);
    const remote = ranked.filter((j) => j.remote);
    const remoteKeep = remote.slice(0, Math.max(REMOTE_SLOTS, MAX_RESULTS - local.length));
    const keep = new Set([...local.slice(0, MAX_RESULTS - remoteKeep.length), ...remoteKeep]);
    const jobs = ranked.filter((j) => keep.has(j));

    if (dropped.stale) {
      notes.push({ source: 'Filter', level: 'info', message: `${dropped.stale} listing(s) older than 9 months hidden.` });
    }
    if (dropped.geography) {
      notes.push({ source: 'Filter', level: 'info', message: `${dropped.geography} listing(s) outside the US hidden.` });
    }
    if (dropped.tooFar) {
      notes.push({
        source: 'Filter',
        level: 'info',
        message: `${dropped.tooFar} listing(s) beyond ${query.radiusMiles} miles of ${place.city}, ${place.state} hidden.`,
      });
    }

    if (dropped.unplaceable) {
      notes.push({
        source: 'Filter',
        level: 'info',
        message: `${dropped.unplaceable} listing(s) hidden because their location could not be identified — with a radius set, a listing we cannot place is one we cannot call nearby.`,
      });
    }

    // These are inside the radius on a state-level match only. Saying so is the
    // point: the listing is in a nearby state, but the exact town is unknown.
    const approximate = jobs.filter((j) => j.locationPrecision === 'state').length;
    if (approximate) {
      notes.push({
        source: 'Distance',
        level: 'info',
        message: `${approximate} listing(s) matched by state only — they are in or near ${place.state}, but the exact distance is unknown.`,
      });
    }
    return { jobs, notes };
  });

  // Certifications follow the field, so a teaching search returns teaching
  // credentials rather than the finance catalog.
  const field = detectField(query, TRACKS);
  const pool = field ? CATALOG.filter((c) => c.field === field.id || (c.fields || []).includes(field.id)) : CATALOG;
  const certifications = rankCertifications(pool.length >= 6 ? pool : CATALOG, query, 10);

  const user = currentUser(req);
  const startedTracks = user ? store.getTracks(user.id) : [];

  if (user) store.saveSearch(user.id, query);

  // Paid listings for this field and area, shown above the results and
  // labeled Sponsored. They are never mixed into the ranked list.
  const sponsored = commerce.sponsoredFor({ fieldId: field?.id || null, origin: query.origin, radiusMiles: query.radiusMiles });
  store.bumpSponsored(
    sponsored.map((s) => s.sponsoredId),
    'impressions',
  );

  res.json({
    query: { ...query, place: undefined, origin: undefined },
    place,
    jobs,
    sponsored,
    certifications,
    notes,
    field: field ? { id: field.id, name: field.name, note: field.note } : null,
    track: field
      ? {
          id: field.id,
          name: field.name,
          note: field.note,
          items: buildTrackItems(field, { ledgerItems: LEDGER_ITEMS, catalog: CATALOG }).length,
          added: startedTracks.includes(field.id),
          timeline: field.timeline || [],
        }
      : null,
    deepLinks: deepLinks(query, field),
    suggestEnabled: suggestEnabled(),
  });
});

app.get('/api/searches', requireUser, (req, res) => res.json({ searches: store.getSearches(req.user.id) }));

// ---- Majors ----------------------------------------------------------------
//
// One page per major, at /certifications/<id>: its whole slice of the catalog,
// starter set first, plus when that field recruits.

app.get('/api/majors', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    majors: MAJOR_IDS.map((id) => ({ id, name: TRACKS[id].name, note: TRACKS[id].note, count: majorCertifications(id).length })),
  });
});

app.get('/api/majors/:id', (req, res) => {
  const major = majorPayload(req.params.id);
  if (!major) return res.status(404).json({ error: 'No such major.' });
  res.set('Cache-Control', 'public, max-age=300');
  res.json(major);
});

app.get('/api/tracks', (req, res) => {
  res.json({
    // The home page states the catalog size out loud, so it reads the real
    // number from here rather than carrying a copy that can go stale.
    catalogCount: CATALOG.length,
    tracks: Object.entries(TRACKS).map(([id, t]) => ({
      id,
      name: t.name,
      note: t.note,
      items: buildTrackItems(t, { ledgerItems: LEDGER_ITEMS, catalog: CATALOG }).length,
    })),
    started: (() => {
      const u = currentUser(req);
      return u ? store.getTracks(u.id) : [];
    })(),
  });
});

app.post('/api/suggest', suggestLimiter, async (req, res) => {
  if (!suggestEnabled()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set.' });
  // Each suggestion is a paid API call: a daily cap keeps the bill bounded.
  if (!take('suggest')) return res.status(429).json({ error: "Today's limit for suggestions is reached. Try again tomorrow." });
  try {
    res.json({ suggestions: await suggestCertifications(normalizeQuery(req.body), CATALOG) });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.post('/api/check-url', checkLimiter, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  // This endpoint fetches a URL the client supplies, so keep it off loopback
  // and private ranges rather than turning the server into an SSRF proxy.
  const safe = isSafePublicUrl(url);
  if (!safe.ok) return res.status(400).json({ ok: false, status: 0, reason: safe.reason });
  res.json(await checkUrl(String(url)));
});

// ---- Your own stats (no tracking; computed from what is already stored) ----

// The owner passcode is separate from user accounts: it gates server
// configuration (/api/health/detail), not anybody's personal ledger.
app.get('/api/owner/status', ownerStatus);
app.post('/api/owner/login', loginLimiter, ownerLogin);
app.post('/api/owner/logout', ownerLogout);

app.get('/api/stats', requireUser, (req, res) => {
  const items = store.getAdded(req.user.id);
  const done = store.getDone(req.user.id);
  const searches = store.getSearches(req.user.id);
  const tracks = store.getTracks(req.user.id);

  const completed = items.filter((i) => done[i.id]);
  const hoursDone = completed.reduce((s, i) => s + (i.hours || 0), 0);
  const hoursLeft = items.filter((i) => !done[i.id]).reduce((s, i) => s + (i.hours || 0), 0);

  const byGroup = {};
  for (const item of items) {
    const g = ALL_GROUPS.find((x) => x.id === item.group)?.name || item.group;
    byGroup[g] = byGroup[g] || { total: 0, done: 0, hours: 0 };
    byGroup[g].total += 1;
    byGroup[g].hours += item.hours || 0;
    if (done[item.id]) byGroup[g].done += 1;
  }

  const byProvider = {};
  for (const item of items) {
    byProvider[item.provider] = (byProvider[item.provider] || 0) + 1;
  }

  // Completions per day, for the streak strip.
  const byDay = {};
  for (const iso of Object.values(done)) {
    const d = String(iso).slice(0, 10);
    if (d) byDay[d] = (byDay[d] || 0) + 1;
  }

  const terms = {};
  for (const s of searches) {
    for (const t of [s.major, ...(s.interests || [])].filter(Boolean)) {
      terms[t.toLowerCase()] = (terms[t.toLowerCase()] || 0) + 1;
    }
  }

  res.json({
    totals: {
      items: items.length,
      completed: completed.length,
      percent: items.length ? Math.round((completed.length / items.length) * 100) : 0,
      hoursDone,
      hoursLeft,
      tracks: tracks.length,
      searches: searches.length,
    },
    byGroup,
    byProvider: Object.entries(byProvider)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
    byDay,
    topTerms: Object.entries(terms)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
    recentSearches: searches.slice(0, 8),
    recentlyCompleted: completed
      .map((i) => ({ title: i.title, provider: i.provider, at: done[i.id], hours: i.hours }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 6),
  });
});

/**
 * Public health check stays deliberately thin. Which integrations are
 * configured is useful reconnaissance for an attacker and of no use to a
 * visitor, so the detail sits behind the owner gate.
 */
app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, version: VERSION, startedAt: STARTED_AT, catalogSize: CATALOG.length, tracks: Object.keys(TRACKS).length });
});

/**
 * Errors in visitors' browsers, so a broken page shows up on /owner instead
 * of going unnoticed. Only the message, the page path and the first line of
 * the stack are kept; nothing about the person.
 */
app.post('/api/client-error', clientErrorLimiter, (req, res) => {
  const message = clean(req.body?.message, 300);
  const where = clean(req.body?.path, 120).replace(/[?#].*$/, '');
  const at = clean(req.body?.at, 200).replace(/https?:\/\/[^/\s]+/g, '');
  if (message) logError('browser', `${message}${where ? ` on ${where}` : ''}${at ? ` (${at})` : ''}`);
  res.status(204).end();
});

/**
 * For an uptime monitor: 503 when Adzuna, USAJOBS or email keeps failing, so
 * a revoked key raises an alert instead of silently thinning the results.
 * The body says only ok or not; which one and why is in /api/health/detail.
 */
app.get('/api/health/sources', (_req, res) => {
  const health = sourceHealth();
  res.set('Cache-Control', 'no-store');
  res.status(health.ok ? 200 : 503).json(health);
});

app.get('/api/health/detail', requireOwner, (req, res) => {
  res.json({
    ok: true,
    storage: store.storeBackend(),
    // Presence only. The values are never returned, logged, or sent to the client.
    keys: {
      adzuna: Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
      usajobs: Boolean(process.env.USAJOBS_API_KEY && process.env.USAJOBS_EMAIL),
      muse: true,
      anthropic: suggestEnabled(),
    },
    transport: { secure: Boolean(req.secure), proto: req.protocol },
    // Latest result per job source and for email, with the error if it failed.
    sources: sourceDetail(),
    catalogSize: CATALOG.length,
    tracks: Object.keys(TRACKS).length,
  });
});

// An unknown /api path should answer as an API, not hand back the SPA shell.
app.use('/api', (_req, res) => res.status(404).json({ error: 'No such endpoint.' }));

// Android app (Galaxy Store) verification: proves this domain and the app are
// the same publisher, so the app opens full-screen with no browser address
// bar. The static server denies dot-directories, hence a route of its own.
const ASSET_LINKS = path.join(here, 'data', 'assetlinks.json');
app.get('/.well-known/assetlinks.json', (_req, res) => {
  if (!fs.existsSync(ASSET_LINKS)) return res.status(404).json([]);
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/json').send(fs.readFileSync(ASSET_LINKS, 'utf8'));
});

const dist = path.join(here, '..', 'dist');

// IndexNow (Bing): the key file it fetches to confirm the site is ours, and
// the list of pages sent to it after each deploy. See server/indexnow.js.
const indexNow = createIndexNow({
  keyFile: path.join(here, 'data', 'indexnow-key.txt'),
  sitemapFile: path.join(dist, 'sitemap.xml'),
  siteUrl: process.env.SITE_URL,
  getMeta: store.getMeta,
  setMeta: store.setMeta,
});
if (indexNow.keyPath) {
  app.get(indexNow.keyPath, (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(indexNow.key);
  });
}

// Visit counts for /owner — a tally kept by this server, not a third-party
// script. See server/visits.js. Held in memory and written every two minutes
// (and before every copy to Cloudflare), so a page view costs no disk write.
const visits = createVisits({
  getMeta: store.getMeta,
  setMeta: store.setMeta,
  siteHost: (() => {
    try {
      return new URL(process.env.SITE_URL).hostname;
    } catch {
      return '';
    }
  })(),
});
setInterval(() => visits.flush(), 2 * 60_000).unref();

// The page illustrations, drawn from each page's data.
app.get('/images/:name.svg', (req, res) => {
  const image = images.get(req.params.name);
  if (!image) return res.status(404).type('text/plain').send('Not found');
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml').send(image.draw());
});

// Google AdSense, stage one (review): ads.txt and a verification <meta> tag,
// both only when ADSENSE_CLIENT (ca-pub-…) is set. Neither loads an ad script
// or sets a cookie, so nothing changes for visitors while Google reviews the
// site. Serving ads is a separate, deliberate step: it needs the ad script,
// a consent message and privacy-policy changes (see README).
app.get('/ads.txt', (_req, res) => {
  const c = adsenseClient();
  if (!c) return res.status(404).type('text/plain').send('Not found');
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(`google.com, ${c.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
});

// /llms.txt: a plain-text map of the site for AI assistants. Building it
// renders every content page, so the text is kept for half an hour per origin
// rather than rebuilt for each request.
const LLMS_TTL_MS = 30 * 60_000;
const llmsCache = new Map();
app.get('/llms.txt', (req, res) => {
  const origin = String(process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  res.set('Cache-Control', 'public, max-age=3600');
  const hit = llmsCache.get(origin);
  if (hit && Date.now() - hit.at < LLMS_TTL_MS) return res.type('text/plain; charset=utf-8').send(hit.text);
  const s = contentPages.summaries();
  const certs = [
    { path: '/certifications', ...majors.meta(null) },
    ...MAJOR_IDS.map((id) => ({ path: `/certifications/${id}`, ...majors.meta(id) })),
  ].map((m) => ({ path: m.path, title: m.title.replace(' | Elevate Internships', ''), description: m.description }));
  const text = llmsTxt({
    origin,
    majors: MAJOR_IDS.map((id) => TRACKS[id].name),
    pages: [
      ['The app', s.app],
      ['Internships by major', s.internships],
      ['Certifications by major', certs],
      ['Career guides', s.guides],
      ['Interview questions', s.interviews],
      ...(PREMIUM_ENABLED ? [['Premium', s.premium]] : []),
      ['About', s.about],
    ],
  });
  // Only a few origins ever ask (the site, its www alias, localhost).
  if (llmsCache.size > 5) llmsCache.clear();
  llmsCache.set(origin, { at: Date.now(), text });
  res.type('text/plain; charset=utf-8').send(text);
});

// Addresses people guess or mistype. A 301 sends them, and any link equity,
// to the real page instead of a 404.
const REDIRECTS = {
  '/internship': '/internships',
  '/majors': '/internships',
  '/certification': '/certifications',
  '/certs': '/certifications',
  '/guides': '/career-guides',
  '/career-guide': '/career-guides',
  '/blog': '/career-guides',
  '/about': '/how-it-works',
  '/about-us': '/how-it-works',
  '/faq': '/how-it-works',
  '/accessibility-statement': '/accessibility',
  '/search': '/',
  '/finder': '/',
  '/index.html': '/',
  '/tracker': '/?tab=tracker',
  '/privacy-policy': '/privacy',
  '/terms-and-conditions': '/terms',
  '/terms-of-service': '/terms',
  '/interview': '/interview-questions',
  '/interviews': '/interview-questions',
  // With Premium switched off there is no price page to send them to.
  '/pricing': PREMIUM_ENABLED ? '/premium' : '/',
  '/upgrade': PREMIUM_ENABLED ? '/premium' : '/',
};
app.get(Object.keys(REDIRECTS), (req, res) => res.redirect(301, REDIRECTS[req.path]));
// Page addresses are lowercase; /Internships/Finance is the same page.
app.use((req, res, next) => {
  if (req.method === 'GET' && /[A-Z]/.test(req.path) && /^\/(internships|certifications|career-guides|interview-questions|how-it-works|accessibility|home|privacy|terms|premium|account)(\/|$)/i.test(req.path)) {
    const q = req.originalUrl.slice(req.path.length);
    return res.redirect(301, req.path.toLowerCase().replace(/\/+$/, '') + q);
  }
  next();
});
// /internships/<id> and /certifications/<id> with a trailing slash or capitals.
app.get(/^\/(internships|certifications|career-guides|interview-questions)\/[^/]+\/+$|^\/(internships|certifications|career-guides|interview-questions)\/.*[A-Z]/, (req, res) =>
  res.redirect(301, req.path.replace(/\/+$/, '').toLowerCase()),
);

if (fs.existsSync(dist)) {
  // /owner: visit counts and job-source status. Never indexed, never cached.
  const ownerHeaders = (res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
  };
  app.get('/owner', (req, res) => {
    ownerHeaders(res);
    if (!isOwner(req)) {
      res.status(ownerConfigured() ? 200 : 403).type('html').send(renderLogin(dist, { configured: ownerConfigured() }));
      return;
    }
    const summary = visits.summary(30);
    res.type('html').send(
      renderOwner(dist, {
        visits: summary,
        sources: sourceDetail(),
        showLogout: ownerConfigured(),
        commerce: {
          payments: stripeEnabled(),
          sales: store.salesSummary(),
          funnel: {
            pageLoads: summary.pageTotals['/premium'] || 0,
            checkouts: summary.events['premium-checkout'] || 0,
            ...store.premiumSalesSince(new Date(Date.now() - 30 * 86_400_000).toISOString()),
          },
          sponsored: store.listSponsored(),
          signupsByRef: store.signupsByRef(),
          pushDevices: store.countPushSubs(),
          message: String(req.query.m || '').slice(0, 300),
        },
        health: { version: VERSION, startedAt: STARTED_AT, limits: limitUsage(), errors: recentErrors() },
      }),
    );
  });
  // Approve, reject (with a refund) or end a sponsored listing.
  app.post('/owner/sponsored/:id/:action', loginLimiter, (req, res, next) => {
    ownerHeaders(res);
    if (!isOwner(req)) return res.redirect(303, '/owner');
    if (!['approve', 'reject', 'end'].includes(req.params.action)) return next();
    commerce
      .review(Number(req.params.id), req.params.action)
      .then((message) => res.redirect(303, `/owner?m=${encodeURIComponent(message)}#sponsored`))
      .catch((err) => res.redirect(303, `/owner?m=${encodeURIComponent(`Failed: ${err.message}`)}#sponsored`));
  });
  app.post('/owner', loginLimiter, express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    ownerHeaders(res);
    if (!passcodeMatches(req.body?.passcode)) {
      res
        .status(ownerConfigured() ? 401 : 403)
        .type('html')
        .send(renderLogin(dist, { configured: ownerConfigured(), error: 'That passcode is not right.' }));
      return;
    }
    setOwnerCookie(req, res);
    res.redirect(303, '/owner');
  });
  // Unsubscribe from the weekly email without signing in. Opening the link
  // only shows a button: mail scanners follow links, and a GET that changed
  // anything would unsubscribe people nobody asked about. Mail apps' own
  // one-click unsubscribe (RFC 8058) POSTs here directly.
  const unsubPage = (title, body) => plainPage(dist, `${title} — Elevate Internships`, `<h1>${title}</h1>${body}`);
  const unsubHeaders = (res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
  };
  app.get('/unsubscribe', (req, res) => {
    unsubHeaders(res);
    const token = String(req.query.t || '').slice(0, 100);
    const user = store.userByDigestToken(token);
    if (!user) {
      res.status(404).type('html').send(unsubPage('Link not recognised', '<p>This unsubscribe link is not valid any more. You can turn the weekly email off from the Finder when signed in.</p>'));
      return;
    }
    const body = user.enabled
      ? `<p>Stop the weekly new-internships email?</p><form method="post" action="/unsubscribe?t=${encodeURIComponent(token)}"><button class="btn" type="submit">Unsubscribe</button></form>`
      : '<p>You are already unsubscribed. Nothing more will be sent.</p>';
    res.type('html').send(unsubPage('Weekly email', body));
  });
  app.post('/unsubscribe', loginLimiter, (req, res) => {
    unsubHeaders(res);
    const user = store.userByDigestToken(String(req.query.t || '').slice(0, 100));
    if (!user) {
      res.status(404).type('html').send(unsubPage('Link not recognised', '<p>This unsubscribe link is not valid any more.</p>'));
      return;
    }
    store.setDigestEmail(user.id, false);
    res.type('html').send(unsubPage('Unsubscribed', '<p>Done — no more weekly emails. You can turn them back on from the Finder at any time.</p><p><a href="/">Back to Elevate Internships</a></p>'));
  });

  app.post('/owner/logout', (req, res) => {
    ownerHeaders(res);
    clearOwnerCookie(req, res);
    res.redirect(303, '/owner');
  });

  // dotfiles:'deny' keeps a stray .env out of the served tree even if one is
  // ever copied into dist by a build step.
  app.use(
    express.static(dist, {
      dotfiles: 'deny',
      index: false,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        // The service worker and manifest must always be re-checked, or an
        // installed app could keep running old code.
        if (name === 'sw.js' || name === 'site.webmanifest') {
          res.setHeader('Cache-Control', 'no-cache');
          if (name === 'site.webmanifest') res.setHeader('Content-Type', 'application/manifest+json');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          // Vite puts a content hash in every built asset's name.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // The client routes. Anything else still renders the app, but with a 404 so
  // search engines do not index every mistyped URL as a real page.
  // Must stay in step with KNOWN_PATHS in client/src/App.jsx. A route the
  // client renders but this set omits is served as a 404 with the app inside
  // it — the page works, and search engines are told it does not exist.
  const CLIENT_ROUTES = new Set(['/', '/home', '/terms', '/privacy', '/verify', '/reset', '/account']);
  // Where account emails link to, and the account page. Real pages, but
  // one-person ones: never indexed, and never handed to another site in a
  // Referer header.
  const ACCOUNT_LINK_ROUTES = new Set(['/verify', '/reset', '/account']);

  // Pages that never carry ads: buying Premium or a listing is not the place.
  const NO_AD_PAGES = new Set(['/premium', '/sponsor', '/accessibility']);

  // Adds the AdSense verification tag to every HTML page, once configured.
  app.use((req, res, next) => {
    const c = adsenseClient();
    if (!c || req.method !== 'GET') return next();
    const send = res.send.bind(res);
    res.send = (body) => {
      if (typeof body === 'string' && /html/.test(String(res.get('content-type'))) && body.includes('</head>') && !body.includes('google-adsense-account')) {
        body = body.replace('</head>', `<meta name="google-adsense-account" content="${c}">\n</head>`);
      }
      return send(body);
    };
    next();
  });

  app.get('*', (req, res) => {
    const clean = req.path.replace(/\/+$/, '') || '/';
    res.on('finish', () => {
      if (/html/.test(String(res.get('content-type'))) && !isOwner(req)) visits.record(req, clean, res.statusCode);
    });

    // Major pages are served with their content already in the HTML, so a
    // search engine sees the certifications and timeline without running any
    // JavaScript. React replaces it with the interactive page on load.
    // Internships by major, career guides and how-it-works: plain HTML.
    const viewer = CONTENT_PATH.test(clean) ? currentUser(req) : null;
    const premium = store.isPremium(viewer);
    const content = contentPages.render(dist, clean, { premium });
    if (content) {
      // Signed-in pages differ by viewer (sample answers, no ads), so no shared cache.
      if (viewer) res.set('Cache-Control', 'private, no-store');
      if (!adsOn() || premium || NO_AD_PAGES.has(clean)) {
        res.type('html').send(content);
        return;
      }
      // A fresh nonce per response lets Google's ad script (and the scripts it
      // loads) run while every other script stays blocked.
      const nonce = crypto.randomBytes(16).toString('base64');
      res.set('Content-Security-Policy', adsCsp(nonce));
      res
        .type('html')
        .send(
          content.replace(
            '</head>',
            `<script async nonce="${nonce}" src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient()}" crossorigin="anonymous"></script>\n</head>`,
          ),
        );
      return;
    }

    const major = MAJOR_PATH.exec(clean);
    if (major && (!major[1] || TRACKS[major[1]])) {
      res.type('html').send(renderMajorHtml(dist, major[1] || null));
      return;
    }

    // /home, /privacy and /terms: the app, but with their own title and canonical.
    const appHtml = contentPages.appPage(dist, clean);
    if (appHtml) {
      res.type('html').send(appHtml);
      return;
    }

    if (ACCOUNT_LINK_ROUTES.has(clean)) {
      res.set('X-Robots-Tag', 'noindex, nofollow');
      res.set('Referrer-Policy', 'no-referrer');
      res.set('Cache-Control', 'no-store');
    }
    res.status(CLIENT_ROUTES.has(clean) ? 200 : 404).sendFile(path.join(dist, 'index.html'));
  });
}

// Anything a route threw or rejected ends here: logged for /owner, and
// answered plainly without internals.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request is too large.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'That request could not be read.' });
  }
  console.error(`[error] ${req.method} ${req.path}: ${err.stack || err.message || err}`);
  if (res.headersSent) return;
  if (req.path.startsWith('/api/')) return res.status(status >= 400 && status < 600 ? status : 500).json({ error: 'Something went wrong on our side. Please try again.' });
  res.status(500).type('text/plain').send('Something went wrong on our side. Please try again in a minute.');
});

// In dev this process runs beside Vite. A parent process — a preview runner, an
// IDE, a task manager — may export PORT for the web server *it* launched, which
// is Vite's. Taking that port makes the API lose the race for the socket and
// exit with EADDRINUSE, leaving the page up but every /api call refused. Set
// API_PORT to move the API deliberately; PORT still governs production.
const VITE_DEV_PORT = 5173;
const requestedPort = Number(process.env.API_PORT) || Number(process.env.PORT) || 3001;
const inheritedVitePort = process.env.NODE_ENV !== 'production' && requestedPort === VITE_DEV_PORT;
const port = inheritedVitePort ? 3001 : requestedPort;

if (inheritedVitePort) {
  console.warn(`[api] ignoring PORT=${VITE_DEV_PORT} (that is Vite's) — listening on ${port}. Use API_PORT to override.`);
}

// Warm the dummy password hash so the first sign-in is not measurably slower
// than the rest, which would leak whether an email exists.
await initAuth();

app.listen(port, () => {
  // Start loading the shared job feeds now. On a host that sleeps when idle,
  // the visit that woke it is otherwise the one that waits for all of them.
  warmCaches();
  startReminders({ store, sendMail, emailConfigured, siteUrl: process.env.SITE_URL || 'http://localhost:5173', sendPush: push.sendToUser });
  // The daily alert is a Premium perk; off with Premium (server/features.js).
  if (PREMIUM_ENABLED) startAlerts({ store, push, cachedListings, rankJobs: rankForMajor });
  if (process.env.NODE_ENV === 'production') indexNow.start();
  startDigest({ store, sendMail, emailConfigured, siteUrl: process.env.SITE_URL || 'http://localhost:5173', cachedListings, rankJobs: rankForMajor });

  console.log(
    `[api] http://localhost:${port}  storage=${store.storeBackend()}  catalog=${CATALOG.length}  tracks=${Object.keys(TRACKS).length}`,
  );

  const prod = process.env.NODE_ENV === 'production';
  console.log(`[security] mode=${prod ? 'production' : 'development'}  https=${prod ? 'enforced' : 'not enforced (local)'}`);

  // Fail loudly at boot rather than quietly in production.
  const warn = [];
  if (prod && !process.env.OWNER_PASSCODE) {
    warn.push('OWNER_PASSCODE is unset — the Stats page will be unreachable except from the server itself.');
  }
  if (prod && !process.env.OWNER_SECRET) {
    warn.push('OWNER_SECRET is unset — a random key is used, so owner sessions drop on every restart and will not work across multiple instances.');
  }
  if (process.env.OWNER_PASSCODE && process.env.OWNER_PASSCODE.length < 12) {
    warn.push('OWNER_PASSCODE is shorter than 12 characters.');
  }
  // Neither of these stops the server, but both leave a real person stuck:
  // one cannot reset a forgotten password, the other has nowhere to send a
  // data request the privacy policy promises they can make.
  if (prod && !emailConfigured()) {
    warn.push('No email provider (RESEND_API_KEY or SMTP_*) — password reset links are printed to this log instead of sent. Anyone who forgets their password is locked out.');
  }
  if (prod && !/^https:\/\//.test(String(process.env.SITE_URL || ''))) {
    warn.push('SITE_URL is unset or not https — links in password-reset and confirmation emails point at http://localhost:5173 and will not open.');
  }
  if (prod && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(process.env.CONTACT_EMAIL || '').trim())) {
    warn.push('CONTACT_EMAIL is unset — the privacy policy has no address for data requests.');
  }
  if (prod && stripeEnabled() && !process.env.STRIPE_WEBHOOK_SECRET) {
    warn.push('STRIPE_WEBHOOK_SECRET is unset — a payment is only recorded when the buyer returns to the site. Add the webhook so a closed tab cannot lose one.');
  }
  if (String(process.env.FORCE_HTTPS || '').toLowerCase() === 'false') {
    warn.push('FORCE_HTTPS=false — the HTTPS redirect is disabled. Only do this behind a proxy that already terminates TLS.');
  }
  for (const w of warn) console.warn(`[security] WARNING: ${w}`);
});

// Off-site copies of the database, for hosts whose disk does not survive a
// restart. See server/cloudsave.js.
if (cloudSaveEnabled()) {
  if (store.storeBackend() === 'sqlite') {
    startSaving({ snapshot: store.snapshotDb, changes: store.totalChanges, beforeSave: () => visits.flush() });
  } else {
    console.warn('[cloudsave] WARNING: CF_* is set but storage is JSON — nothing is being copied to Cloudflare.');
  }
}

/* --- Scheduled backups --------------------------------------------------------
 * On a hosting platform the disk is attached to this one service, so there is
 * no separate machine a cron job could run on that can also see the database.
 * The schedule therefore lives here, and runs the same scripts/backup.js you
 * run by hand — online backup API, integrity check, then prune — in a child
 * process so it never blocks a request.
 *
 * "Due" is judged from the newest snapshot on disk, not from when the process
 * started. A redeploy or restart does not add an extra backup, and a server
 * that was down past its slot catches up about a minute after it returns.
 *
 * Snapshots land on the same volume as the database. That protects against a
 * bad deploy or an accidental delete, not against losing the volume — copy
 * them off the host as well (see BACKUPS.md).
 * -------------------------------------------------------------------------- */
const backupEveryHours = Number(process.env.BACKUP_EVERY_HOURS || 0);

if (backupEveryHours > 0 && store.storeBackend() === 'sqlite') {
  const backupDir = path.join(here, '..', 'data', 'backups');
  const script = path.join(here, '..', 'scripts', 'backup.js');
  const intervalMs = backupEveryHours * 60 * 60 * 1000;
  let running = false;

  const newestBackupAt = () => {
    try {
      return fs
        .readdirSync(backupDir)
        .filter((f) => /^launchpad-.*\.db$/.test(f))
        .map((f) => fs.statSync(path.join(backupDir, f)).mtimeMs)
        .reduce((a, b) => Math.max(a, b), 0);
    } catch {
      return 0; // no directory yet means no backup yet
    }
  };

  const runIfDue = () => {
    if (running || Date.now() - newestBackupAt() < intervalMs) return;
    running = true;
    execFile(process.execPath, [script], { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      running = false;
      if (err) {
        // One greppable prefix, so a log alert on "[backup] FAILED" catches it.
        console.error(`[backup] FAILED: ${String(stderr || err.message).trim()}`);
        return;
      }
      const line = String(stdout).split('\n').find((l) => l.startsWith('Backed up')) || 'snapshot written';
      console.log(`[backup] ${line.trim()}`);
    });
  };

  // unref: a pending backup timer must never be what keeps the process alive.
  setTimeout(runIfDue, 60 * 1000).unref();
  setInterval(runIfDue, Math.min(intervalMs, 60 * 60 * 1000)).unref();
  console.log(`[backup] scheduled every ${backupEveryHours}h into data/backups`);
}
