import React, { useLayoutEffect, useRef } from 'react';
import { useInView, useReducedMotion } from './hooks.js';
import { durationMs, easing } from './tokens.js';

/**
 * Animates a list into its new order when it is filtered or sorted, instead
 * of jumping: each item that stays slides from its old place to its new one,
 * and new items fade in. (The FLIP technique: First, Last, Invert, Play.)
 *
 * Children mark themselves with data-flip-key. `watch` is a string naming
 * what decides the order — the filters and sort — so typing elsewhere does
 * not replay it. Positions are re-read after every update and kept relative
 * to the list, so a card that grew or a scroll in between does not throw the
 * slide off. Transform and opacity only.
 *
 * With `stagger`, the items also fade up one after another the first time
 * the list comes into view (the Stagger behaviour, motion.css .stagger).
 */
export default function FlipList({ as: Tag = 'div', className = '', watch = '', stagger = false, children, ...rest }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  const before = useRef(null);
  const lastWatch = useRef(watch);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const origin = list.getBoundingClientRect();
    const now = new Map();
    for (const el of list.querySelectorAll(':scope > [data-flip-key]')) {
      const r = el.getBoundingClientRect();
      now.set(el.dataset.flipKey, { el, x: r.left - origin.left, y: r.top - origin.top });
    }
    const prev = before.current;
    before.current = now;
    const changed = lastWatch.current !== watch;
    lastWatch.current = watch;
    if (!changed || !prev || reduced || typeof Element === 'undefined' || !Element.prototype.animate) return;

    const ms = durationMs('--duration-base');
    if (!ms) return;
    const curve = easing('--ease-out');
    for (const [key, { el, x, y }] of now) {
      const was = prev.get(key);
      if (!was) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: curve });
        continue;
      }
      const dx = was.x - x;
      const dy = was.y - y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms, easing: curve });
    }
  });

  return (
    <Tag
      ref={ref}
      className={(stagger ? `stagger ${className}` : className).trim() || undefined}
      data-revealed={stagger && inView ? '' : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
