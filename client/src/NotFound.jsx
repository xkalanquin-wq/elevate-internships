import React from 'react';

/**
 * The server already returns a real 404 status for unknown paths; this is the
 * page that renders at it, so people get an explanation rather than the app
 * silently loading as if nothing happened.
 */
export default function NotFound({ path, onHome, onLegal }) {
  return (
    <article className="notfound">
      <div className="eyebrow">Error 404</div>
      <h1>That page does not exist.</h1>
      <p>
        Nothing lives at <code>{path}</code>. It may have been mistyped, or linked from somewhere out of date.
      </p>

      <div className="form-actions">
        <button type="button" className="btn" onClick={onHome}>
          Go to the Finder
        </button>
      </div>

      <div className="notfound-links">
        <div className="eyebrow">Where you probably meant to go</div>
        <ul>
          <li>
            <button type="button" className="footer-link" onClick={onHome}>
              Search internships and certifications
            </button>
          </li>
          <li>
            <a className="footer-link" href="/privacy" onClick={(e) => { e.preventDefault(); onLegal('privacy'); }}>
              Privacy Policy
            </a>
          </li>
          <li>
            <a className="footer-link" href="/terms" onClick={(e) => { e.preventDefault(); onLegal('terms'); }}>
              Terms and Conditions
            </a>
          </li>
        </ul>
      </div>
    </article>
  );
}
