// Merge, dedupe, score. Scoring is keyword overlap against major + interests,
// then recency as the tiebreaker.

const UNDERCLASS_MARKERS = ['sophomore', 'early insight', 'freshman', 'first-year', 'first year', 'rising sophomore'];

const stop = new Set(['and', 'the', 'of', 'for', 'in', 'a', 'an', 'to', 'with', 'or']);

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length > 2 && !stop.has(w));
}

function dedupeKey(job) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${norm(job.company)}::${norm(job.title)}`;
}

function daysOld(postedAt) {
  if (!postedAt) return 999;
  const ms = Date.now() - new Date(postedAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 86_400_000) : 999;
}

// An internship posting older than this is a dead listing — boards keep them
// visible long after the cohort has been hired.
const MAX_AGE_DAYS = 270;

// A title that names a year already over ("Summer 2025", "Intern (2022)") is
// an expired posting, however recently the board last touched it. Only whole
// years count: a posting for this year may still be open.
function namesPastYear(title) {
  const thisYear = new Date().getFullYear();
  return (String(title).match(/\b20\d{2}\b/g) || []).some((y) => Number(y) < thisYear);
}

// Slack allowed when a listing is placed only to a state centroid. Chosen so a
// neighbouring state still qualifies for a typical search while a state on the
// other side of the country never does.
const STATE_SLACK_MILES = 150;

import { distanceMiles, locateText, looksRemote } from './geo.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Aggregators mix worldwide listings into a US search. Anything naming a
// foreign country is dropped unless it also names a US location.
const FOREIGN = [
  'greece', 'poland', 'germany', 'france', 'spain', 'italy', 'portugal', 'ireland',
  'india', 'china', 'japan', 'singapore', 'australia', 'brazil', 'mexico', 'canada',
  'netherlands', 'sweden', 'norway', 'denmark', 'finland', 'romania', 'hungary',
  'czech', 'austria', 'switzerland', 'belgium', 'israel', 'turkey', 'egypt',
  'philippines', 'vietnam', 'malaysia', 'indonesia', 'thailand', 'korea',
  'argentina', 'chile', 'colombia', 'peru', 'south africa', 'nigeria', 'kenya',
  'united kingdom', 'england', 'scotland', 'wales', 'london',
  'qatar', 'dubai', 'uae', 'saudi', 'bahrain', 'kuwait', 'jordan', 'lebanon',
  'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'taiwan', 'hong kong',
  'new zealand', 'ukraine', 'poland', 'bulgaria', 'serbia', 'croatia', 'greece',
  'estonia', 'latvia', 'lithuania', 'slovakia', 'slovenia', 'iceland', 'malta',
  'cyprus', 'morocco', 'tunisia', 'ghana', 'uganda', 'tanzania', 'ethiopia',
];

// Country names are not enough. Boards routinely write a bare foreign city —
// "Bengaluru", "Dublin", "Toronto", "Barcelona" — with no country attached.
// Those named no country, so they passed the filter below, then failed to
// match any US city, and were kept as "unplaceable". A 25-mile search around
// Bristol, CT was returning jobs in India and Spain because of this.
//
// Only cities with no US namesake belong here. Dublin (OH, CA), Toronto (OH),
// Birmingham (AL), Manchester (NH), Columbia and Cambridge (MA) all exist in
// the States, so they are matched as "city, country" pairs further down
// instead of being banned outright.
const FOREIGN_CITIES = [
  'bengaluru', 'bangalore', 'mumbai', 'delhi', 'hyderabad', 'chennai', 'pune', 'kolkata',
  'gurgaon', 'gurugram', 'noida', 'ahmedabad',
  'barcelona', 'madrid', 'lisbon', 'porto', 'milan', 'rome', 'turin', 'naples',
  'munich', 'berlin', 'hamburg', 'frankfurt', 'cologne', 'stuttgart', 'dusseldorf',
  'paris', 'lyon', 'marseille', 'toulouse', 'bordeaux', 'nantes',
  'amsterdam', 'rotterdam', 'utrecht', 'eindhoven', 'the hague',
  'brussels', 'antwerp', 'luxembourg city', 'zurich', 'geneva', 'basel', 'bern',
  'vienna', 'prague', 'brno', 'warsaw', 'krakow', 'wroclaw', 'gdansk',
  'budapest', 'bucharest', 'sofia', 'belgrade', 'zagreb', 'ljubljana', 'bratislava',
  'stockholm', 'gothenburg', 'copenhagen', 'oslo', 'helsinki', 'reykjavik',
  'tallinn', 'riga', 'vilnius', 'athens', 'thessaloniki',
  'tokyo', 'osaka', 'kyoto', 'yokohama', 'seoul', 'busan', 'taipei',
  'beijing', 'shanghai', 'shenzhen', 'guangzhou', 'hangzhou', 'hong kong',
  'singapore', 'kuala lumpur', 'jakarta', 'bangkok', 'manila', 'ho chi minh', 'hanoi',
  'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'auckland', 'wellington',
  'toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'edmonton', 'winnipeg',
  'mexico city', 'guadalajara', 'monterrey', 'sao paulo', 'rio de janeiro',
  'buenos aires', 'santiago', 'bogota', 'lima', 'montevideo',
  'tel aviv', 'jerusalem', 'haifa', 'istanbul', 'ankara', 'cairo', 'nairobi',
  'lagos', 'johannesburg', 'cape town', 'casablanca', 'tunis', 'accra',
  'dubai', 'abu dhabi', 'doha', 'riyadh', 'jeddah', 'manama', 'kuwait city',
  'karachi', 'lahore', 'islamabad', 'dhaka', 'colombo', 'kathmandu',
  'edinburgh', 'glasgow', 'manchester, uk', 'bristol, uk', 'leeds', 'belfast',
  'dublin, ireland', 'cork, ireland', 'sofia, bulgaria',
];

// Any of those cities as a whole word. Plain `includes` would match "lima"
// inside "climate" and "cork" inside "corkscrew", banning US listings by
// accident. Built once: a pattern per city per listing was most of the cost
// of ranking, and the major pages and /llms.txt rank every cached listing.
const FOREIGN_CITY = new RegExp(`(^|[^a-z])(${FOREIGN_CITIES.map(escapeRe).join('|')})($|[^a-z])`, 'i');

const US_STATES = /\b(a[klrz]|c[aot]|d[ce]|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy])\b/i;

// Title conventions that only appear on non-US postings: German gender tags
// ("(m/w/d)"), and the local words for a student job in Germany, Spain and
// France. Remote feeds sometimes label these "worldwide".
const FOREIGN_TITLE = /\((?:m\/[wf]\/[dx]|f\/m\/d|w\/m\/d)\)|\bwerkstudent|\bpraktikum|\bpráctica|\bpracticas\b|\bprácticas\b|\bstagiaire\b|\balternance\b/i;

function isRelevantGeography(job) {
  if (FOREIGN_TITLE.test(String(job.title || ''))) return false;
  const loc = String(job.location || '').toLowerCase();
  if (!loc) return true;
  const foreign =
    FOREIGN.some((c) => loc.includes(c)) || FOREIGN_CITY.test(loc);
  if (!foreign) return true;
  // "Flexible / Remote, Athens, Greece" is really a Greek role; but an explicit
  // US state alongside the country means it is genuinely open to US applicants.
  return US_STATES.test(loc) || loc.includes('usa') || loc.includes('united states');
}

// Engineering and development roles. Every major here is a business major, so
// these sink below business roles unless the search asks for them (see
// `demoteTechnical`). "Research" is left out: equity and market research are
// business roles. A title that also names a business function is kept as is.
const TECHNICAL_TITLE = /\b(engineer\w*|developer|software|scientist|hardware|firmware|machine learning|devops|front-?end|back-?end|full[- ]?stack|ios|android)\b/i;
const BUSINESS_TITLE = /\b(sales|business|marketing|finance|financial|product|analyst|operations|account\w*|strategy|consult\w*)\b/i;

/**
 * A major's job-title words (majors-content.json "keywords") as patterns:
 * whole words only, so "tax" does not match "Taxpayers", and a trailing "*"
 * matches any ending ("underwrit*").
 */
export function compileFieldTerms(words = []) {
  return words.map((w) => {
    const stem = w.endsWith('*');
    const core = (stem ? w.slice(0, -1) : w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${core}${stem ? '' : '($|[^a-z0-9])'}`);
  });
}

