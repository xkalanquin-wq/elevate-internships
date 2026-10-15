import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * The marker that slides to the active section tab.
 *
 * Rendered inside the tab row (containerRef). It measures the active tab and
 * places itself with transform only: on phones a pill behind the tab's icon,
 * on wider screens a short bar under the tab, sized to it (motion.css). It
 * re-measures when the row changes size, so rotating a phone or resizing a
 * window keeps it in place. Nothing is drawn until it has a position, and the
 * first placement does not slide in from the corner.
 *
 * Decorative: the selected tab is already announced by aria-selected.
 */
export default function TabIndicator({ containerRef, activeId }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const row = containerRef.current;
    const mark = ref.current;
    if (!row || !mark || !activeId) return undefined;

    const place = () => {
      const tab = row.querySelector(`#tab-${activeId}`);
      if (!tab) return;
      const box = row.getBoundingClientRect();
      const wide = window.matchMedia('(min-width: 768px)').matches;
      const icon = tab.querySelector('.tab-icon');
      if (wide) {
        const t = tab.getBoundingClientRect();
        mark.style.setProperty('--ix', `${t.left - box.left}px`);
        mark.style.setProperty('--iy', `${t.bottom - box.top - mark.offsetHeight}px`);
        mark.style.setProperty('--iw', String(t.width));
      } else if (icon) {
        const r = icon.getBoundingClientRect();
        mark.style.setProperty('--ix', `${r.left - box.left + (r.width - mark.offsetWidth) / 2}px`);
        mark.style.setProperty('--iy', `${r.top - box.top + (r.height - mark.offsetHeight) / 2}px`);
        mark.style.removeProperty('--iw');
      }
    };

    place();
    const settle = requestAnimationFrame(() => setReady(true));
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    ro?.observe(row);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(settle);
      ro?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [containerRef, activeId]);

  if (!activeId) return null;
  return <span ref={ref} className={ready ? 'tab-indicator ready' : 'tab-indicator'} aria-hidden="true" />;
}
