import React, { useRef } from 'react';
import { useInView } from './hooks.js';

/**
 * Small line drawings for empty and error states, in the palette's accent
 * colors, with a gentle float. Decorative (the card's heading and text say
 * everything), so hidden from assistive technology.
 *
 * The float is one of the site's two continuous loops: it runs only while
 * the drawing is on screen and never under reduced motion.
 */
const DRAWINGS = {
  // A checklist with one item ticked: the Ledger.
  ledger: (
    <>
      <rect className="ill-fill" x="18" y="10" width="60" height="76" rx="8" />
      <path className="ill-line" d="M32 32h30M32 48h30M32 64h20" />
      <path className="ill-accent" d="m22 30 3 3 5-6M22 46l3 3 5-6" />
      <circle className="ill-dot" cx="25" cy="64" r="2.5" />
    </>
  ),
  // A briefcase with a plus: Applications.
  applications: (
    <>
      <rect className="ill-fill" x="14" y="30" width="68" height="50" rx="8" />
      <path className="ill-line" d="M36 30v-6a5 5 0 0 1 5-5h14a5 5 0 0 1 5 5v6M14 52h68" />
      <path className="ill-accent" d="M48 58v14M41 65h14" />
    </>
  ),
  // Three rising bars: Stats.
  stats: (
    <>
      <rect className="ill-fill" x="12" y="14" width="72" height="68" rx="8" />
      <path className="ill-line" d="M28 70V52M48 70V40M68 70V28" />
      <path className="ill-accent" d="m26 44 20-12 22-8" />
    </>
  ),
  // A magnifier over a map pin: a search with nothing to show.
  search: (
    <>
      <circle className="ill-fill" cx="42" cy="42" r="26" />
      <path className="ill-line" d="m61 61 15 15" />
      <path className="ill-accent" d="M42 54s-10-9-10-16a10 10 0 0 1 20 0c0 7-10 16-10 16Z" />
      <circle className="ill-dot" cx="42" cy="38" r="3" />
    </>
  ),
  // A person with a key: signing in.
  account: (
    <>
      <circle className="ill-fill" cx="48" cy="48" r="36" />
      <circle className="ill-line" cx="48" cy="38" r="11" />
      <path className="ill-line" d="M28 72c2-11 10-17 20-17s18 6 20 17" />
    </>
  ),
  // A page with a gentle question mark: not found, or something went wrong.
  error: (
    <>
      <rect className="ill-fill" x="20" y="10" width="56" height="76" rx="8" />
      <path className="ill-accent" d="M40 38a8 8 0 1 1 11 7.4c-2 .9-3 2.4-3 4.6v3" />
      <circle className="ill-dot" cx="48" cy="62" r="2.5" />
    </>
  ),
};

export default function Illustration({ name }) {
  const ref = useRef(null);
  const onScreen = useInView(ref, { once: false, threshold: 0, rootMargin: '0px' });
  const drawing = DRAWINGS[name];
  if (!drawing) return null;
  return (
    <div ref={ref} className="illustration" data-active={onScreen ? '' : undefined} aria-hidden="true">
      <svg viewBox="0 0 96 96" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        {drawing}
      </svg>
    </div>
  );
}
