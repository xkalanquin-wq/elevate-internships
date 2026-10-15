import React, { useEffect, useMemo, useRef, useState } from 'react';
import { prefersReducedMotion } from './useReveal';
import { numberToken } from '../../motion/index.js';

/**
 * A marquee of facts about this specific app.
 *
 * Every item is a real number pulled from the running server — the catalog
 * size, the number of business tracks, the boards actually queried. Nothing
 * here is aspirational copy. If a number cannot be fetched the item is
 * dropped rather than guessed at, which is why the list is built after the
 * fetch resolves instead of being hardcoded with a loading state over it.
 */
export default function Ticker({ tracks = null, catalogCount = null, sources = [] }) {
  const trackRef = useRef(null);
  const [duration, setDuration] = useState(() => numberToken('--ticker-duration', 42));

  const items = useMemo(() => {
    const out = [];
    if (catalogCount) out.push(`${catalogCount} certifications, every cost labelled`);
    if (tracks?.length) out.push(`${tracks.length} business majors covered`);
    if (sources.length) out.push(`Live from ${sources.join(' · ')}`);
    out.push('Real listings only — nothing invented');
    out.push('No scraping. Public APIs and employer boards');
    out.push('Search without an account');
    return out;
  }, [tracks, catalogCount, sources]);

  // Pace the loop by content width so a short list does not crawl and a long
  // one does not blur past: --ticker-speed pixels per second, never shorter
  // than --ticker-min seconds (tokens.css).
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const width = el.scrollWidth / 2; // one copy
    if (width > 0) setDuration(Math.max(numberToken('--ticker-min', 24), Math.round(width / numberToken('--ticker-speed', 80))));
  }, [items]);

  const reduced = prefersReducedMotion();

  const row = (dupe) =>
    items.map((text, i) => (
      <span
        key={`${dupe ? 'b' : 'a'}-${i}`}
        className="flex shrink-0 items-center gap-s5 whitespace-nowrap px-s5 font-mono text-xs uppercase tracking-label text-faint"
      >
        {text}
        <span aria-hidden="true" className="text-rule">
          /
        </span>
      </span>
    ));

  return (
    <section
      className="k-ticker overflow-hidden border-b border-solid border-rule bg-surface py-s3"
      // The scrolling copy is decorative repetition; announcing it twice, and
      // announcing it at all while it moves, is noise. The static list below
      // is what assistive tech reads. A labelled section is a landmark, so
      // the list is not stranded outside one.
      aria-label="What this app does"
      style={{ '--ticker-duration': `${duration}s` }}
    >
      <ul className="sr-only">
        {items.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>

      <div ref={trackRef} className="k-ticker-track animate-marquee" aria-hidden="true">
        {row(false)}
        {/* The second copy is what makes the wrap seamless. Under
            prefers-reduced-motion it is hidden by CSS, since nothing scrolls. */}
        {!reduced && <span className="k-ticker-dupe flex">{row(true)}</span>}
      </div>
    </section>
  );
}
