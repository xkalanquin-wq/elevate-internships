import React, { useEffect, useState } from 'react';
import { useReveal } from './useReveal';
import { api, preferredSourceUrl } from '../../api.js';
import InstallApp from '../../InstallApp.jsx';

/**
 * The footer, carrying the same claims the Privacy Policy makes.
 *
 * These two have to agree. The earlier version of this site said "no accounts,
 * no cookies" long after sessions had been added, which made the policy page
 * false rather than merely out of date. The wording below is deliberately
 * narrow: one session cookie, only when signed in, no third-party analytics.
 */
export default function Footer({ onLegal, catalogCount = null, trackCount = null }) {
  const ref = useReveal({ threshold: 0.05 });
  const year = new Date().getFullYear();
  // Where feedback goes is operator configuration, read from the server.
  const [contactEmail, setContactEmail] = useState(null);
  useEffect(() => {
    api
      .site()
      .then((s) => setContactEmail(s.contactEmail || null))
      .catch(() => {});
  }, []);

  return (
    <footer ref={ref} className="k-reveal mt-s7 border-t border-solid border-rule">
      <div className="mx-auto max-w-page px-s4 py-s6">
        <div className="flex flex-wrap items-start justify-between gap-s5">
          <div>
            <p className="font-mono text-xs uppercase tracking-label text-faint">
              Elevate Internships
            </p>
            <p className="mt-s2 max-w-prose text-base text-muted">
              Internships and credentials for business students.
              {catalogCount ? ` ${catalogCount} certifications` : ''}
              {trackCount ? ` across ${trackCount} majors.` : catalogCount ? '.' : ''}
            </p>
          </div>

          <nav aria-label="Footer">
            <ul className="flex list-none flex-wrap gap-s4 pl-0">
              <li>
                <a
                  href="/terms"
                  onClick={(e) => {
                    if (!onLegal) return;
                    e.preventDefault();
                    onLegal('terms');
                  }}
                  className="inline-flex min-h-tap min-w-tap items-center font-mono text-xs uppercase tracking-label text-faint hover:text-ink"
                >
                  Terms
                </a>
              </li>
              <li>
                <a
                  href="/privacy"
                  onClick={(e) => {
                    if (!onLegal) return;
                    e.preventDefault();
                    onLegal('privacy');
                  }}
                  className="inline-flex min-h-tap min-w-tap items-center font-mono text-xs uppercase tracking-label text-faint hover:text-ink"
                >
                  Privacy
                </a>
              </li>
              <li>
                <a href="/certifications" className="inline-flex min-h-tap min-w-tap items-center font-mono text-xs uppercase tracking-label text-faint hover:text-ink">
                  Certifications by major
                </a>
              </li>
              <li>
                <a href="/internships" className="inline-flex min-h-tap min-w-tap items-center font-mono text-xs uppercase tracking-label text-faint hover:text-ink">
                  Internships by major
                </a>
              </li>
              <li>
                <a href="/career-guides" className="inline-flex min-h-tap min-w-tap items-center font-mono text-xs uppercase tracking-label text-faint hover:text-ink">
                  Career guides
                </a>
              </li>
              {contactEmail && (
                <li>
                  <a
                    href={`mailto:${contactEmail}?subject=${encodeURIComponent('Elevate Internships feedback')}`}
                    className="inline-flex min-h-tap min-w-tap items-center font-mono text-xs uppercase tracking-label text-faint hover:text-ink"
                  >
                    Send feedback
                  </a>
                </li>
              )}
            </ul>
          </nav>
        </div>

        <a className="pref-source mt-s5" href={preferredSourceUrl()} target="_blank" rel="noopener noreferrer">
          <span className="pref-star" aria-hidden="true">★</span>
          <span>
            Add Elevate Internships as a <strong>preferred source</strong> on Google
          </span>
        </a>
        <InstallApp />

        <p className="mt-s5 max-w-prose text-sm leading-relaxed text-faint">
          No third-party analytics and no tracking cookies. One strictly-necessary session cookie is set, and
          only if you sign in. Listings come from third parties and are not verified here — confirm
          on the employer's own site before applying, and confirm a course's price with the provider
          before you enrol.
        </p>

        <p className="mt-s4 font-mono text-xs text-faint">© {year} Elevate Internships</p>
      </div>
    </footer>
  );
}
