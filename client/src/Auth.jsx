import React, { useRef, useState } from 'react';
import { api } from './api.js';
import { referralCode } from './referral.js';

/**
 * Sign in / create account.
 *
 * The password is sent once over the wire and never stored client-side — no
 * localStorage, no state that outlives the submit. The session lives in an
 * httpOnly cookie the browser handles, which JavaScript cannot read.
 */
export default function Auth({ mode: initialMode = 'login', onDone, onCancel }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  // Set once a reset link has been requested; holds the server's message.
  const [sent, setSent] = useState(null);
  // Bot trap: hidden from people, filled in by form-filling bots.
  const [trap, setTrap] = useState('');

  const isSignup = mode === 'signup';

  // The server answers the same whether or not the address has an account,
  // so this form cannot be used to find out who has signed up.
  async function requestReset(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.forgot(email.trim(), trap);
      setSent(res.message || 'If that email has an account, a reset link is on its way.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'forgot') {
    return (
      <div className="auth">
        <div className="eyebrow">Reset your password</div>
        <h2>Forgot your password?</h2>
        <p className="auth-lede">Enter the email you signed up with and we will send a link to choose a new one.</p>

        {sent ? (
          <div className="notice" role="status">
            <span>
              {sent} The link works for one hour. Check your spam folder if it does not arrive in a few minutes.
            </span>
          </div>
        ) : (
          <form onSubmit={requestReset} noValidate>
        <div className="hp" aria-hidden="true">
          <label htmlFor="auth-forgot-website">Do not fill this in</label>
          <input id="auth-forgot-website" name="leave_blank" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </div>
            <div className="field">
              <label htmlFor="auth-forgot-email">Email</label>
              <input
                id="auth-forgot-email"
                type="email"
                autoComplete="email"
                required
                maxLength={200}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu"
              />
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <div className="form-actions">
              <button type="submit" className="btn" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
              {onCancel && (
                <button type="button" className="btn ghost" onClick={onCancel}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}

        <p className="auth-switch">
          Remembered it?{' '}
          <button
            type="button"
            className="footer-link"
            onClick={() => {
              setMode('login');
              setSent(null);
              setError(null);
            }}
          >
            Back to sign in
          </button>
        </p>
      </div>
    );
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = isSignup
        ? await api.signup({ email, password, name, ref: referralCode(), website: trap })
        : await api.login({ email, password });
      setPassword('');
      onDone(res);
    } catch (err) {
      setError(err.message);
      const bad = err.body?.fields || {};
      setFields(bad);
      // Keep focus somewhere useful rather than on a disabled button, and land
      // on the first field that is actually wrong — otherwise a keyboard or
      // screen-reader user has to hunt for what the message is talking about.
      if (bad.email) emailRef.current?.focus();
      else if (bad.password) passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="eyebrow">{isSignup ? 'Create an account' : 'Sign in'}</div>
      <h2>{isSignup ? 'Track your own progress.' : 'Welcome back.'}</h2>
      <p className="auth-lede">
        {isSignup
          ? 'Your ledger, completions and stats are yours alone — nobody else signed in sees them.'
          : 'Searching works without an account. Signing in is what keeps your ledger.'}
      </p>

      <form onSubmit={submit} noValidate>
        <div className="hp" aria-hidden="true">
          <label htmlFor="auth-website">Do not fill this in</label>
          <input id="auth-website" name="leave_blank" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </div>
        {isSignup && (
          <div className="field">
            <label htmlFor="auth-name">Name — optional</label>
            <input
              id="auth-name"
              type="text"
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex"
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            ref={emailRef}
            type="email"
            autoComplete="email"
            required
            maxLength={200}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fields.email)}
            aria-describedby={fields.email ? 'auth-email-err' : undefined}
            placeholder="you@university.edu"
          />
          {fields.email && (
            <span id="auth-email-err" className="field-error" role="alert">
              {fields.email}
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            ref={passwordRef}
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            required
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(fields.password)}
            aria-describedby={fields.password ? 'auth-password-err' : 'auth-password-help'}
          />
          {/* The error is a separate node from the hint so that mounting it is
              what the screen reader announces. Swapping the text inside a single
              element leaves role="alert" already present, and nothing is read. */}
          {fields.password && (
            <span id="auth-password-err" className="field-error" role="alert">
              {fields.password}
            </span>
          )}
          <span id="auth-password-help" className="field-help" hidden={Boolean(fields.password)}>
            {(isSignup ? 'At least 10 characters. Length beats symbols.' : ' ')}
          </span>
          {!isSignup && (
            <button
              type="button"
              className="footer-link auth-forgot"
              onClick={() => {
                setMode('forgot');
                setPassword('');
                setError(null);
                setFields({});
              }}
            >
              Forgot password?
            </button>
          )}
        </div>

        {error && !fields.email && !fields.password && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy || !email || !password}>
            {busy ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
          </button>
          {onCancel && (
            <button type="button" className="btn ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <p className="auth-switch">
        {isSignup ? 'Already have an account?' : 'No account yet?'}{' '}
        <button
          type="button"
          className="footer-link"
          onClick={() => {
            setMode(isSignup ? 'login' : 'signup');
            setError(null);
            setFields({});
          }}
        >
          {isSignup ? 'Sign in' : 'Create one'}
        </button>
      </p>

      <p className="auth-note">
        Your password is hashed with scrypt before it is stored. It is never saved in plain text, never
        logged, and never sent back to the browser.
      </p>
    </div>
  );
}