export function rankJobs(jobs, query) {
  const wanted = new Set([...tokens(query.major), ...(query.interests || []).flatMap(tokens)]);
  const termWords = query.term && query.term !== 'any' ? tokens(query.term) : [];
  // The detected major's own title words. They say more than the words of
  // the major's name: for "Sport Management", "Ticket Sales" at a team should
  // beat "Product Management" at a bank, which matches the name better.
  const fieldTerms = compileFieldTerms(query.fieldTerms);

  const dropped = { stale: 0, geography: 0, tooFar: 0, unplaceable: 0 };
  const origin = query.origin || null;
  const radius = query.radiusMiles || 50;

  const seen = new Map();
  for (const job of jobs) {
    if (!job.url) continue;
    if (daysOld(job.postedAt) > MAX_AGE_DAYS || namesPastYear(job.title)) {
      dropped.stale += 1;
      continue;
    }
    if (!isRelevantGeography(job)) {
      dropped.geography += 1;
      continue;
    }

    // Real distance, in miles, from the ZIP the user entered.
    const remote = job.remote || looksRemote(job.location);
    let miles = null;
    let precision = null;

    if (!remote && origin) {
      const point =
        job.lat != null && job.lon != null
          ? { lat: Number(job.lat), lon: Number(job.lon), precision: 'city' }
          : locateText(job.location, origin);

      if (!point) {
        // Previously these were kept "rather than guess", which sounded
        // cautious but meant the radius silently did not apply to them. On a
        // 25-mile search that was 12 of 33 results, including Bengaluru and
        // Luxembourg. If someone sets a radius, a listing we cannot place is
        // one we cannot honestly claim is nearby — so it goes, and the count
        // is reported rather than hidden.
        dropped.unplaceable += 1;
        continue;
      }

      precision = point.precision || 'city';
      const d = distanceMiles(origin, point);

      if (precision === 'state') {
        // A state centroid can sit a long way from a real address inside that
        // state, so comparing it against the raw radius would throw away
        // genuine neighbours. The slack is roughly half a large state's
        // extent: near states survive, distant ones do not.
        if (d === null || d > radius + STATE_SLACK_MILES) {
          dropped.tooFar += 1;
          continue;
        }
        // Deliberately left null: we know the state, not the distance, and a
        // number here would be fiction.
        miles = null;
      } else {
        if (d === null || d > radius) {
          dropped.tooFar += 1;
          continue;
        }
        miles = d;
      }
    }

    job.remote = remote;
    job.distanceMiles = miles;
    job.locationPrecision = remote ? 'remote' : precision;

    const key = dedupeKey(job);
    const existing = seen.get(key);
    if (existing) {
      // Keep the one with more description text; remember both source badges.
      const keep = (job.description || '').length > (existing.description || '').length ? job : existing;
      const drop = keep === job ? existing : job;
      keep.alsoOn = [...new Set([...(keep.alsoOn || []), ...(drop.alsoOn || []), drop.source])].filter(
        (s) => s !== keep.source,
      );
      seen.set(key, keep);
    } else {
      seen.set(key, job);
    }
  }

  const scored = [...seen.values()].map((job) => {
    const haystack = tokens(`${job.title} ${job.company} ${job.description}`.slice(0, 4000));
    const bag = new Set(haystack);
    const matched = [...wanted].filter((w) => bag.has(w));

    let score = matched.length * 10;
    // Title hits are worth more than body hits.
    const titleBag = new Set(tokens(job.title));
    score += [...wanted].filter((w) => titleBag.has(w)).length * 8;
    if (/intern/i.test(job.title)) score += 12;
    if (termWords.some((t) => bag.has(t))) score += 6;
    if (fieldTerms.length) {
      const title = String(job.title || '').toLowerCase();
      if (fieldTerms.some((re) => re.test(title))) score += 20;
      else if (fieldTerms.some((re) => re.test(String(job.company || '').toLowerCase()))) score += 8;
    }
    if (query.demoteTechnical && TECHNICAL_TITLE.test(job.title) && !BUSINESS_TITLE.test(job.title)) score -= 25;

    const age = daysOld(job.postedAt);
    score += Math.max(0, 20 - age / 3);

    // Nearby beats far; a known distance beats an unknown one.
    if (job.distanceMiles !== null && job.distanceMiles !== undefined) {
      score += Math.max(0, 18 - job.distanceMiles / 4);
    } else if (job.remote) {
      score += 4;
    }

    const blob = `${job.title} ${job.description}`.toLowerCase();
    const underclassman = UNDERCLASS_MARKERS.filter((m) => blob.includes(m));

    if (underclassman.length) score += 15;

    return {
      ...job,
      score: Math.round(score),
      matchedKeywords: matched.slice(0, 6),
      underclassman: underclassman.length ? underclassman[0] : null,
      description: (job.description || '').slice(0, 400),
    };
  });

  return {
    jobs: scored.sort((a, b) => b.score - a.score || daysOld(a.postedAt) - daysOld(b.postedAt)),
    dropped,
  };
}

