import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import SeoSection from './SeoSection.jsx';
import EmptyState from './components/ui/EmptyState.jsx';
import { FlipList, Stagger } from './motion/index.js';
import HUB from '../../server/data/hub-content.json';

/**
 * /certifications and /certifications/<major>.
 *
 * The server sends these pages with their content already in the HTML so
 * search engines can read them; this component is the interactive version
 * that replaces it — the same certifications, but with Add to Ledger, the
 * starter set in one click, and a jump into the Finder for that major.
 */

const COST_LABEL = {
  free: 'Free',
  audit: 'Free to audit',
  check: 'Check your campus',
  ref: 'Reference',
  paid: 'Paid',
};

// The two filters over a major's list. `priceFrom` comes from the server:
// what earning the credential costs, or null when no single figure is known.
const COST_FILTERS = [
  { id: 'any', label: 'Any cost', test: () => true },
  { id: 'free', label: 'Free', test: (c) => c.cost === 'free' },
  { id: 'audit', label: 'Free to audit', test: (c) => c.cost === 'audit' },
  { id: 'under100', label: 'Under $100', test: (c) => c.priceFrom !== null && c.priceFrom !== undefined && c.priceFrom < 100 },
];
const HOUR_FILTERS = [
  { id: 'any', label: 'Any length', test: () => true },
  { id: '10', label: 'Under 10 hours', test: (c) => c.hours > 0 && c.hours < 10 },
  { id: '20', label: 'Under 20 hours', test: (c) => c.hours > 0 && c.hours < 20 },
  { id: '50', label: 'Under 50 hours', test: (c) => c.hours > 0 && c.hours < 50 },
];

