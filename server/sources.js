// Real job-board adapters. Each returns [] and pushes a note on failure so one
// dead source never takes down a search. Nothing here invents a listing and
// nothing is scraped — every endpoint is an official public API.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { museMetrosNear } from './geo.js';
import { take } from './limits.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const EMPLOYERS = JSON.parse(fs.readFileSync(path.join(here, 'data', 'employers.json'), 'utf8'));

const MILES_TO_KM = 1.60934;
const UA = 'career-launchpad/1.0';

function withTimeout(ms = 12_000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

// Feeds send HTML, sometimes entity-encoded twice ("&amp;amp;"). Everything
// here ends up as plain text, which React and the server pages escape again
// on output, so decoding is safe.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·',
};
function decodeEntities(s) {
  let out = s;
  for (let i = 0; i < 3 && /&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(out); i++) {
    out = out.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    });
  }
  return out;
}
const strip = (s) =>
  decodeEntities(String(s || '').replace(/<\/?[^>]+>/g, ' '))
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ---- Shared cache ----------------------------------------------------------
// Employer boards and the big feeds do not depend on who is searching, so they
// are fetched once and shared. A stale entry is served immediately while it
// refreshes in the background, so nobody waits on a refetch after the first
// search. A failed fetch keeps the last good copy rather than caching nothing.
//
// Callers get shallow copies: rankJobs writes distance and "also on" fields
// onto each job, and those must not leak from one person's search into the
// next.

const cache = new Map();

// A load still running after this long is treated as stuck and replaced, so
// one fetch that never settles cannot block every later refresh of its key.
const STUCK_AFTER_MS = 2 * 60_000;
// The longest a search waits on a first load before going ahead without it.
const FIRST_LOAD_WAIT_MS = 20_000;

async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  const fresh = hit && Date.now() - hit.at < ttlMs;
  const stuck = hit?.pending && Date.now() - hit.startedAt > STUCK_AFTER_MS;

  if ((!fresh && !hit?.pending) || stuck) {
    const entry = hit || { at: 0, value: null };
    const run = load()
      .then((value) => {
        entry.value = value;
        entry.at = Date.now();
      })
      .catch((err) => {
        console.warn(`[sources] ${key} failed: ${err?.message || err}`);
        // Keep whatever we had. Retry after a minute rather than on every search.
        entry.at = Date.now() - ttlMs + 60_000;
      })
      .finally(() => {
        if (entry.pending === run) entry.pending = null;
      });
    entry.pending = run;
    entry.startedAt = Date.now();
    cache.set(key, entry);
  }

  const entry = cache.get(key);
  if (entry.value === null && entry.pending) {
    let timer;
    await Promise.race([entry.pending, new Promise((r) => (timer = setTimeout(r, FIRST_LOAD_WAIT_MS)))]);
    clearTimeout(timer);
  }
  return (entry.value || []).map((j) => ({ ...j }));
}

/** Run `fn` over `items` with at most `limit` in flight — polite to the boards. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const BOARD_TTL = 30 * 60_000;
const FEED_TTL = 60 * 60_000;

/** "thenewyorktimes" is not a company name; the names map in employers.json is. */
const companyName = (slug) =>
  EMPLOYERS.names?.[slug] || slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Text we search job boards with: "intern" plus the user's own words. */
export function keywordString({ major, interests }) {
  const words = [major, ...(interests || [])].filter(Boolean).join(' ').trim();
  return words ? `intern ${words}` : 'intern';
}

// Company boards list everything, so titles are filtered to genuine student roles.
const INTERN_TITLE = /\b(intern|internship|co-?op|apprentice|trainee|placement|summer analyst|campus|university (program|grad)|new grad)\b/i;
// PhD and postdoc roles are not open to business undergraduates either.
const NOT_INTERN_TITLE = /\b(senior|sr\.?|principal|staff|lead|director|manager|head of|vp|vice president|phd|ph\.d|postdoc|postdoctoral)\b/i;

// "Product Manager Intern" is a student role; "Manager, Internship Programs"
// is not. Only a manager/lead title followed directly by "intern" is excused.
const MANAGER_INTERN = /\b(manager|lead)\s+(intern|internship|co-?op)\b/gi;
const seniorTitle = (title) => NOT_INTERN_TITLE.test(String(title).replace(MANAGER_INTERN, 'intern'));

