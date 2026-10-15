import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Timeline } from './MajorPage.jsx';
import WeeklyEmail from './WeeklyEmail.jsx';
import { LIMITS, validateInterest, validateSearch } from './validate.js';
import { FlipList, Skeleton, durationMs } from './motion/index.js';

const PAGE_SIZE = 25;

/** Search distances, in miles. Mirrors normalizeQuery in server/index.js. */
const RADII = [10, 25, 50, 100, 150, 200];
// Fewer local internships than this, and the next distance up is offered.
const FEW_LOCAL = 20;

/** Every major this app covers — all of them business school majors. */
const MAJORS = [
  'Accounting',
  'Finance',
  'Business Analytics',
  'Marketing',
  'Management',
  'Supply Chain & Operations',
  'Human Resources',
  'Management Information Systems',
  'Economics',
  'Entrepreneurship',
  'International Business',
  'Risk Management & Insurance',
  'Hospitality & Tourism Management',
  'Real Estate',
  'Business Administration',
  'Sport Management',
  'Logistics & Transportation',
  'Healthcare Management',
  'Professional Sales',
  'Actuarial Science',
  'Financial Planning',
  'Retail Management & Merchandising',
  'Agribusiness',
];

const INTEREST_IDEAS = [
  'investment banking',
  'consulting',
  'data analytics',
  'audit',
  'digital marketing',
  'corporate finance',
  'operations',
  'sales',
  'search fund',
];

const COST_LABEL = {
  free: 'Free',
  audit: 'Free to audit',
  check: 'Check your campus',
  ref: 'Reference',
  paid: 'Paid',
};

const SEASONS = ['summer', 'fall', 'spring', 'winter'];

/**
 * Which seasons a listing names. Read from the title and the start of the
 * description — "Summer 2027", "Fall Co-op", "Winter/Spring 2027". Many
 * listings name none, so a season filter hides those rather than guessing.
 */
function seasonsOf(job) {
  const text = `${job.title} ${job.description || ''}`.toLowerCase().replace(/autumn/g, 'fall');
  return SEASONS.filter((s) => new RegExp(`\\b${s}\\b`).test(text));
}

/** Searched from the row above the results; the rest stay in the panel below. */
const ALSO_SEARCH = ['LinkedIn Jobs', 'Handshake', 'Indeed'];

// ---- Recent searches ---------------------------------------------------------
// The last few searches, kept in this browser so coming back each week is one
// click. Only what was typed into the form — no results, nothing else.

const RECENT_KEY = 'cl-recent-searches';
const RECENT_MAX = 5;

function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function rememberSearch(q) {
  const entry = { zip: q.zip, radiusMiles: q.radiusMiles, major: q.major || '', interests: q.interests || [] };
  const key = (e) => `${e.zip}|${e.radiusMiles}|${e.major.toLowerCase()}|${e.interests.join(',')}`;
  const next = [entry, ...readRecent().filter((e) => key(e) !== key(entry))].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: recent searches just are not remembered */
  }
  return next;
}

const recentLabel = (e) =>
  [e.major, ...e.interests.slice(0, 2)].filter(Boolean).join(', ') + `${e.major || e.interests.length ? ' · ' : ''}${e.zip} · ${e.radiusMiles} mi`;

/** Posted in the last three days. */
const isNew = (iso) => {
  if (!iso) return false;
  const age = Date.now() - new Date(iso).getTime();
  return age >= 0 && age < 3 * 86_400_000;
};

