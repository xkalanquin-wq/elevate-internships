import { useEffect, useRef, useState } from 'react';
import { durationMs, reducedMotion } from './tokens.js';

/** Follows the reduced-motion setting live, so turning it on mid-visit takes effect at once. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(reducedMotion);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(reducedMotion());
    mq?.addEventListener?.('change', update);
    const attr = new MutationObserver(update);
    attr.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    return () => {
      mq?.removeEventListener?.('change', update);
      attr.disconnect();
    };
  }, []);
  return reduced;
}

/**
 * True once the element has come into view (once: true, the default), or
 * whenever it is in view (once: false — used to pause loops off screen).
 * Without IntersectionObserver it reports visible, so nothing stays hidden.
 *
 * It fires as soon as any part of the element crosses a line just above the
 * bottom of the screen (threshold 0). A fraction would never be reached by a
 * list taller than several screens.
 */
export function useInView(ref, { once = true, threshold = 0, rootMargin = '0px 0px -8% 0px' } = {}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, threshold, rootMargin]);
  return inView;
}

/**
 * Keeps something mounted long enough to animate out.
 *
 * Returns { mounted, state }: state is "open" while shown and "closing" for
 * one duration token after `open` turns false, then it unmounts. CSS keys its
 * enter and exit animations off [data-state]. With reduced motion the
 * duration is 0 and it unmounts at once.
 */
export function usePresence(open, durationToken = '--duration-base') {
  const [state, setState] = useState(open ? 'open' : 'closed');
  // Read, not watched: only a change of `open` starts a transition.
  const shown = useRef(open);
  useEffect(() => {
    if (open) {
      shown.current = true;
      setState('open');
      return undefined;
    }
    if (!shown.current) return undefined;
    setState('closing');
    const t = setTimeout(() => {
      shown.current = false;
      setState('closed');
    }, durationMs(durationToken));
    return () => clearTimeout(t);
  }, [open, durationToken]);
  return { mounted: state !== 'closed', state };
}

/**
 * True for one celebration's length when `value` turns from false to true —
 * a certification being marked complete. Not on first render, so a list that
 * loads already complete does not celebrate.
 */
export function useCelebrate(value, durationToken = '--duration-celebrate') {
  const [on, setOn] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    const was = prev.current;
    prev.current = value;
    if (!value || was) return undefined;
    const ms = durationMs(durationToken);
    if (!ms) return undefined;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [value, durationToken]);
  return on;
}