/** Real hrefs for crawlers and middle-click; client-side navigation otherwise. */
function PageLink({ to, onNavigate, children, className }) {
  return (
    <a
      className={className}
      href={to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function Timeline({ steps, heading }) {
  if (!steps?.length) return null;
  return (
    <div className="timeline">
      {heading}
      <ol>
        {steps.map((s) => (
          <li key={s.when}>
            <div className="timeline-when">{s.when}</div>
            <div className="timeline-what">{s.what}</div>
          </li>
        ))}
      </ol>
      <div className="timeline-foot">Typical timing — firms set their own dates, so check each one.</div>
    </div>
  );
}

function MajorIndex({ onNavigate }) {
  const [majors, setMajors] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .majors()
      .then((r) => setMajors(r.majors))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="major-head">
        <div className="eyebrow">Certifications by major</div>
        <h1>Certifications for business majors</h1>
        <p>Which certifications are worth your time, what they really cost, and when your field recruits interns.</p>
      </div>
      <SeoSection block={{ paragraphs: HUB.certifications.paragraphs, image: HUB.certifications.image, steps: HUB.certifications.steps }} />
      <h2 className="major-index-heading">Pick your major</h2>
      {error && <div className="error">{error}</div>}
      {!majors && !error && <div className="empty">Loading majors…</div>}
      {majors && (
        <Stagger className="major-grid">
          {majors.map((m) => (
            <PageLink key={m.id} to={`/certifications/${m.id}`} onNavigate={onNavigate} className="site">
              <div className="site-name">{m.name}</div>
              <div className="site-note">
                {m.count} certifications · {m.note}
              </div>
            </PageLink>
          ))}
        </Stagger>
      )}
      <SeoSection block={{ faqs: HUB.certifications.faqs }} />
    </div>
  );
}

export default function MajorPage({ id, onNavigate, onAdd, onAddTrack, addedIds, startedTracks, onSearchMajor }) {
  const [major, setMajor] = useState(null);
  const [error, setError] = useState(null);
  const [costFilter, setCostFilter] = useState('any');
  const [hourFilter, setHourFilter] = useState('any');

  useEffect(() => {
    if (!id) return;
    setMajor(null);
    setError(null);
    setCostFilter('any');
    setHourFilter('any');
    api
      .major(id)
      .then(setMajor)
      .catch((e) => setError(e.status === 404 ? 'missing' : e.message));
  }, [id]);

  // Same title, description and canonical the server put in the HTML, so
  // arriving by a click inside the app reads the same as arriving from Google.
  useEffect(() => {
    if (!major) return;
    const { title, description } = major.meta;
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      try {
        const origin = new URL(canonical.getAttribute('href'), window.location.href).origin;
        canonical.setAttribute('href', `${origin}/certifications/${major.id}`);
      } catch {
        /* not worth breaking the page over */
      }
    }
  }, [major]);

  if (!id) return <MajorIndex onNavigate={onNavigate} />;

  if (error === 'missing') {
    return (
      <EmptyState
        title="No such major"
        illustration="search"
        action={
          <PageLink to="/certifications" onNavigate={onNavigate} className="btn">
            See all majors
          </PageLink>
        }
      >
        That major is not one this site covers yet.
      </EmptyState>
    );
  }
  if (error) return <div className="error">{error}</div>;
  if (!major) return <div className="empty">Loading…</div>;

  const byCost = COST_FILTERS.find((f) => f.id === costFilter) || COST_FILTERS[0];
  const byHours = HOUR_FILTERS.find((f) => f.id === hourFilter) || HOUR_FILTERS[0];
  const shown = major.certifications.filter((c) => byCost.test(c) && byHours.test(c));
  const filtered = shown.length !== major.certifications.length;
  // Each option's count is what picking it would show, given the other filter.
  const costCount = (f) => major.certifications.filter((c) => f.test(c) && byHours.test(c)).length;
  const hourCount = (f) => major.certifications.filter((c) => byCost.test(c) && f.test(c)).length;

  const starter = new Set(major.starter);
  const starterCerts = shown.filter((c) => starter.has(c.id));
  const more = shown.filter((c) => !starter.has(c.id));
  const trackStarted = startedTracks.has(major.id);

  const row = (cert) => (
    <div className="row" key={cert.id} data-flip-key={cert.id}>
      <div className="row-body">
        <div className="row-title">{cert.title}</div>
        <div className="row-provider">{cert.provider}</div>
        <div className="row-desc">{cert.desc}</div>
        <div className="row-links">
          <a
            className="link-btn"
            href={cert.url}
            target="_blank"
            rel={cert.affiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}
          >
            Open ↗
          </a>
          <button type="button" className="link-btn" onClick={() => onAdd(cert)} disabled={addedIds.has(cert.id)}>
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
  );

  return (
    <div>
      <p className="crumbs">
        <PageLink to="/certifications" onNavigate={onNavigate} className="footer-link">
          ← All majors
        </PageLink>
      </p>

      <div className="major-head">
        <div className="eyebrow">{major.certifications.length} certifications</div>
        <h1>Best certifications for {major.name.toLowerCase()} students</h1>
        <p>{major.note}</p>
        <div className="form-actions tight">
          <button type="button" className="btn small" onClick={() => onSearchMajor(major.name)}>
            Find {major.name.toLowerCase()} internships
          </button>
          <a className="btn ghost small" href={`/internships/${major.id}`}>
            {major.name} internship guide
          </a>
          {trackStarted ? (
            <span className="badge">✓ Starter set in your ledger</span>
          ) : (
            <button type="button" className="btn ghost small" onClick={() => onAddTrack(major.id)}>
              Add the starter set to Ledger
            </button>
          )}
        </div>
      </div>

      {major.guide && (
        <section className="seo-guide section">
          <p>{major.guide.intro}</p>
          {major.image && (
            <figure className="page-figure">
              <img src={major.image.src} alt={major.image.alt} width="1200" height="630" loading="lazy" decoding="async" />
            </figure>
          )}
          <h2>How to choose</h2>
          <ul className="static-list">
            {major.guide.choose.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <Timeline steps={major.timeline} heading={<h3>When {major.name.toLowerCase()} recruits</h3>} />
      </section>

      <div className="filter-bar filter-bar-two" role="group" aria-label="Filter certifications">
        <div className="field">
          <label htmlFor="c-cost">Cost</label>
          <select id="c-cost" value={costFilter} onChange={(e) => setCostFilter(e.target.value)}>
            {COST_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} ({costCount(f)})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="c-hours">Time to finish</label>
          <select id="c-hours" value={hourFilter} onChange={(e) => setHourFilter(e.target.value)}>
            {HOUR_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} ({hourCount(f)})
              </option>
            ))}
          </select>
        </div>
      </div>
      {/* Always in the page, so a screen reader hears the new count. */}
      <div aria-live="polite">
        {filtered && (
          <p className="section-note filter-summary">
            Showing {shown.length} of {major.certifications.length}.{' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setCostFilter('any');
                setHourFilter('any');
              }}
            >
              Clear filters
            </button>
          </p>
        )}
      </div>

      {shown.length === 0 && <div className="empty">No certifications for this major match both filters.</div>}

      {starterCerts.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <h3>Starter set</h3>
              <div className="section-note">Where to begin, in order</div>
            </div>
            <div className="section-count">{starterCerts.length}</div>
          </div>
          <FlipList watch={`${costFilter}|${hourFilter}`} stagger>
            {starterCerts.map(row)}
          </FlipList>
        </section>
      )}

      {more.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <h3>More for {major.name}</h3>
              <div className="section-note">Free first, then paid</div>
            </div>
            <div className="section-count">{more.length}</div>
          </div>
          <FlipList watch={`${costFilter}|${hourFilter}`} stagger>
            {more.map(row)}
          </FlipList>
        </section>
      )}

      {major.guide && <SeoSection block={{ faqs: major.guide.faqs }} />}

      {major.certifications.some((c) => c.affiliate) && (
        <p className="section-note affiliate-note">
          Some certification links are affiliate links: if you pay for a course after clicking one, this site may earn a
          commission, at no extra cost to you. It never changes which certifications are listed or how they are ranked.
        </p>
      )}
    </div>
  );
}
