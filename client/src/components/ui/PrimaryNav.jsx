import React, { useRef } from 'react';
import Icon from './Icon.jsx';
import { TabIndicator } from '../../motion/index.js';

/**
 * The four sections of the app, plus More.
 *
 * One element serves every screen size: CSS places it in the top bar on
 * tablets and desktops, and fixes it to the bottom of the screen on phones,
 * where it reads as a native tab bar. Keeping it one element means one set of
 * ids, one tab order and one ARIA tabs pattern, whatever the width.
 *
 * On the tab screens it is an ARIA tablist (asTabs), controlling the tabpanel
 * in App. On other screens — a major, the policies, Account — there is no
 * tabpanel, so the same buttons are plain buttons that take you back to a tab.
 *
 * Presentational only: which tab is active and what selecting one does are
 * App's business, passed in as props. The sliding marker under the active
 * tab is TabIndicator, from the motion layer.
 */
export default function PrimaryNav({ tabs, active, asTabs, onSelect, onKeyDown, onMore, moreOpen, moreRef }) {
  const row = useRef(null);
  return (
    <nav className="primary-nav" aria-label="Main">
      <div
        ref={row}
        className={asTabs ? 'primary-tabs has-indicator' : 'primary-tabs'}
        role={asTabs ? 'tablist' : undefined}
        aria-label={asTabs ? 'Elevate Internships sections' : undefined}
      >
        {tabs.map((t) => {
          const selected = asTabs && active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              id={asTabs ? `tab-${t.id}` : undefined}
              className="tab"
              role={asTabs ? 'tab' : undefined}
              aria-selected={asTabs ? selected : undefined}
              aria-controls={asTabs ? `panel-${t.id}` : undefined}
              tabIndex={asTabs ? (selected ? 0 : -1) : undefined}
              onKeyDown={asTabs ? onKeyDown : undefined}
              onClick={() => onSelect(t.id)}
            >
              <span className="tab-icon">
                <Icon name={t.icon} />
              </span>
              <span className="tab-label">{t.label}</span>
              {t.count && <span className="tab-count">{t.count}</span>}
            </button>
          );
        })}
        {asTabs && <TabIndicator containerRef={row} activeId={active} />}
      </div>
      <button
        type="button"
        className="tab tab-more"
        ref={moreRef}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        onClick={onMore}
      >
        <span className="tab-icon">
          <Icon name="more" />
        </span>
        <span className="tab-label">More</span>
      </button>
    </nav>
  );
}
