import React, { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * The weekly "new internships" email, offered under a finished search. It
 * follows the person's most recent search, so turning it on here means
 * "this search". Opt-in, signed-in only, and confirmed addresses only —
 * otherwise anyone could sign a stranger's address up for weekly mail.
 */
export default function WeeklyEmail({ signedIn, onNeedAccount, searchKey }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [linkSent, setLinkSent] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    api
      .digest()
      .then(setState)
      .catch(() => setState(null));
  }, [signedIn, searchKey]);

  if (!signedIn) {
    return (
      <p className="reminder-note weekly-email">
        Want new matches for this search by email each week?{' '}
        <button type="button" className="footer-link" onClick={onNeedAccount}>
          Sign in
        </button>{' '}
        to turn it on.
      </p>
    );
  }
  if (!state) return null;

  return (
    <div className="reminder-toggle weekly-email">
      <label className="toggle-line">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy || (!state.verified && !state.enabled)}
          onChange={async (e) => {
            setBusy(true);
            setErr(null);
            try {
              setState(await api.setDigest(e.target.checked));
            } catch (e2) {
              setErr(e2.message);
            } finally {
              setBusy(false);
            }
          }}
        />
        <span>Email me new internships for this search every week</span>
      </label>
      {state.enabled && (
        <div className="reminder-note">Follows your most recent search. Only sent when something new has been posted.</div>
      )}
      {!state.verified && !state.enabled && (
        <div className="reminder-note">
          Confirm your email address first.{' '}
          {linkSent ? (
            'Check your inbox for the link.'
          ) : (
            <button
              type="button"
              className="footer-link"
              onClick={async () => {
                try {
                  await api.sendVerification();
                  setLinkSent(true);
                } catch (e2) {
                  setErr(e2.message);
                }
              }}
            >
              Send the confirmation link
            </button>
          )}
        </div>
      )}
      {!state.available && (
        <div className="reminder-note">Email is not switched on for this site yet. Your choice is saved.</div>
      )}
      {err && (
        <div className="error" role="alert">
          {err}
        </div>
      )}
    </div>
  );
}
