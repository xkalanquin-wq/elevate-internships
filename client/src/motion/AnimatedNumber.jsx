import React, { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from './hooks.js';
import { durationMs } from './tokens.js';

/**
 * A number that counts up to its value when it comes into view, and counts
 * between values when it changes. It runs for --duration-slow with an
 * ease-out, so the final figure is never more than that away.
 *
 * Screen readers get the real value straight away; the moving digits are
 * hidden from them. With reduced motion the value simply appears.
 */
export default function AnimatedNumber({ value, format = (n) => String(n), className = '' }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(reduced ? value : 0);

  useEffect(() => {
    if (!inView) return undefined;
    const target = Number(value) || 0;
    const ms = reduced ? 0 : durationMs('--duration-slow');
    if (!ms || from.current === target) {
      from.current = target;
      setShown(target);
      return undefined;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - p) ** 3;
      setShown(a + (target - a) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    // Browsers pause animation frames in a hidden tab; make sure the final
    // figure lands regardless.
    const land = setTimeout(() => {
      cancelAnimationFrame(raf);
      from.current = target;
      setShown(target);
    }, ms + durationMs('--duration-fast'));
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(land);
      from.current = target;
    };
  }, [value, inView, reduced]);

  return (
    <span ref={ref} className={`animated-number ${className}`.trim()}>
      <span aria-hidden="true">{format(Math.round(shown))}</span>
      <span className="sr-only">{format(Number(value) || 0)}</span>
    </span>
  );
}
