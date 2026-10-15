import React from 'react';

/** True for a plain left click: anything else (new tab, new window) goes to the browser. */
export const plainClick = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * The site's own pages (Premium, Sponsor, the by-major pages, Career guides).
 * Real hrefs, so crawlers follow them and a middle-click opens a new tab;
 * links marked inApp are handled client-side by onOpen instead of a page load.
 *
 * `variant` only changes the class: "pills" for the row under the page title,
 * "list" for the More sheet.
 */
export default function PageLinks({ links, onOpen, variant = 'pills', label = 'More from Elevate Internships' }) {
  return (
    <nav className={`page-links page-links-${variant}`} aria-label={label}>
      {links.map((l) => (
        <a
          key={l.href}
          className="page-link"
          href={l.href}
          onClick={
            l.inApp
              ? (e) => {
                  if (!plainClick(e)) return;
                  e.preventDefault();
                  onOpen(l.href);
                }
              : undefined
          }
        >
          {l.label}
        </a>
      ))}
    </nav>
  );
}