export function isInternship(title) {
  return INTERN_TITLE.test(title) && !seniorTitle(title);
}

// ---- Adzuna (key) ----------------------------------------------------------

const ADZUNA_CACHE_MS = 60 * 60_000;
const ADZUNA_CACHE_MAX = 300;
const adzunaCache = new Map();

export async function fetchAdzuna(query, notes) {
  const id = process.env.ADZUNA_APP_ID?.trim();
  const key = process.env.ADZUNA_APP_KEY?.trim();
  if (!id || !key) {
    notes.push({ source: 'Adzuna', level: 'skipped', message: 'No ADZUNA_APP_ID / ADZUNA_APP_KEY set.' });
    return [];
  }

  const where = query.place ? `${query.place.city}, ${query.place.state}` : query.zip;
  const out = [];

  // Adzuna pages are 50 at a time; three pages is plenty and stays inside the
  // free tier's 250 calls/day. The health check asks for one.
  const pages = query.maxPages || 3;

  // The same place, distance and keywords within the hour get the same answer
  // without spending any of the 250 daily calls. The health probe (maxPages)
  // always asks Adzuna, since its job is to notice a broken key.
  const cacheKey = query.maxPages ? null : `${where}|${query.radiusMiles}|${keywordString(query)}`.toLowerCase();
  const cached = cacheKey && adzunaCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ADZUNA_CACHE_MS) {
    // Copies, because ranking adds fields to each listing.
    return cached.jobs.map((j) => ({ ...j }));
  }
  let failed = false;
  for (let page = 1; page <= pages; page++) {
    // Never past the free tier: once today's cap is used, Adzuna is skipped
    // and every other source still answers.
    if (!take('adzuna')) {
      notes.push({ source: 'Adzuna', level: 'skipped', message: "Today's Adzuna allowance is used up; other sources were still searched." });
      failed = true; // a partial answer is not cached
      break;
    }
    const params = new URLSearchParams({
      app_id: id,
      app_key: key,
      results_per_page: '50',
      what: keywordString(query),
      where,
      distance: String(Math.round(query.radiusMiles * MILES_TO_KM)),
      // Adzuna's documented spelling; an unknown parameter is a 400.
      'content-type': 'application/json',
    });

    const t = withTimeout();
    try {
      const url = `https://api.adzuna.com/v1/api/jobs/us/search/${page}?${params}`;
      const opts = { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: t.signal };
      let res = await fetch(url, opts);
      // Adzuna answers 503 now and then when it is busy; a second try a moment
      // later usually gets through. Still inside the same timeout.
      if (res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1200));
        res = await fetch(url, opts);
      }
      if (!res.ok) {
        // Adzuna explains itself ("Authorisation failed", "BAD_ARGUMENT") in
        // the body. Surface that, never the request URL, which holds the key.
        const body = await res.json().catch(() => null);
        const why = [body?.exception, body?.display]
          .filter(Boolean)
          .join(': ')
          .split(id).join('[app_id]')
          .split(key).join('[app_key]')
          .slice(0, 160);
        throw new Error(`HTTP ${res.status}${why ? ` (${why})` : ''}`);
      }
      const json = await res.json();
      const rows = json.results || [];
      out.push(
        ...rows.map((j) => ({
          id: `adzuna:${j.id}`,
          title: strip(j.title) || 'Untitled',
          company: j.company?.display_name || 'Unknown',
          location: j.location?.display_name || where,
          lat: j.latitude ?? null,
          lon: j.longitude ?? null,
          postedAt: j.created || null,
          source: 'Adzuna',
          url: j.redirect_url,
          description: strip(j.description),
        })),
      );
      if (rows.length < 50) break;
    } catch (err) {
      notes.push({ source: 'Adzuna', level: 'error', message: String(err.message || err) });
      failed = true;
      break;
    } finally {
      t.done();
    }
  }
  // Only a complete answer is remembered, so an error is retried next time.
  if (cacheKey && !failed) {
    adzunaCache.set(cacheKey, { at: Date.now(), jobs: out.map((j) => ({ ...j })) });
    if (adzunaCache.size > ADZUNA_CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of adzunaCache) if (now - v.at >= ADZUNA_CACHE_MS) adzunaCache.delete(k);
      // Still too many: drop the oldest (a Map keeps insertion order).
      while (adzunaCache.size > ADZUNA_CACHE_MAX) adzunaCache.delete(adzunaCache.keys().next().value);
    }
  }
  return out;
}

