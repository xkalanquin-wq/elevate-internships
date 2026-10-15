import React from 'react';

/**
 * Loading placeholders shaped like the content that replaces them, so the
 * page does not jump when results arrive. `variant="job"` is a job card:
 * title, company line, description. A gentle shimmer runs only while they
 * are shown, and not at all under reduced motion.
 *
 * Silent to assistive technology: the section around it says what is
 * loading (aria-busy and a label).
 */
export default function Skeleton({ count = 4, variant = 'job' }) {
  return (
    <div className={`skeleton skeleton-${variant}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-row" key={i}>
          <div className="skel skel-title" />
          <div className="skel skel-meta" />
          <div className="skel skel-line" />
        </div>
      ))}
    </div>
  );
}
