import React, { useRef } from 'react';
import { useInView } from './hooks.js';

/**
 * Fades its content up once, the first time it scrolls into view.
 *
 * The hidden starting state only applies once the app's script has marked
 * the page ready (html.motion-ready) and never under reduced motion, so
 * server-rendered and no-JavaScript pages are always readable.
 */
export function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  return (
    <Tag ref={ref} className={`reveal ${className}`.trim()} data-revealed={inView ? '' : undefined} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Like Reveal, for a list: the children fade up one after another. The step
 * comes from --stagger and stops growing after --stagger-max items (set by
 * position in motion.css), so a long list never waits on its last row.
 */
export function Stagger({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  return (
    <Tag ref={ref} className={`stagger ${className}`.trim()} data-revealed={inView ? '' : undefined} {...rest}>
      {children}
    </Tag>
  );
}
