import { useEffect, useRef } from 'react';

/**
 * Marks an element [data-revealed] the first time it enters the viewport.
 *
 * One observer per element is wasteful at scale but this page has a handful of
 * sections, and the alternative — a shared observer with a registry — is more
 * machinery than the problem deserves.
 *
 * Reveals are one-way. Re-hiding a section when it scrolls back out makes the
 * page feel unstable when someone scrolls up to re-read something.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.threshold]  fraction visible before revealing
 * @param {string}  [opts.rootMargin] shifts the trigger line
 * @param {number}  [opts.step]       how many --k-stagger steps to wait, written
 *                                     to --k-step (motion.css tokens), so every
 *                                     delay scales with the motion switch
 */
export function useReveal({ threshold = 0.15, rootMargin = '0px 0px -8% 0px', step = 0 } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (step) el.style.setProperty('--k-step', String(step));

    // No observer (or the element is already past): show it and stop. Never
    // leave content stuck at opacity 0 because a browser API was missing.
    if (typeof IntersectionObserver === 'undefined') {
      el.setAttribute('data-revealed', '');
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-revealed', '');
          io.unobserve(entry.target);
        }
      },
      { threshold, rootMargin },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [threshold, rootMargin, step]);

  return ref;
}

/**
 * Splits a line into word-sized masks for the rising headline.
 *
 * The whole line is given to assistive tech as one string via aria-label on
 * the caller's element, and each fragment is aria-hidden, so the sentence is
 * announced normally rather than word by word.
 */
export function splitWords(text) {
  return String(text).split(/(\s+)/).filter(Boolean);
}

/**
 * True when the visitor has asked for less motion.
 *
 * The CSS already handles this on its own; this is for the cases CSS cannot
 * reach — deciding not to start a rAF loop, or not to duplicate ticker
 * content that will never scroll.
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
