import React from 'react';
import { useReveal } from './useReveal';

/**
 * Where the listings come from, stated plainly.
 *
 * This section exists because "we search 40+ job boards" is the standard lie
 * of this category. The honest version is more useful: a handful of public
 * APIs are queried directly, employer boards are read through their own
 * public endpoints, and everything else is a prefilled deep link that hands
 * you to the site with your search already typed in. Nothing is scraped.
 */

const QUERIED = [
  { name: 'The Muse', note: 'Public API, no key needed' },
  { name: 'Remotive', note: 'Remote-first roles' },
  { name: 'Jobicy', note: 'Remote listings' },
  { name: 'Greenhouse', note: 'Employer boards, read directly' },
  { name: 'Lever', note: 'Employer boards, read directly' },
  { name: 'Ashby', note: 'Employer boards, read directly' },
  { name: 'SmartRecruiters', note: 'Employer boards, read directly' },
  { name: 'Simplify', note: 'Daily-updated internship list' },
  { name: 'Himalayas', note: 'Remote internships' },
  { name: 'Adzuna', note: 'If you add a free API key' },
  { name: 'USAJOBS', note: 'If you add a free API key' },
];

const HANDOFF = [
  'LinkedIn',
  'Handshake',
  'Indeed',
  'SimplyHired',
  'USAJOBS',
  'WayUp',
  'RippleMatch',
  'Chegg Internships',
  'Forage',
];

export default function Internships({ onSearch }) {
  const headRef = useReveal();
  const ruleRef = useReveal({ step: 2 });
  const listRef = useReveal({ step: 3 });
  const handoffRef = useReveal({ step: 4 });

  return (
    <section className="mx-auto max-w-page px-s4 py-s7" aria-labelledby="k-jobs-title">
      <div ref={ruleRef} className="k-rule mb-s6" aria-hidden="true" />

      <div ref={headRef} className="k-reveal">
        <p className="mb-s3 font-mono text-xs uppercase tracking-label text-faint">
          Listings
        </p>
        <h2 id="k-jobs-title" className="font-display text-title leading-tight text-ink">
          Real postings, or nothing at all.
        </h2>
        <p className="mt-s4 max-w-prose text-muted">
          Results come from public APIs and employer application boards. Postings older than nine
          months and roles outside the United States are filtered out. No site is scraped, and no
          listing is invented to fill space — a thin result means the boards were thin today.
        </p>
      </div>

      <div ref={listRef} className="k-reveal mt-s6">
        <h3 className="font-mono text-xs uppercase tracking-label text-faint">
          Queried directly
        </h3>
        {/* list-none/pl-0: preflight is off, so <ul> keeps the browser's
            default disc markers and indent. */}
        <ul className="mt-s3 grid list-none grid-cols-1 gap-s2 pl-0 sm:grid-cols-2">
          {QUERIED.map((s, i) => (
            <li
              key={s.name}
              className="k-lift flex items-baseline justify-between gap-s3 rounded-token border border-solid border-rule bg-surface px-s4 py-s3"
              style={{ '--k-step': Math.min(i, 6) }}
            >
              <span className="text-ink">{s.name}</span>
              <span className="text-right font-mono text-xs text-faint">{s.note}</span>
            </li>
          ))}
        </ul>
      </div>

      <div ref={handoffRef} className="k-reveal mt-s6">
        <h3 className="font-mono text-xs uppercase tracking-label text-faint">
          Handed off with your search prefilled
        </h3>
        <p className="mt-s2 max-w-prose text-base text-muted">
          These sites do not offer an API for this. Rather than scrape them, the app builds the
          search URL and opens it — you land on their results page, signed in as yourself.
        </p>
        <ul className="mt-s3 flex list-none flex-wrap gap-s2 pl-0">
          {HANDOFF.map((name) => (
            <li
              key={name}
              className="rounded-token border border-solid border-rule px-s3 py-s2 font-mono text-xs uppercase tracking-label text-faint"
            >
              {name}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-s6">
        <button type="button" className="btn min-h-tap" onClick={onSearch}>
          Search internships near me
        </button>
      </div>
    </section>
  );
}
