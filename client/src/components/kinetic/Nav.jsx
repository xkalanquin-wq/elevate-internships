import React, { useEffect, useRef, useState } from 'react';

const TABS = [
  { id: 'finder', label: 'Finder' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'stats', label: 'Stats' },
];

/**
 * The kinetic nav. Same three destinations as the app's own tab bar, same
 * state — this is a different presentation of App's `tab`/`setTab`, not a
 * second navigation system.
 *
 * Two pieces of motion, both tied to something real:
 *   - the bar condenses once you have scrolled past the hero, so the headline
 *     is not competing with a sticky bar on first paint;
 *   - the active indicator slides between items rather than cutting, which is
 *     what makes it read as one bar with a moving marker instead of three
 *     separate highlights.
 *
 * The tabs keep the ARIA tabs pattern the rest of the app uses: one tab stop
 * for the group, arrow keys to move within it.
 */
export default function Nav({
  tab = 'finder',
  onTab,
  user = null,
  onSignIn,
  onSignOut,
  theme = 'system',
  onTheme,
}) {
  const [condensed, setCondensed] = useState(false);
  const listRef = useRef(null);
  const [indicator, setIndicator] = useState(null);

  // Condense on scroll. A threshold with hysteresis (72 down, 24 up) stops the
  // bar flickering when someone parks the page right on the boundary.
  useEffect(() => {
    let frame = 0;
    function onScroll() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setCondensed((was) => (was ? window.scrollY > 24 : window.scrollY > 72));
      });
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Measure the active tab so the indicator can be positioned in pixels.
  // Re-measured on resize because the label widths change with the viewport.
  useEffect(() => {
    function measure() {
      const list = listRef.current;
      if (!list) return;
      const active = list.querySelector(`[data-tab="${tab}"]`);
      if (!active) return;
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    }
    measure();
    window.addEventListener('resize', measure);
    // Webfonts land after first paint and change the measurement under us.
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});
    return () => window.removeEventListener('resize', measure);
  }, [tab]);

  function onKeyDown(e) {
    const i = TABS.findIndex((t) => t.id === tab);
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
    else if (e.key === 'Home') next = TABS[0];
    else if (e.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    onTab?.(next.id);
    listRef.current?.querySelector(`[data-tab="${next.id}"]`)?.focus();
  }

  return (
    <header
      className={[
        // Not sticky on phones: there the bar wraps to two rows (~119px) and
        // pinning that much of an 812px viewport costs more than it returns.
        // It pins from the small breakpoint up, where it stays one row.
        'k-glass relative z-30 border-b border-solid border-rule sm:sticky sm:top-0',
        'transition-[padding,background-color,box-shadow] duration-slow ease-token',
        condensed ? 'py-s2 shadow-1' : 'py-s4',
      ].join(' ')}
    >
      {/* Wraps to a second row rather than overflowing: at 375px the wordmark,
          three tabs and two controls do not fit on one line, and a nav that
          pushes the document wider than the viewport gives the whole page a
          horizontal scrollbar. */}
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-s4 gap-y-s2 px-s4">
        <a
          href="#k-main"
          className="absolute left-s4 inline-flex min-h-tap -translate-y-[200%] items-center rounded-token bg-surface px-s3 text-ink focus:translate-y-0"
        >
          Skip to content
        </a>

        {/* The wordmark is the first thing to go when space is tight — the
            page title and the tabs both say where you are. */}
        <span
          className={[
            'hidden font-mono uppercase tracking-label text-faint sm:inline',
            'text-xs',
          ].join(' ')}
        >
          Elevate Internships
        </span>

        <nav className="relative ml-0 sm:ml-auto" aria-label="Sections">
          <div ref={listRef} role="tablist" onKeyDown={onKeyDown} className="flex gap-s1">
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  data-tab={t.id}
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onTab?.(t.id)}
                  className={[
                    // 24px minimum target in both axes — WCAG 2.2 2.5.8.
                    'min-h-tap cursor-pointer border-0 bg-transparent px-s2 font-body text-sm font-semibold sm:px-s3',
                    'transition-colors duration-base ease-token',
                    active ? 'text-accent' : 'text-faint hover:text-ink',
                  ].join(' ')}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Purely decorative: the selected state is already carried by
              aria-selected, so this is aria-hidden. */}
          {indicator && (
            <span
              aria-hidden="true"
              className="absolute -bottom-px block h-0.5 bg-accent transition-all duration-slow ease-token motion-reduce:transition-none"
              style={{ left: indicator.left, width: indicator.width }}
            />
          )}
        </nav>

        <div className="ml-auto flex items-center gap-s2">
          {user ? (
            <button type="button" className="theme-toggle" onClick={onSignOut}>
              Sign out
            </button>
          ) : (
            <button type="button" className="theme-toggle" onClick={onSignIn}>
              Sign in
            </button>
          )}
          <button
            type="button"
            className="theme-toggle capitalize"
            onClick={onTheme}
            aria-label={`Theme: ${theme}. Activate to change.`}
          >
            {theme}
          </button>
        </div>
      </div>
    </header>
  );
}