const STAGE_LABEL = { saved: 'Saved', applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer', closed: 'Closed' };

function posted(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function Finder({
  onAdd,
  onAddTrack,
  addedIds,
  startedTracks,
  signedIn,
  onNeedAccount,
  seedZip = '',
  seedMajor = '',
  trackedStatus = new Map(),
  onTrack,
  onOpenTracker,
  onOpenMajor,
  contactEmail = null,
}) {
  // A ZIP typed on the home page arrives here prefilled, so nobody types it
  // twice. It is deliberately not auto-submitted: runSearch drops anything
  // sent within a second of mount as bot traffic, so an auto-submit would
  // look like it worked and quietly do nothing.
  const [zip, setZip] = useState(seedZip);
  const [radiusMiles, setRadius] = useState(50);
  const [major, setMajor] = useState(seedMajor);
  const [interests, setInterests] = useState([]);
  // Interests on their way out, so the chip can shrink away before it goes.
  const [leaving, setLeaving] = useState([]);
  const removeInterest = (t) => {
    const ms = durationMs('--duration-fast');
    if (!ms) {
      setInterests((list) => list.filter((x) => x !== t));
      return;
    }
    setLeaving((l) => [...l, t]);
    setTimeout(() => {
      setInterests((list) => list.filter((x) => x !== t));
      setLeaving((l) => l.filter((x) => x !== t));
    }, ms);
  };
  const [interestDraft, setDraft] = useState('');
  const [classYear, setClassYear] = useState('');
  const term = 'any';

  // Filters over the results already on screen — no new search needed.
  const [season, setSeason] = useState('any');
  const [where, setWhere] = useState('all');
  const [sort, setSort] = useState('best');
  // Postings whose apply link was opened this visit, so the card can offer
  // "Mark as applied" while it is still fresh in mind.
  const [opened, setOpened] = useState(() => new Set());
  const [recent, setRecent] = useState(readRecent);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  // Results are shown a page at a time; up to 200 come back from one search.
  const [shown, setShown] = useState(PAGE_SIZE);
  const searching = useRef(false);

  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState([]);
  const [checking, setChecking] = useState({});

  // Errors show only after a field is touched or the form is submitted, so
  // the form does not shout at someone who is still typing their first digit.
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  // Bot traps. A human never fills a hidden field, and never submits a form
  // within a second of it rendering.
  const [honeypot, setHoneypot] = useState('');
  const mountedAt = useRef(Date.now());

  const errors = validateSearch({ zip, major, interests });
  const zipValid = !errors.zip;
  const showError = (f) => (touched[f] || submitted) && (fieldErrors[f] || errors[f]);

  const addInterest = (value) => {
    const problem = validateInterest(value, interests);
    if (problem) {
      setFieldErrors((e) => ({ ...e, interests: problem }));
      setTouched((t) => ({ ...t, interests: true }));
      return;
    }
    setInterests([...interests, value.trim().toLowerCase()]);
    setFieldErrors((e) => ({ ...e, interests: null }));
    setDraft('');
  };

  /**
   * Notes an apply click, fire-and-forget.
   *
   * The navigation is already happening when this runs, so it must not block
   * or throw: sendBeacon survives the page being left, and the fetch fallback
   * is deliberately unawaited with its rejection swallowed. Nothing here is
   * allowed to stand between a student and the application form.
   */
  function recordApply(job) {
    const body = JSON.stringify({
      jobKey: job.url,
      title: job.title,
      company: job.company,
      source: job.source,
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/applications', new Blob([body], { type: 'application/json' }));
        return;
      }
      fetch('/api/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* never interrupt the click */
    }
  }

  async function runSearch(e) {
    e.preventDefault();
    setSubmitted(true);

    if (Object.keys(errors).length > 0) {
      setError(null);
      // Send focus to the first problem so keyboard users are not stranded.
      const first = ['zip', 'major', 'interests'].find((f) => errors[f]);
      document.getElementById(first === 'interests' ? 'interests' : first)?.focus();
      return;
    }

    await doSearch({ zip, radiusMiles, major, interests, classYear, term });
  }

  async function doSearch(query) {
    // Silently succeed for bots rather than telling them what tripped.
    const tooFast = Date.now() - mountedAt.current < 1000;
    if (honeypot || tooFast) {
      setError(null);
      return;
    }

    // One search at a time, however fast the button is pressed.
    if (searching.current) return;
    searching.current = true;
    setLoading(true);
    setError(null);
    setSuggested([]);
    try {
      setResult(await api.search(query));
      setRecent(rememberSearch(query));
    } catch (err) {
      setError(err.message);
    } finally {
      searching.current = false;
      setLoading(false);
    }
  }

  // A college town can have few internships close by: offer the next
  // distance up, in one tap, rather than an empty-looking list.
  const localCount = result ? result.jobs.filter((j) => !j.remote).length : 0;
  const widerRadius = result?.place ? RADII.find((r) => r > result.query.radiusMiles) : null;
  const offerWider = Boolean(widerRadius) && localCount < FEW_LOCAL;

  function searchWider() {
    const q = result.query;
    setRadius(widerRadius);
    doSearch({ zip: q.zip, radiusMiles: widerRadius, major: q.major, interests: q.interests, classYear: q.classYear, term: q.term });
  }

  /** Re-run a recent search: fill the form in, then search. */
  function rerun(entry) {
    setZip(entry.zip);
    setRadius(entry.radiusMiles);
    setMajor(entry.major);
    setInterests(entry.interests);
    setSubmitted(false);
    doSearch({ ...entry, classYear, term });
  }

  async function runSuggest() {
    setSuggesting(true);
    setError(null);
    try {
      // This passed `location`, a variable that no longer exists after the
      // move to ZIP-only input — it threw a ReferenceError on click.
      const { suggestions } = await api.suggest({ zip, radiusMiles, major, interests, classYear, term });
      setSuggested(suggestions);
    } catch (err) {
      setError(err.message);
    } finally {
      setSuggesting(false);
    }
  }

  /** A suggested link must answer HTTP 200 before we let it into the ledger. */
  async function verifyThenAdd(cert) {
    setChecking((c) => ({ ...c, [cert.id]: 'checking' }));
    try {
      const res = await api.checkUrl(cert.url);
      if (!res.ok) {
        setChecking((c) => ({ ...c, [cert.id]: `dead (${res.status || 'no response'})` }));
        return;
      }
      setChecking((c) => ({ ...c, [cert.id]: 'ok' }));
      onAdd(cert);
    } catch (err) {
      setChecking((c) => ({ ...c, [cert.id]: err.message }));
    }
  }

  const seasonCounts = useMemo(() => {
    const counts = Object.fromEntries(SEASONS.map((s) => [s, 0]));
    for (const job of result?.jobs || []) for (const s of seasonsOf(job)) counts[s] += 1;
    return counts;
  }, [result]);

  const visibleJobs = useMemo(() => {
    let jobs = (result?.jobs || []).filter((job) => {
      if (where === 'remote' && !job.remote) return false;
      if (where === 'onsite' && job.remote) return false;
      if (season !== 'any' && !seasonsOf(job).includes(season)) return false;
      return true;
    });
    if (sort === 'newest') {
      const t = (j) => (j.postedAt ? new Date(j.postedAt).getTime() || 0 : 0);
      jobs = [...jobs].sort((a, b) => t(b) - t(a));
    } else if (sort === 'closest') {
      // Known distances first, nearest first; state-level and remote after.
      const d = (j) => (typeof j.distanceMiles === 'number' ? j.distanceMiles : j.remote ? 1e6 : 1e5);
      jobs = [...jobs].sort((a, b) => d(a) - d(b));
    }
    return jobs;
  }, [result, season, where, sort]);

  // A new search, filter or sort starts again from the first page.
  useEffect(() => setShown(PAGE_SIZE), [result, season, where, sort]);

  return (
    // Search and results side by side on a desktop once there is something to
    // show; one column, form first, everywhere else.
    <div className={result || loading ? 'finder has-results' : 'finder'}>
      <div className="finder-search">
        {recent.length > 0 && (
          <div className="recent-searches" aria-label="Recent searches">
            <span className="also-label">Recent</span>
            {recent.map((e) => (
              <button
                key={`${e.zip}-${e.radiusMiles}-${e.major}-${e.interests.join(',')}`}
                type="button"
                className="suggestion"
                onClick={() => rerun(e)}
                disabled={loading}
              >
                ↻ {recentLabel(e)}
              </button>
            ))}
          </div>
        )}

        <form className="card" onSubmit={runSearch} noValidate>
          {/* Honeypot: hidden from people and assistive tech, irresistible to
              naive bots. Anything submitted here is dropped silently. */}
          <div className="hp" aria-hidden="true">
            <label htmlFor="company-website">Do not fill this in</label>
            <input
              id="company-website"
              name="company_website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="zip">ZIP code</label>
              <input
                id="zip"
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                pattern="[0-9]{5}"
                maxLength={5}
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/[^0-9]/g, '').slice(0, LIMITS.zip))}
                onBlur={() => setTouched((t) => ({ ...t, zip: true }))}
                placeholder="06010"
                required
                aria-describedby="zip-help"
                aria-invalid={Boolean(showError('zip'))}
              />
              <span id="zip-help" className={showError('zip') ? 'field-error' : 'field-help'} role={showError('zip') ? 'alert' : undefined}>
                {showError('zip')
                  ? errors.zip
                  : zipValid
                    ? '✓ looks good'
                    : '5 digits — distances are measured from here'}
              </span>
            </div>

            <div className="field">
              <label htmlFor="rad">Search radius</label>
              <select id="rad" value={radiusMiles} onChange={(e) => setRadius(Number(e.target.value))}>
                {RADII.map((m) => (
                  <option key={m} value={m}>
                    Within {m} miles
                  </option>
                ))}
              </select>
            </div>

            <div className="field full">
              <label htmlFor="major">Major</label>
              <input
                id="major"
                type="text"
                list="major-list"
                value={major}
                maxLength={LIMITS.major}
                onChange={(e) => setMajor(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, major: true }))}
                placeholder="Business Analytics"
                /* Only reference the hint when it is actually rendered. Unlike
                   the ZIP field, whose span is always present, this one mounts
                   only on an error — so pointing at it unconditionally left a
                   dangling aria-describedby, and a screen reader announced a
                   description that did not exist. */
                aria-describedby={showError('major') ? 'major-help' : undefined}
                aria-invalid={Boolean(showError('major'))}
              />
              {showError('major') && (
                <span id="major-help" className="field-error" role="alert">
                  {errors.major}
                </span>
              )}
              <datalist id="major-list">
                {MAJORS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <div className="suggestions">
                {MAJORS.slice(0, 6).map((m) => (
                  <button key={m} type="button" className="suggestion" onClick={() => setMajor(m)}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="field full">
              <label htmlFor="interests">Interests — press Enter to add</label>
              <input
                id="interests"
                type="text"
                value={interestDraft}
                maxLength={LIMITS.interest}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (fieldErrors.interests) setFieldErrors((x) => ({ ...x, interests: null }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addInterest(interestDraft);
                  }
                }}
                placeholder="data analytics"
                aria-describedby="interests-help"
                aria-invalid={Boolean(showError('interests'))}
              />
              <span
                id="interests-help"
                className={showError('interests') ? 'field-error' : 'field-help'}
                role={showError('interests') ? 'alert' : undefined}
              >
                {showError('interests') || `${interests.length} of ${LIMITS.interests} added`}
              </span>
              {interests.length > 0 && (
                <div className="chips">
                  {interests.map((t) => (
                    <span className={leaving.includes(t) ? 'chip leaving' : 'chip'} key={t}>
                      {t}
                      <button type="button" onClick={() => removeInterest(t)} aria-label={`Remove ${t}`}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="suggestions">
                {INTEREST_IDEAS.filter((i) => !interests.includes(i)).map((i) => (
                  <button key={i} type="button" className="suggestion" onClick={() => addInterest(i)}>
                    + {i}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label htmlFor="year">Class year — optional</label>
              <select id="year" value={classYear} onChange={(e) => setClassYear(e.target.value)}>
                <option value="">Any</option>
                {['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

          </div>

          <div className="form-actions">
            <button type="submit" className="btn" disabled={loading} aria-busy={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
            {result?.suggestEnabled && (
              <button type="button" className="btn ghost" onClick={runSuggest} disabled={suggesting}>
                {suggesting ? 'Asking Claude…' : 'Suggest more'}
              </button>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </form>
      </div>

      <div className="finder-results">
        {loading && (
          <section className="section" aria-busy="true" aria-label="Searching">
            <div className="section-head">
              <div>
                <h2>Internships</h2>
                <div className="section-note">Checking every job source…</div>
              </div>
            </div>
            <Skeleton count={4} variant="job" />
          </section>
        )}

        {result?.track && (
          <div className="track-card">
            <div className="eyebrow">Starter track detected</div>
            <h2>{result.track.name}</h2>
            <p>{result.track.note}</p>
            {result.track.timeline?.length > 0 && (
              <details className="timeline-toggle">
                <summary>When does {result.track.name.toLowerCase()} recruit?</summary>
                <Timeline steps={result.track.timeline} />
              </details>
            )}
            <div className="form-actions tight">
              {startedTracks.has(result.track.id) ? (
                <span className="badge">✓ {result.track.items} items already in your ledger</span>
              ) : (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => onAddTrack(result.track.id)}
                >
                  Add all {result.track.items} to Ledger
                </button>
              )}
              <a
                className="link-btn"
                href={`/certifications/${result.track.id}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || !onOpenMajor) return;
                  e.preventDefault();
                  onOpenMajor(result.track.id);
                }}
              >
                Every {result.track.name} certification →
              </a>
              <a className="link-btn" href={`/internships/${result.track.id}`}>
                {result.track.name} internship guide →
              </a>
            </div>
          </div>
        )}

        {result && !loading && (
          <>
            <section className="section">
              <div className="section-head">
                <div>
                  <h2>Internships</h2>
                  <div className="section-note">
                    {result.place
                      ? `Within ${result.query.radiusMiles} miles of ${result.place.city}, ${result.place.state} ${result.place.zip}, plus remote`
                      : 'Ranked against your major and interests'}
                  </div>
                </div>
                <div className="section-count">
                  {visibleJobs.length === result.jobs.length
                    ? `${result.jobs.length} found`
                    : `${visibleJobs.length} of ${result.jobs.length}`}
                </div>
              </div>

              {offerWider && (
                <div className="notice" role="status">
                  <span>
                    {localCount === 0 ? 'No' : `Only ${localCount}`} internship{localCount === 1 ? '' : 's'} found within{' '}
                    {result.query.radiusMiles} miles of {result.place.city}.
                  </span>
                  <button type="button" className="btn ghost small" onClick={searchWider} disabled={loading}>
                    Search within {widerRadius} miles
                  </button>
                </div>
              )}

              {result.jobs.length > 0 && (
                <WeeklyEmail
                  signedIn={signedIn}
                  onNeedAccount={onNeedAccount}
                  searchKey={`${result.place?.zip}|${result.query.major}|${result.query.radiusMiles}`}
                />
              )}

              {/* The big boards cannot be searched from here (LinkedIn and
                  Handshake have no open API), so the next best thing sits where
                  it will be seen: the same search, prefilled, one click away. */}
              {result.deepLinks.some((l) => ALSO_SEARCH.includes(l.name)) && (
                <div className="also-search">
                  <span className="also-label">Also search</span>
                  {ALSO_SEARCH.map((name) => result.deepLinks.find((l) => l.name === name))
                    .filter(Boolean)
                    .map((l) => (
                      <a
                        key={l.name}
                        className="link-btn also"
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={l.note}
                      >
                        {l.name.replace(/ Jobs$/, '')} ↗
                      </a>
                    ))}
                  <button
                    type="button"
                    className="footer-link"
                    onClick={() => {
                      const more = document.getElementById('more-sites');
                      if (more) {
                        more.open = true;
                        more.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                  >
                    {result.deepLinks.length - ALSO_SEARCH.length} more sites ↓
                  </button>
                  <span className="also-note">
                    Your keywords and radius, prefilled. Found one there? Add it under Applications to track it here.
                  </span>
                </div>
              )}

              {result.jobs.length > 0 && (
                <div className="filter-bar" role="group" aria-label="Filter and sort internships">
                  <div className="field">
                    <label htmlFor="f-season">Season</label>
                    <select id="f-season" value={season} onChange={(e) => setSeason(e.target.value)}>
                      <option value="any">Any season</option>
                      {SEASONS.map((s) => (
                        <option key={s} value={s}>
                          {s[0].toUpperCase() + s.slice(1)} ({seasonCounts[s]})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="f-where">Where</label>
                    <select id="f-where" value={where} onChange={(e) => setWhere(e.target.value)}>
                      <option value="all">In person and remote</option>
                      <option value="onsite">In person only</option>
                      <option value="remote">Remote only</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="f-sort">Sort</label>
                    <select id="f-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                      <option value="best">Best match</option>
                      <option value="newest">Newest first</option>
                      <option value="closest">Closest first</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Employer-paid listings: always labeled, always above the
                  ranked results and never mixed into them. */}
              {(result.sponsored || []).map((job) => (
                <article className="job sponsored-job" key={job.id} aria-label={`Sponsored: ${job.title}`}>
                  <div className="job-top">
                    <div className="job-head">
                      <div className="job-title">{job.title}</div>
                      <div className="job-company">
                        {job.company} · {job.location}
                      </div>
                    </div>
                    <div className="job-badges">
                      <span className="badge sponsored">Sponsored</span>
                      {job.remote && <span className="badge">remote</span>}
                    </div>
                  </div>
                  <div className="row-meta">
                    {job.distanceMiles !== null && job.distanceMiles !== undefined && (
                      <span className="dist">{job.distanceMiles} mi away</span>
                    )}
                    <span>Paid placement from the employer</span>
                  </div>
                  <div className="row-links">
                    <a className="link-btn" href={job.applyUrl} target="_blank" rel="sponsored noopener noreferrer">
                      Apply ↗
                    </a>
                    {trackedStatus.has(job.url) ? (
                      <button type="button" className="link-btn saved" onClick={onOpenTracker}>
                        ✓ {STAGE_LABEL[trackedStatus.get(job.url)] || 'Saved'}
                      </button>
                    ) : (
                      <button type="button" className="link-btn" onClick={() => onTrack({ ...job, source: 'Company website' })}>
                        ☆ Save
                      </button>
                    )}
                  </div>
                </article>
              ))}

              {/* Filters and sort reorder the list: FlipList glides each card to
                  its new place instead of jumping. */}
              <FlipList className="job-list" watch={`${season}|${where}|${sort}`} stagger>
                {visibleJobs.slice(0, shown).map((job) => (
                  <article className="job" key={job.id} data-flip-key={job.id}>
                    <div className="job-top">
                      <div className="job-head">
                        <div className="job-title">{job.title}</div>
                        <div className="job-company">
                          {job.company} · {job.location}
                        </div>
                      </div>
                      <div className="job-badges">
                        {isNew(job.publishedAt || job.postedAt) && <span className="badge new">new</span>}
                        {job.underclassman && <span className="badge underclass">{job.underclassman}</span>}
                        {job.remote && <span className="badge">remote</span>}
                        <span className="badge">{job.source}</span>
                      </div>
                    </div>
                    {job.description && <div className="job-desc">{job.description.slice(0, 220)}…</div>}
                    <div className="row-meta">
                      {job.distanceMiles !== null && job.distanceMiles !== undefined && (
                        <span className="dist">{job.distanceMiles} mi away</span>
                      )}
                      {posted(job.postedAt) && <span>posted {posted(job.postedAt)}</span>}
                      {job.matchedKeywords?.length > 0 && <span>matches: {job.matchedKeywords.join(', ')}</span>}
                      {job.alsoOn?.length > 0 && <span>also on {job.alsoOn.join(', ')}</span>}
                    </div>
                    <div className="row-links">
                      {/* The click is recorded in the background; the link is a
                          plain anchor and opens exactly as it would otherwise, so
                          a failed or blocked request never costs you the apply. */}
                      <a
                        className="link-btn"
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          recordApply(job);
                          setOpened((s) => new Set(s).add(job.url));
                        }}
                      >
                        Apply ↗
                      </a>
                      {trackedStatus.has(job.url) ? (
                        <button type="button" className="link-btn saved" onClick={onOpenTracker}>
                          ✓ {STAGE_LABEL[trackedStatus.get(job.url)] || 'Saved'}
                        </button>
                      ) : (
                        <button type="button" className="link-btn" onClick={() => onTrack(job)}>
                          ☆ Save
                        </button>
                      )}
                      {contactEmail && (
                        <a
                          className="link-btn quiet"
                          href={`mailto:${contactEmail}?subject=${encodeURIComponent('Listing problem')}&body=${encodeURIComponent(
                            `${job.title} — ${job.company}\n${job.url}\n\nWhat is wrong (expired, wrong location, not an internship…):\n`,
                          )}`}
                          aria-label={`Report a problem with ${job.title}`}
                        >
                          Report
                        </a>
                      )}
                      {opened.has(job.url) && ['saved', undefined].includes(trackedStatus.get(job.url)) && (
                        <button type="button" className="link-btn primary" onClick={() => onTrack(job, 'applied')}>
                          Mark as applied
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </FlipList>

              {visibleJobs.length > shown && (
                <div className="form-actions show-more">
                  <button type="button" className="btn ghost small" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                    Show {Math.min(PAGE_SIZE, visibleJobs.length - shown)} more
                  </button>
                  <span className="reminder-note">
                    Showing {shown} of {visibleJobs.length}
                  </span>
                </div>
              )}

              {result.jobs.length === 0 && (
                <div className="empty">No live listings came back — use the direct searches below.</div>
              )}
              {result.jobs.length > 0 && visibleJobs.length === 0 && (
                <div className="empty">
                  Nothing matches those filters.{' '}
                  <button
                    type="button"
                    className="footer-link"
                    onClick={() => {
                      setSeason('any');
                      setWhere('all');
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}

              {/* Adzuna's API terms ask for visible credit wherever its listings appear. */}
              {result.jobs.some((j) => j.source === 'Adzuna' || j.alsoOn?.includes('Adzuna')) && (
                <div className="source-credit">
                  Jobs by{' '}
                  <a href="https://www.adzuna.com" target="_blank" rel="noopener noreferrer">
                    Adzuna
                  </a>
                </div>
              )}

              {result.notes.length > 0 && (
                <div className="notes">
                  {result.notes.map((n, i) => (
                    <div key={i}>
                      {n.source}: {n.message}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="section">
              <div className="section-head">
                <div>
                  <h2>Free certifications</h2>
                  <div className="section-note">
                    {result.field ? `Matched to ${result.field.name}` : 'Matched to your major and interests'}
                  </div>
                </div>
                <div className="section-count">{result.certifications.length} shown</div>
              </div>
              {result.certifications.some((c) => c.affiliate) && (
                <p className="section-note affiliate-note">
                  Some certification links are affiliate links: if you pay for a course after clicking one, this site may
                  earn a commission, at no extra cost to you. It never changes which certifications are listed or how they
                  are ranked.
                </p>
              )}

              {result.certifications.map((cert) => (
                <div className="row" key={cert.id}>
                  <div className="row-body">
                    <div className="row-title">{cert.title}</div>
                    <div className="row-provider">{cert.provider}</div>
                    <div className="row-desc">{cert.desc}</div>
                    <div className="why">{cert.why}</div>
                    <div className="row-links">
                      <a
                        className="link-btn"
                        href={cert.url}
                        target="_blank"
                        rel={cert.affiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}
                      >
                        Open ↗
                      </a>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => onAdd(cert)}
                        disabled={addedIds.has(cert.id)}
                      >
                        {addedIds.has(cert.id) ? '✓ In ledger' : '+ Add to Ledger'}
                      </button>
                    </div>
                    <div className="row-meta">
                      <span className={`tag ${cert.cost}`}>{COST_LABEL[cert.cost]}</span>
                      {cert.hours > 0 && <span>{cert.hours}h</span>}
                    </div>
                    {cert.price && <div className="price-note">{cert.price}</div>}
                  </div>
                </div>
              ))}
            </section>

            {/* A fallback, so it sits below the results it backs up, collapsed by
                default when live listings came back. */}
            <details className="section fallback" id="more-sites" open={result.jobs.length === 0}>
              <summary>
                <div>
                  <div className="fallback-title">Search these directly</div>
                  <div className="fallback-sub">
                    {result.deepLinks.length} sites with no open API — your search prefilled wherever the site allows it
                  </div>
                </div>
                <div className="chev">
                  <span />
                </div>
              </summary>

              {[...new Set(result.deepLinks.map((l) => l.group))].map((group) => (
                <div className="site-group" key={group}>
                  <div className="eyebrow">{group}</div>
                  <div className="sites">
                    {result.deepLinks
                      .filter((l) => l.group === group)
                      .map((l) => (
                        <a className="site" key={l.name} href={l.url} target="_blank" rel="noopener noreferrer">
                          <div className="site-name">{l.name} ↗</div>
                          <div className="site-note">{l.note}</div>
                        </a>
                      ))}
                  </div>
                </div>
              ))}
            </details>

            {suggested.length > 0 && (
              <section className="section">
                <div className="section-head">
                  <div>
                    <h2>Suggested by Claude</h2>
                    <div className="section-note">Unverified — the link is checked before it can be added</div>
                  </div>
                </div>
                {suggested.map((cert) => (
                  <div className="row" key={cert.id}>
                    <div className="row-body">
                      <div className="row-title">{cert.title}</div>
                      <div className="row-provider">{cert.provider}</div>
                      <div className="row-desc">{cert.desc}</div>
                      {cert.why && <div className="why">{cert.why}</div>}
                      <div className="row-links">
                        <a className="link-btn" href={cert.url} target="_blank" rel="noopener noreferrer">
                          Open ↗
                        </a>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => verifyThenAdd(cert)}
                          disabled={checking[cert.id] === 'checking' || addedIds.has(cert.id)}
                        >
                          {addedIds.has(cert.id)
                            ? '✓ In ledger'
                            : checking[cert.id] === 'checking'
                              ? 'Checking link…'
                              : '+ Verify and add'}
                        </button>
                      </div>
                      <div className="row-meta">
                        <span className="badge underclass">suggested, verify link</span>
                        <span className={`tag ${cert.cost}`}>{COST_LABEL[cert.cost]}</span>
                        {cert.hours > 0 && <span>{cert.hours}h</span>}
                        {checking[cert.id] && checking[cert.id] !== 'ok' && checking[cert.id] !== 'checking' && (
                          <span className="link-warning">link {checking[cert.id]}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
