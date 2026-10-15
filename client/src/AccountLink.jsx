import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Where the links in account emails land.
 *
 *   /verify?token=…  confirms an email address as soon as the page opens.
 *   /reset?token=…   asks for a new password, then signs the person in.
 *
 * Tokens are single-use and expire (24 hours to confirm, one hour to reset);
 * the server checks both. App strips the token from the address bar before
 * this renders, so it does not linger in history or get copied into a share.
 */
export default function AccountLink({ kind, token, onSignedIn, onVerified, onHome }) {
  if (kind === 'verify') return <Verify token={token} onVerified={onVerified} onHome={onHome} />;
  return <Reset token={token} onSignedIn={onSignedIn} onHome={onHome} />;
}

function Verify({ token, onVerified, onHome }) {
  const [state, setState] = useState(token ? 'working' : 'error');
  const [error, setError] = useState(token ? null : 'This link is missing its code. Open it again from the email.');
  // StrictMode mounts effects twice in development; the token is single-use,
  // so the second call would report "already used" over a real success.
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    api
      .verifyEmail(token)
      .then(() => {
        setState('done');
        onVerified?.();
      })
      .catch((err) => {
        setState('error');
        setError(err.message);
      });
  }, [token, onVerified]);

  return (
    <div className="auth">
      <div className="eyebrow">Confirm your email</div>
      {state === 'working' && (
        <p className="auth-lede" role="status">
          Confirming…
        </p>
      )}
      {state === 'done' && (
        <>
          <h2>Email confirmed.</h2>
          <p className="auth-lede" role="status">
            Thanks. Your account is all set.
          </p>
        </>
      )}
      {state === 'error' && (
        <>
          <h2>That link did not work.</h2>
          <div className="error" role="alert">
            {error}
          </div>
          <p className="auth-lede">Links last 24 hours and work once. Sign in and you can ask for a new one.</p>
        </>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onHome}>
          Go to Elevate Internships
        </button>
      </div>
    </div>
  );
}

function Reset({ token, onSignedIn, onHome }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(token ? null : 'This link is missing its code. Open it again from the email.');
  const [done, setDone] = useState(false);

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e) {
    e.preventDefault();
    if (password.length < 10 || password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.resetPassword({ token, password });
      setPassword('');
      setConfirm('');
      setDone(true);
      onSignedIn?.(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="auth">
        <div className="eyebrow">Password changed</div>
        <h2>You are signed in.</h2>
        <p className="auth-lede" role="status">
          Your new password is saved, and any other device that was signed in has been signed out.
        </p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onHome}>
            Go to Elevate Internships
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <div className="eyebrow">Reset your password</div>
      <h2>Choose a new password.</h2>
      <p className="auth-lede">This link works once, for one hour after it was sent.</p>

      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="reset-password">New password</label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            required
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={tooShort}
            aria-describedby="reset-password-help"
          />
          <span id="reset-password-help" className={tooShort ? 'field-error' : 'field-help'}>
            At least 10 characters. Length beats symbols.
          </span>
        </div>

        <div className="field">
          <label htmlFor="reset-confirm">Type it again</label>
          <input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            required
            maxLength={200}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch}
            aria-describedby={mismatch ? 'reset-confirm-err' : undefined}
          />
          {mismatch && (
            <span id="reset-confirm-err" className="field-error" role="alert">
              The two passwords do not match.
            </span>
          )}
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <div className="form-actions">
          <button
            type="submit"
            className="btn"
            disabled={busy || !token || password.length < 10 || password !== confirm}
          >
            {busy ? 'Saving…' : 'Save new password'}
          </button>
          <button type="button" className="btn ghost" onClick={onHome}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