/** Tag-overlap match between the catalog and the user's major + interests. */
export function rankCertifications(catalog, query, limit = 10) {
  const wanted = [query.major, ...(query.interests || [])].filter(Boolean).map((s) => s.toLowerCase().trim());
  const wantedTokens = new Set(wanted.flatMap(tokens));

  const scored = catalog.map((cert) => {
    const tags = (cert.tags || []).map((t) => t.toLowerCase());
    const hits = [];

    for (const w of wanted) {
      // Whole-phrase tag match is the strongest signal.
      if (tags.includes(w)) hits.push({ term: w, weight: 12 });
      else if (tags.some((t) => t.includes(w) || w.includes(t))) hits.push({ term: w, weight: 7 });
    }
    // Loose token overlap picks up "data analytics" vs "analytics".
    const tagTokens = new Set(tags.flatMap(tokens));
    const loose = [...wantedTokens].filter((t) => tagTokens.has(t));

    let score = hits.reduce((s, h) => s + h.weight, 0) + loose.length * 3;
    if (cert.cost === 'free') score += 3;
    if (cert.cost === 'ref') score -= 2;

    const reasons = [...new Set(hits.map((h) => h.term))];
    const why = reasons.length
      ? `Tagged for ${reasons.slice(0, 3).join(', ')}.`
      : loose.length
        ? `Overlaps on ${[...new Set(loose)].slice(0, 3).join(', ')}.`
        : 'General-purpose credential.';

    return { ...cert, score, why };
  });

  return scored.sort((a, b) => b.score - a.score || a.hours - b.hours).slice(0, limit);
}
