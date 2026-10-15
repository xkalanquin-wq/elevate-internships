import React, { useEffect, useState } from 'react';
import { useReveal } from './useReveal';
import { api } from '../../api';

/**
 * A preview of the real catalog, for one major at a time.
 *
 * The cost label is the point of this section, so it is the most prominent
 * thing on each card after the title. "Free to audit" and "Free via campus"
 * are not the same as "Free", and collapsing them would be the one dishonest
 * move available here.
 *
 * Cards are fetched per track from the same endpoint the Ledger uses, so this
 * cannot drift from what a student actually gets when they add the track.
 */

/* Catalog items carry two cost fields and they are not interchangeable:
   `cost` is the machine key and `price` is the sentence shown to a student
   ("Free.", "Free to audit; certificate ~$49."). Style from `cost`; display
   `price`. Matching on the prose would miss on punctuation alone — "Free."
   is not "free" — and quietly paint every free course as paid.

   The keys are exactly the five the catalog uses: free, audit, paid, check
   and ref. Anything unrecognised falls to amber, so a key added later shows
   as "costs something, verify it" rather than being mislabelled free. */
const COST_STYLE = {
  free: 'text-accent',
  audit: 'text-accent',
  // "check" means the price could not be pinned down. Amber is the same
  // colour the app uses everywhere else for "confirm this yourself".
  check: 'text-amber',
  paid: 'text-amber',
  ref: 'text-faint',
};

function costClass(cost) {
  return COST_STYLE[String(cost || '').toLowerCase()] || 'text-amber';
}

export default function Certifications({ tracks = [], onAddTrack, onSeeAll }) {
  const sectionRef = useReveal();
  const ruleRef = useReveal({ step: 2 });
  const [field, setField] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Default to the first track the server actually reports rather than a
  // hardcoded 'finance', so this keeps working if the catalog is re-cut.
  useEffect(() => {
    if (!field && tracks.length) setField(tracks[0].id ?? tracks[0].field ?? tracks[0]);
  }, [tracks, field]);

  useEffect(() => {
    if (!field) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .trackItems(field)
      .then((res) => {
        if (cancelled) return;
        setItems(Array.isArray(res?.items) ? res.items : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load the catalog.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [field]);

  const shown = items.slice(0, 6);

  return (
    <section className="mx-auto max-w-page px-s4 py-s7" aria-labelledby="k-cert-title">
      <div ref={ruleRef} className="k-rule mb-s6" aria-hidden="true" />

      <div ref={sectionRef} className="k-reveal">
        <p className="mb-s3 font-mono text-xs uppercase tracking-label text-faint">
          Credentials
        </p>
        <h2 id="k-cert-title" className="font-display text-title leading-tight text-ink">
          Certifications that survive a resume screen.
        </h2>
        <p className="mt-s4 max-w-prose text-muted">
          Costs are labelled as they were when the catalog was assembled. Providers change pricing
          without notice — confirm on their page before you enrol.
        </p>

        {/* Track switcher. Real tracks from the server, not a static list. */}
        <div className="mt-s6 flex flex-wrap gap-s2" role="group" aria-label="Choose a major">
          {tracks.slice(0, 8).map((t) => {
            const id = t.id ?? t.field ?? t;
            const label = t.name ?? t.label ?? id;
            const active = id === field;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setField(id)}
                aria-pressed={active}
                className={[
                  'min-h-tap rounded-token border border-solid px-s3 font-mono text-xs uppercase tracking-label',
                  'transition-colors duration-base ease-token',
                  active
                    ? 'border-accent bg-accent-soft text-accent'
                    : // Preflight is off, so without a background of its own the button kept the
                      // browser's light grey even in dark mode, under light text.
                      'border-field bg-surface text-faint hover:text-ink',
                ].join(' ')}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-s6" aria-live="polite" aria-busy={loading}>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {loading && !error && (
          <ul className="grid list-none grid-cols-1 gap-s3 pl-0 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <li
                key={i}
                className="k-skeleton-card relative overflow-hidden rounded-lg border border-solid border-rule bg-surface"
              >
                <span
                  aria-hidden="true"
                  className="k-sheen animate-sheen absolute inset-y-0 w-1/3"
                />
              </li>
            ))}
          </ul>
        )}

        {!loading && !error && (
          <ul className="grid list-none grid-cols-1 gap-s3 pl-0 sm:grid-cols-2">
            {shown.map((item, i) => (
              <Card key={item.id} item={item} index={i} />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-s6 flex flex-wrap gap-s3">
        <button type="button" className="btn min-h-tap" onClick={() => field && onAddTrack?.(field)}>
          Add this track to my ledger
        </button>
        <button type="button" className="btn ghost min-h-tap" onClick={onSeeAll}>
          See the full ledger
        </button>
      </div>
    </section>
  );
}

function Card({ item, index }) {
  // Stagger by position. Capped so a long list does not leave the last card
  // waiting most of a second.
  const ref = useReveal({ threshold: 0.1, step: Math.min(index, 5) * 1.5 });

  // Items carry a `links` array, not a single `url`. The first entry is the
  // one to open; the rest are extras the Ledger shows and this preview does not.
  const href = item.links?.[0]?.url || null;

  return (
    <li
      ref={ref}
      className="k-reveal k-lift rounded-token border border-solid border-rule bg-surface p-s4"
    >
      <div className="flex items-baseline justify-between gap-s3">
        {/* Not uppercased: these are full sentences, some of them 80
            characters long ("~$1,500 in exam fees, plus review course…").
            Uppercase mono with letter-spacing is for short labels; run it
            over a sentence and the honest price becomes the hardest thing
            on the card to read. */}
        <span className={`font-mono text-xs leading-snug ${costClass(item.cost)}`}>
          {item.price || 'See provider'}
        </span>
        {item.hours ? (
          <span className="shrink-0 font-mono text-xs text-faint">{item.hours}h</span>
        ) : null}
      </div>

      <h3 className="mt-s2 font-display text-md leading-snug text-ink">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h3>

      {item.provider && <p className="mt-s1 text-base text-muted">{item.provider}</p>}
      {item.desc && <p className="mt-s2 text-sm leading-relaxed text-faint">{item.desc}</p>}
    </li>
  );
}
