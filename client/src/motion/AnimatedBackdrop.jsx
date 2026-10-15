import React, { useRef } from 'react';
import { useInView } from './hooks.js';

/**
 * A soft, slowly drifting wash of the brand's own colors behind a page
 * heading. Decorative: hidden from assistive technology, no pointer events.
 *
 * It is one of the site's two continuous loops, so it only runs while it is
 * on screen ([data-active], toggled here) and never under reduced motion.
 * The shapes move by transform only; their soft edges come from gradients,
 * not a blur filter, so it stays cheap on phones.
 */
export default function AnimatedBackdrop({ className = '' }) {
  const ref = useRef(null);
  const onScreen = useInView(ref, { once: false, threshold: 0, rootMargin: '0px' });
  return (
    <div ref={ref} className={`backdrop ${className}`.trim()} data-active={onScreen ? '' : undefined} aria-hidden="true">
      <span className="backdrop-shape backdrop-shape-a" />
      <span className="backdrop-shape backdrop-shape-b" />
      <span className="backdrop-shape backdrop-shape-c" />
    </div>
  );
}