// ---- USAJOBS (key) ---------------------------------------------------------

export async function fetchUsaJobs(query, notes) {
  const key = process.env.USAJOBS_API_KEY?.trim();
  const email = process.env.USAJOBS_EMAIL?.trim();
  if (!key || !email) {
    notes.push({ source: 'USAJOBS', level: 'skipped', message: 'No USAJOBS_API_KEY / USAJOBS_EMAIL set.' });
    return [];
  }

  const params = new URLSearchParams({
    Keyword: [query.major, ...(query.interests || [])].filter(Boolean).join(' ') || 'intern',
    LocationName: query.place ? `${query.place.city}, ${query.place.state}` : query.zip,
    Radius: String(query.radiusMiles),
    ResultsPerPage: '100',
    HiringPath: 'student',
  });

  const t = withTimeout();
  try {
    const res = await fetch(`https://data.usajobs.gov/api/search?${params}`, {
      headers: { Host: 'data.usajobs.gov', 'User-Agent': email, 'Authorization-Key': key },
      signal: t.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json?.SearchResult?.SearchResultItems || []).map((item) => {
      const d = item.MatchedObjectDescriptor || {};
      const loc = d.PositionLocation?.[0];
      return {
        id: `usajobs:${item.MatchedObjectId}`,
        title: strip(d.PositionTitle) || 'Untitled',
        company: d.OrganizationName || d.DepartmentName || 'U.S. Government',
        location: d.PositionLocationDisplay || '',
        lat: loc?.Latitude ?? null,
        lon: loc?.Longitude ?? null,
        postedAt: d.PublicationStartDate || null,
        source: 'USAJOBS',
        url: d.PositionURI,
        description: strip(d.UserArea?.Details?.JobSummary || d.QualificationSummary),
      };
    });
  } catch (err) {
    notes.push({ source: 'USAJOBS', level: 'error', message: String(err.message || err) });
    return [];
  } finally {
    t.done();
  }
}

// ---- The Muse (no key) -----------------------------------------------------

/**
 * The Muse only understands its own metro names, so a ZIP is widened into the
 * metros near it. Previously an unrecognised location was silently ignored and
 * the search collapsed to remote-only listings.
 */
export async function fetchMuse(query, notes) {
  const metros = museMetrosNear(query.origin, query.radiusMiles);
  const out = [];
  const seen = new Set();

  // Query the nearest few metros, two pages each, plus a remote sweep.
  const targets = metros.slice(0, 4);
  const jobs = [];

  for (const metro of targets) {
    for (let page = 0; page < 2; page++) {
      jobs.push({ metro, page });
    }
  }
  jobs.push({ metro: null, page: 0 });

  await Promise.all(
    jobs.map(async ({ metro, page }) => {
      const params = new URLSearchParams({ page: String(page), level: 'Internship', descending: 'true' });
      if (process.env.MUSE_API_KEY) params.set('api_key', process.env.MUSE_API_KEY);
      if (metro) params.append('location', metro);

      const t = withTimeout();
      try {
        const res = await fetch(`https://www.themuse.com/api/public/jobs?${params}`, {
          headers: { 'User-Agent': UA },
          signal: t.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        for (const j of json.results || []) {
          if (seen.has(j.id)) continue;
          seen.add(j.id);
          out.push({
            id: `muse:${j.id}`,
            title: strip(j.name) || 'Untitled',
            company: j.company?.name || 'Unknown',
            location: (j.locations || []).map((l) => l.name).join(', ') || 'Unspecified',
            postedAt: j.publication_date || null,
            source: 'The Muse',
            url: j.refs?.landing_page,
            description: strip(j.contents),
          });
        }
      } catch (err) {
        notes.push({ source: 'The Muse', level: 'error', message: String(err.message || err) });
      } finally {
        t.done();
      }
    }),
  );

  if (metros.length === 0) {
    notes.push({
      source: 'The Muse',
      level: 'info',
      message: 'No Muse metro within range of that ZIP; showing remote roles only.',
    });
  }
  return out;
}

// ---- Remote boards (no key) ------------------------------------------------

export async function fetchRemotive(query, notes) {
  const params = new URLSearchParams({ search: keywordString(query), limit: '100' });
  const t = withTimeout();
  try {
    const res = await fetch(`https://remotive.com/api/remote-jobs?${params}`, {
      headers: { 'User-Agent': UA },
      signal: t.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.jobs || [])
      .filter((j) => isInternship(j.title || ''))
      .map((j) => ({
        id: `remotive:${j.id}`,
        title: strip(j.title),
        company: j.company_name || 'Unknown',
        location: j.candidate_required_location ? `Remote · ${j.candidate_required_location}` : 'Remote',
        remote: true,
        postedAt: j.publication_date || null,
        source: 'Remotive',
        url: j.url,
        description: strip(j.description),
      }));
  } catch (err) {
    notes.push({ source: 'Remotive', level: 'error', message: String(err.message || err) });
    return [];
  } finally {
    t.done();
  }
}

export async function fetchJobicy(query, notes) {
  const t = withTimeout();
  try {
    const res = await fetch('https://jobicy.com/api/v2/remote-jobs?count=50&geo=usa', {
      headers: { 'User-Agent': UA },
      signal: t.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.jobs || [])
      .filter((j) => isInternship(j.jobTitle || ''))
      .map((j) => ({
        id: `jobicy:${j.id}`,
        title: strip(j.jobTitle),
        company: j.companyName || 'Unknown',
        location: j.jobGeo ? `Remote · ${j.jobGeo}` : 'Remote',
        remote: true,
        postedAt: j.pubDate || null,
        source: 'Jobicy',
        url: j.url,
        description: strip(j.jobExcerpt || j.jobDescription),
      }));
  } catch (err) {
    notes.push({ source: 'Jobicy', level: 'error', message: String(err.message || err) });
    return [];
  } finally {
    t.done();
  }
}

// ---- Employer job boards (no key) ------------------------------------------
// Greenhouse, Lever, Ashby and SmartRecruiters expose every company's own board
// as public JSON. This is the employer's official feed, not a scrape, and it
// reaches roles the aggregators miss entirely.
//
// A 404 means the slug is gone, so it returns []. A network failure throws, so
// the cache keeps the last good copy instead of remembering an empty board.

async function getJson(url, ms = 10_000) {
  const t = withTimeout(ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: t.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    t.done();
  }
}

async function greenhouseBoard(slug) {
  const json = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
  return (json?.jobs || [])
    .filter((j) => isInternship(j.title || ''))
    .map((j) => ({
      id: `gh:${slug}:${j.id}`,
      title: strip(j.title),
      company: companyName(slug),
      location: j.location?.name || 'Unspecified',
      // updated_at moves on every edit, so it keeps a long-open posting inside
      // the nine-month freshness window. first_published is when it actually
      // went up — that is what "new" should mean.
      postedAt: j.updated_at || null,
      publishedAt: j.first_published || null,
      // Some employers set a closing date; saving the job carries it into the
      // tracker's "Apply by".
      deadline: /^\d{4}-\d{2}-\d{2}/.test(j.application_deadline || '') ? j.application_deadline.slice(0, 10) : undefined,
      source: 'Greenhouse',
      url: j.absolute_url,
      description: '',
    }));
}

async function leverBoard(slug) {
  const json = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  return (Array.isArray(json) ? json : [])
    .filter((j) => isInternship(j.text || ''))
    .map((j) => ({
      id: `lever:${slug}:${j.id}`,
      title: strip(j.text),
      company: companyName(slug),
      location: j.categories?.location || 'Unspecified',
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      source: 'Lever',
      url: j.hostedUrl,
      description: strip(j.descriptionPlain || ''),
    }));
}

async function ashbyBoard(slug) {
  const json = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  return (json?.jobs || [])
    .filter((j) => isInternship(j.title || ''))
    .map((j) => ({
      id: `ashby:${slug}:${j.id}`,
      title: strip(j.title),
      company: companyName(slug),
      location: j.location || j.locationName || 'Unspecified',
      remote: Boolean(j.isRemote),
      postedAt: j.publishedAt || null,
      source: 'Ashby',
      url: j.jobUrl || j.applyUrl,
      description: strip(j.descriptionPlain || ''),
    }));
}

/**
 * SmartRecruiters boards are large (Bosch alone lists thousands), so only US
 * postings are requested and at most three pages are read. The API's own `q`
 * search matches "international" and "internal", so titles are filtered here.
 */
async function smartRecruitersBoard(company) {
  const out = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const json = await getJson(
      `https://api.smartrecruiters.com/v1/companies/${company}/postings?country=us&limit=100&offset=${offset}`,
    );
    const rows = json?.content || [];
    for (const j of rows) {
      if (!isInternship(j.name || '')) continue;
      const loc = j.location || {};
      out.push({
        id: `sr:${company}:${j.id}`,
        title: strip(j.name),
        company: j.company?.name || companyName(company),
        location: loc.remote ? `Remote · ${loc.fullLocation || 'United States'}` : loc.fullLocation || 'Unspecified',
        lat: loc.latitude ? Number(loc.latitude) : null,
        lon: loc.longitude ? Number(loc.longitude) : null,
        remote: Boolean(loc.remote),
        postedAt: j.releasedDate || null,
        source: 'SmartRecruiters',
        url: `https://jobs.smartrecruiters.com/${company}/${j.id}`,
        description: '',
      });
    }
    if (offset + rows.length >= (json?.totalFound || 0)) break;
  }
  return out;
}

const BOARDS = [
  ...(EMPLOYERS.greenhouse || []).map((s) => ['greenhouse', s, greenhouseBoard]),
  ...(EMPLOYERS.lever || []).map((s) => ['lever', s, leverBoard]),
  ...(EMPLOYERS.ashby || []).map((s) => ['ashby', s, ashbyBoard]),
  ...(EMPLOYERS.smartrecruiters || []).map((s) => ['smartrecruiters', s, smartRecruitersBoard]),
];

/** What is cached for a key right now, without waiting for or starting a load. */
const peek = (key) => (cache.get(key)?.value || []).map((j) => ({ ...j }));

// Refreshing ~300 boards runs in the background, one pass at a time. A search
// waits a short while for it and then uses whatever boards have arrived, so a
// slow host or a slow board delays the list, never the answer.
let warming = null;
function warmBoards() {
  if (!warming) {
    warming = pool(BOARDS, 16, ([kind, slug, load]) => cached(`${kind}:${slug}`, BOARD_TTL, () => load(slug))).finally(
      () => {
        warming = null;
      },
    );
  }
  return warming;
}

const BOARDS_WAIT_MS = 15_000;

/**
 * Everything already in the shared cache — employer boards, Simplify and
 * Himalayas — without fetching anything. The major pages use this to show
 * recent real listings without adding a request per page view.
 */
export function cachedListings() {
  return [...BOARDS.map(([kind, slug]) => `${kind}:${slug}`), 'simplify', 'himalayas'].flatMap(peek);
}

/** Starts every shared load, so the first visitor after a restart does not wait for them. */
export function warmCaches() {
  warmBoards().catch(() => {});
  cached('simplify', FEED_TTL, loadSimplify).catch(() => {});
  cached('himalayas', FEED_TTL, loadHimalayas).catch(() => {});
}

export async function fetchEmployerBoards(_query, notes) {
  try {
    let timer;
    await Promise.race([warmBoards(), new Promise((r) => (timer = setTimeout(r, BOARDS_WAIT_MS)))]);
    clearTimeout(timer);
    const jobs = BOARDS.flatMap(([kind, slug]) => peek(`${kind}:${slug}`));
    if (jobs.length === 0) {
      notes.push({ source: 'Employer boards', level: 'info', message: 'No intern roles open on the tracked boards.' });
    }
    return jobs;
  } catch (err) {
    notes.push({ source: 'Employer boards', level: 'error', message: String(err.message || err) });
    return [];
  }
}

// ---- Simplify internship list (no key) -------------------------------------
// The list Simplify and the Pitt CS Club keep on GitHub: thousands of
// internships, updated daily, each linking to the employer's own application
// page. It is mostly engineering, so only the business-facing slice is kept —
// product, quant and trading, and analyst roles from the data category.
//
// The repository is renamed each season (Summer2027 → Summer2028) and GitHub
// redirects the old name, so this URL keeps working across the rename.

const SIMPLIFY_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json';

const SIMPLIFY_BUSINESS = /^(product|quant|product management|quantitative finance)$/i;
const SIMPLIFY_DATA = /^(ai\/ml\/data|data science, ai & machine learning)$/i;
const BUSINESS_TITLE = /\b(analyst|analytics|business|insights?|intelligence|strategy|operations|finance|financial|marketing|sales|consult\w*|risk|audit|account\w*|supply chain|product)\b/i;
const TECHNICAL_TITLE = /\b(engineer\w*|developer|software|scientist|research(er)?|phd|c\+\+|machine learning|ml|hardware|firmware)\b/i;

// Simplify writes the big cities in shorthand the geocoder cannot place.
const SHORTHAND = { NYC: 'New York, NY', SF: 'San Francisco, CA', LA: 'Los Angeles, CA', DC: 'Washington, DC' };

async function loadSimplify() {
  const t = withTimeout(30_000);
  let rows;
  try {
    const res = await fetch(SIMPLIFY_URL, { headers: { 'User-Agent': UA }, signal: t.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = await res.json();
  } finally {
    t.done();
  }

  const out = [];
  for (const j of Array.isArray(rows) ? rows : []) {
    if (!j.active || j.is_visible === false || !j.url) continue;
    const title = String(j.title || '');
    const category = String(j.category || '');
    const business = SIMPLIFY_BUSINESS.test(category) || (SIMPLIFY_DATA.test(category) && BUSINESS_TITLE.test(title));
    if (!business || TECHNICAL_TITLE.test(title)) continue;
    // Titles here often omit "intern" ("Summer Analyst"), so that is not
    // required — but a manager or director title slipped into the list is not
    // a student role.
    if (seniorTitle(title)) continue;
    // A PhD-only role is not one an undergraduate business student can take.
    const degrees = j.degrees || [];
    if (degrees.length && !degrees.some((d) => /bachelor|mba|associate/i.test(d))) continue;

    const locations = (j.locations || []).map((l) => SHORTHAND[l] || l);
    out.push({
      id: `simplify:${j.id}`,
      title,
      company: j.company_name || 'Unknown',
      location: locations.join('; ') || 'Unspecified',
      postedAt: j.date_posted ? new Date(j.date_posted * 1000).toISOString() : null,
      source: 'Simplify',
      url: j.url,
      description: (j.terms || []).filter((x) => x !== 'N/A').join(', '),
    });
  }
  return out;
}

export async function fetchSimplify(_query, notes) {
  try {
    return await cached('simplify', FEED_TTL, loadSimplify);
  } catch (err) {
    notes.push({ source: 'Simplify', level: 'error', message: String(err.message || err) });
    return [];
  }
}

// ---- Himalayas (no key) ----------------------------------------------------
// Remote internships open to US applicants. Himalayas asks that listings link
// back to its page and name it as the source — the apply link below is the
// Himalayas page, and the badge says "Himalayas". It also asks for caching
// rather than a request per visitor, hence the hour-long shared cache.

const HIMALAYAS_PAGES = 10;

async function loadHimalayas() {
  const pages = await pool(
    Array.from({ length: HIMALAYAS_PAGES }, (_, i) => i + 1),
    3,
    (page) => getJson(`https://himalayas.app/jobs/api/search?employment_type=Intern&country=US&page=${page}`, 15_000),
  );
  const seen = new Set();
  const out = [];
  for (const json of pages) {
    for (const j of json?.jobs || []) {
      const url = j.applicationLink || j.guid;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const where = (j.locationRestrictions || []).join(', ') || 'United States';
      out.push({
        id: `himalayas:${url}`,
        title: strip(j.title) || 'Untitled',
        company: j.companyName || 'Unknown',
        location: `Remote · ${where}`,
        remote: true,
        postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null,
        source: 'Himalayas',
        url,
        description: strip(j.excerpt),
      });
    }
  }
  if (out.length === 0) throw new Error('No listings returned');
  return out;
}

export async function fetchHimalayas(_query, notes) {
  try {
    return await cached('himalayas', FEED_TTL, loadHimalayas);
  } catch (err) {
    notes.push({ source: 'Himalayas', level: 'error', message: String(err.message || err) });
    return [];
  }
}
