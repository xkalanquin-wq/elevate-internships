import React, { useEffect, useRef } from 'react';

/**
 * Accept and Decline carry equal visual weight on purpose — a banner where
 * refusing is harder than accepting is a dark pattern, and declining here
 * genuinely stops the request rather than just hiding the notice.
 */
export default function ConsentBanner({ onChoice, onReadPrivacy }) {
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="consent" role="dialog" aria-modal="false" aria-labelledby="consent-title" tabIndex={-1} ref={ref}>
      <div className="consent-inner">
        <div>
          <div className="consent-title" id="consent-title">
            One request needs your say-so
          </div>
          <p className="consent-body">
            This app runs <strong>no third-party analytics</strong> and sets <strong>no tracking cookies</strong> — only one
            strictly-necessary session cookie, and only if you sign in. But the fonts come from Google, and loading
            them tells Google your IP address. Decline and they are never requested — your system fonts are used
            instead.
          </p>
          <button type="button" className="consent-link" onClick={onReadPrivacy}>
            Read the Privacy Policy
          </button>
        </div>
        <div className="consent-actions">
          <button type="button" className="btn small" onClick={() => onChoice('granted')}>
            Allow Google Fonts
          </button>
          <button type="button" className="btn ghost small" onClick={() => onChoice('denied')}>
            Use system fonts
          </button>
        </div>
      </div>
    </div>
  );
}
