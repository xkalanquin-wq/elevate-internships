// Visit counts, kept by the server itself.
//
// The privacy policy promises no third-party analytics and no tracking, so
// this is deliberately a tally rather than a log: per day, how many pages
// were loaded, which ones, and which site sent people here. No IP address,
// user-agent, cookie or full referring URL is stored — the user-agent is read
// only to leave bots out, and the referrer is cut down to its site name.
//
// Only page loads reach here. The app is one page, so moving between its tabs
// does not count again; a "visit" is a page load that did not come from
// another page of this site.

const KEY = 'visits.v1';
const KEEP_DAYS = 120;
// A misbehaving crawler inventing URLs should not grow this without end.
const MAX_PATHS_PER_DAY = 300;
const MAX_SOURCES_PER_DAY = 100;
// Named steps the server counts itself, such as a Premium payment page being
// opened. The names are fixed in code, so this only guards against mistakes.
const MAX_EVENTS_PER_DAY = 20;

// Crawlers, link previews, uptime checks and scripts, including our own tests.
const NOT_A_PERSON =
  /bot|crawl|spider|slurp|preview|monitor|uptime|headless|lighthouse|pagespeed|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|curl|wget|python|java\/|go-http|okhttp|axios|node|undici|httpclient|libwww|scrapy|validator|checker|scanner/i;

// Apps and short links that stand for one site.
// Order matters: mail.google.com is email, not a Google search.
const SITE_ALIASES = [
  [/mail\.google|outlook|mail\.yahoo/, 'email'],
  [/(^|\.)lnkd\.in$|linkedin/, 'linkedin.com'],
  [/joinhandshake|handshake/, 'joinhandshake.com'],
  [/(^|\.)t\.co$|twitter|^x\.com$/, 'x.com'],
  [/facebook|fb\.me|^l\.facebook/, 'facebook.com'],
  [/instagram/, 'instagram.com'],
  [/reddit/, 'reddit.com'],
  [/(^|\.)google\.|googlequicksearchbox/, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/duckduckgo/, 'duckduckgo'],
];

export function createVisits({ getMeta, setMeta, siteHost = '' }) {
  let pending = {}; // day -> { views, visits, paths, sources, events }

  const bump = (obj, key, cap) => {
    if (!(key in obj) && Object.keys(obj).length >= cap) key = '(other)';
    obj[key] = (obj[key] || 0) + 1;
  };

  /** "https://www.linkedin.com/feed/" -> "linkedin.com"; null when it is this site or unreadable. */
  function sourceOf(req) {
    // A referral link (?ref=uconn-jamie) counts as its own source, so each
    // campus ambassador's link shows up separately.
    const refCode = String(req.query?.ref || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 32);
    const tag = refCode
      ? `ref:${refCode}`
      : String(req.query?.utm_source || '')
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '')
          .slice(0, 40);
    let host = '';
    const ref = req.get('referer');
    if (ref) {
      try {
        // android-app://com.linkedin.android/ reads as a host too.
        host = new URL(ref).hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
      } catch {
        host = '';
      }
    }
    const ours = new Set([siteHost, String(req.get('host') || '').replace(/:\d+$/, '')].filter(Boolean).map((h) => h.replace(/^www\./, '')));
    const internal = host && ours.has(host);
    if (tag) return { source: tag, internal: false };
    if (internal) return { source: null, internal: true };
    if (!host) return { source: 'direct', internal: false };
    const alias = SITE_ALIASES.find(([re]) => re.test(host));
    return { source: alias ? alias[1] : host.slice(0, 60), internal: false };
  }

  /** Counts one named step for today, e.g. 'premium-checkout'. A tally only: who did it is not kept. */
  function count(name) {
    const day = new Date().toISOString().slice(0, 10);
    const d = (pending[day] ||= { views: 0, visits: 0, paths: {}, sources: {}, events: {} });
    bump((d.events ||= {}), String(name).slice(0, 40), MAX_EVENTS_PER_DAY);
  }

  /** Called once a page response is sent. Ignores everything that is not a person loading a page. */
  function record(req, path, status) {
    if (req.method !== 'GET') return;
    const ua = req.get('user-agent');
    if (!ua || NOT_A_PERSON.test(ua)) return;
    const dest = req.get('sec-fetch-dest');
    if (dest && dest !== 'document') return;
    if (/prefetch|prerender/i.test(`${req.get('sec-purpose') || ''} ${req.get('purpose') || ''}`)) return;

    const day = new Date().toISOString().slice(0, 10);
    const d = (pending[day] ||= { views: 0, visits: 0, paths: {}, sources: {}, events: {} });
    d.views += 1;
    bump(d.paths, status === 404 ? '(page not found)' : path, MAX_PATHS_PER_DAY);
    const { source, internal } = sourceOf(req);
    if (!internal) {
      d.visits += 1;
      bump(d.sources, source, MAX_SOURCES_PER_DAY);
    }
  }

  function load() {
    try {
      return JSON.parse(getMeta(KEY) || '{}');
    } catch {
      return {};
    }
  }

  /** Adds what is in memory to the database. Cheap when nothing happened. */
  function flush() {
    const days = Object.keys(pending);
    if (days.length === 0) return;
    const all = load();
    for (const day of days) {
      const p = pending[day];
      const d = (all[day] ||= { views: 0, visits: 0, paths: {}, sources: {} });
      d.views += p.views;
      d.visits += p.visits;
      for (const [k, n] of Object.entries(p.paths)) d.paths[k] = (d.paths[k] || 0) + n;
      for (const [k, n] of Object.entries(p.sources)) d.sources[k] = (d.sources[k] || 0) + n;
      for (const [k, n] of Object.entries(p.events || {})) (d.events ||= {})[k] = (d.events[k] || 0) + n;
    }
    const oldest = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const day of Object.keys(all)) if (day < oldest) delete all[day];
    pending = {};
    setMeta(KEY, JSON.stringify(all));
  }

  /** Totals for the owner page: per day, and the top pages and sources over `days`. */
  function summary(days = 30) {
    flush();
    const all = load();
    const list = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const d = all[day];
      list.push({ day, visits: d?.visits || 0, views: d?.views || 0 });
    }
    const sum = (field, n) => list.slice(0, n).reduce((s, d) => s + d[field], 0);
    const top = (field) => {
      const t = {};
      for (const { day } of list) for (const [k, n] of Object.entries(all[day]?.[field] || {})) t[k] = (t[k] || 0) + n;
      return Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 25);
    };
    // Totals over the whole window, not capped like the lists above.
    const totalOf = (field) => {
      const t = {};
      for (const { day } of list) for (const [k, n] of Object.entries(all[day]?.[field] || {})) t[k] = (t[k] || 0) + n;
      return t;
    };
    return {
      days: list,
      pageTotals: totalOf('paths'),
      events: totalOf('events'),
      totals: { visits7: sum('visits', 7), views7: sum('views', 7), visits30: sum('visits', days), views30: sum('views', days) },
      sources: top('sources'),
      pages: top('paths'),
    };
  }

  return { record, count, flush, summary, sourceOf };
}
