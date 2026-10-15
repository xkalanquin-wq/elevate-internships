import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import EmptyState from './components/ui/EmptyState.jsx';
import { PREMIUM_ENABLED } from './features.js';

/**
 * /account: Premium, notifications on this device, the daily alert, and the
 * data export. Stripe sends buyers back here with ?paid=<session id>, which
 * is confirmed with the server before anything is shown as bought.
 *
 * With Premium switched off (server/data/features.json), the Premium section
 * and the daily alert (a Premium perk) are not shown.
 */

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

// ---- Notifications on this device ------------------------------------------

const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** The service worker, registering it if this page load has not yet. */
async function worker() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js');
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

function Notifications({ premium, onState }) {
  const [state, setState] = useState(null);
  const [endpoint, setEndpoint] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const supported = pushSupported();

  const load = useCallback(async () => {
    const sub = await currentSubscription().catch(() => null);
    setEndpoint(sub?.endpoint || null);
    const s = await api.push(sub?.endpoint);
    setState(s);
    onState?.(s);
  }, [onState]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  const turnOn = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setErr('Notifications are blocked for this site. Allow them in your browser settings, then try again.');
        return;
      }
      const reg = await worker();
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.publicKey) });
      }
      const s = await api.pushSubscribe(sub.toJSON());
      setEndpoint(sub.endpoint);
      setState(s);
      onState?.(s);
      setMsg('Notifications are on for this device.');
    } catch (e) {
      setErr(e.message || 'Notifications could not be turned on in this browser.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const sub = await currentSubscription();
      const ep = sub?.endpoint || endpoint;
      if (sub) await sub.unsubscribe().catch(() => {});
      const s = await api.pushUnsubscribe(ep);
      setEndpoint(null);
      setState({ ...s, thisDevice: false });
      onState?.(s);
      setMsg('Notifications are off for this device.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { delivered } = await api.pushTest();
      setMsg(delivered ? 'Sent — it should appear in a few seconds.' : 'Nothing was delivered. Turn notifications off and on again on this device.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const on = Boolean(state?.thisDevice);

  return (
    <section className="card account-card" aria-labelledby="notif-h">
      <h2 id="notif-h">Notifications</h2>
      <p className="section-note">
        A reminder on this phone or computer the day before a deadline or interview in your tracker
        {premium ? ', and your daily new-internship alert' : ''}. Free, and you can turn them off at any time.
      </p>
      {!supported ? (
        <p className="reminder-note">
          {isIos() && !isStandalone()
            ? 'On iPhone and iPad, add Elevate Internships to your Home Screen first (Share, then Add to Home Screen), open it from there, and turn notifications on in the app.'
            : 'This browser does not support notifications. Try Chrome, Edge, Firefox or Safari, or use Add to calendar in your tracker.'}
        </p>
      ) : !state ? (
        <p className="reminder-note">Checking…</p>
      ) : (
        <>
          <p>
            <strong>{on ? 'On for this device.' : 'Off for this device.'}</strong>{' '}
            {state.devices > 0 && `${state.devices} device${state.devices === 1 ? '' : 's'} in total.`}
          </p>
          <div className="form-actions">
            {on ? (
              <>
                <button type="button" className="btn small" onClick={test} disabled={busy}>
                  Send a test notification
                </button>
                <button type="button" className="btn ghost small" onClick={turnOff} disabled={busy}>
                  Turn off on this device
                </button>
              </>
            ) : (
              <button type="button" className="btn small" onClick={turnOn} disabled={busy}>
                {busy ? 'Turning on…' : 'Turn on notifications'}
              </button>
            )}
          </div>
        </>
      )}
      {msg && (
        <p className="reminder-note" role="status">
          {msg}
        </p>
      )}
      {err && (
        <div className="error" role="alert">
          {err}
        </div>
      )}
    </section>
  );
}

// ---- Daily alert (Premium) ----------------------------------------------------

function DailyAlert({ push, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (!push) return null;
  return (
    <section className="card account-card" id="alerts" aria-labelledby="alerts-h">
      <h2 id="alerts-h">Daily new-internship alert</h2>
      <label className="toggle-line">
        <input
          type="checkbox"
          checked={push.alerts}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            setErr(null);
            try {
              onChange(await api.setAlerts(e.target.checked));
            } catch (e2) {
              setErr(e2.message);
            } finally {
              setBusy(false);
            }
          }}
        />
        <span>Notify me each day when new internships match my most recent search</span>
      </label>
      {push.alerts && push.devices === 0 && (
        <p className="reminder-note">Turn on notifications above so the alert has somewhere to go.</p>
      )}
      {push.alerts && (
        <p className="reminder-note">
          Follows your most recent search in the Finder. Sent between 9am and 8pm Eastern, only when something new is posted.
        </p>
      )}
      {push.alerts && !push.lastJobs?.length && (
        <p className="reminder-note">
          No alert yet. The first one arrives within a day, as soon as new internships match your search.
        </p>
      )}
      {push.lastJobs?.length > 0 && (
        <>
          <h3>
            Latest alert{push.lastAlertAt ? ` · ${fmtDate(push.lastAlertAt)}` : ''}
          </h3>
          <ul className="alert-list">
            {push.lastJobs.map((j) => (
              <li key={j.url}>
                <a href={j.url} target="_blank" rel="noopener noreferrer">
                  {j.title}
                </a>
                <div className="listing-meta">
                  {j.company}
                  {j.location ? ` · ${j.location}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {err && (
        <div className="error" role="alert">
          {err}
        </div>
      )}
    </section>
  );
}

// ---- Premium ---------------------------------------------------------------------

function Premium({ premium, onBuy, busy, err }) {
  if (!premium) return <section className="card account-card">Loading…</section>;
  const price = `$${premium.price.toFixed(2)}`;
  if (premium.premium) {
    return (
      <section className="card account-card premium-on" aria-labelledby="prem-h">
        <div className="eyebrow">Premium</div>
        <h2 id="prem-h">You have Premium until {fmtDate(premium.premiumUntil)}.</h2>
        <ul className="static-list">
          <li>
            <strong>Daily alerts</strong> — set up below.
          </li>
          <li>
            <strong>Sample interview answers</strong> — on every page of the{' '}
            <a href="/interview-questions">interview question bank</a>.
          </li>
          <li>
            <strong>No ads</strong> on any page while you are signed in.
          </li>
          <li>
            <strong>The Recruiting Kit</strong> —{' '}
            {premium.kit ? (
              <a href="/api/premium/kit" download>
                download it (zip, about 140 KB)
              </a>
            ) : (
              'coming shortly.'
            )}
          </li>
        </ul>
        {premium.enabled && (
          <p className="reminder-note">
            Premium does not renew. Want another semester after this one?{' '}
            <button type="button" className="footer-link" onClick={onBuy} disabled={busy}>
              Add six more months for {price}
            </button>
          </p>
        )}
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}
      </section>
    );
  }
  return (
    <section className="card account-card" aria-labelledby="prem-h">
      <div className="eyebrow">Premium</div>
      <h2 id="prem-h">{price} for a semester. No subscription.</h2>
      <ul className="static-list">
        <li>
          <strong>Daily new-internship alerts</strong> on your phone or computer, instead of once a week.
        </li>
        <li>
          <strong>The Recruiting Kit</strong>: Excel planner, resume template, cover letter and networking templates.
        </li>
        <li>
          <strong>Sample answers</strong> for every question in the <a href="/interview-questions">interview question bank</a>.
        </li>
        <li>
          <strong>No ads</strong> anywhere on the site.
        </li>
      </ul>
      <p className="section-note">
        One payment covers six months and never renews on its own. Everything else on Elevate Internships stays free. Refunds
        within 14 days, no questions asked. <a href="/premium">More about Premium</a>
      </p>
      {premium.enabled ? (
        <div className="form-actions">
          <button type="button" className="btn" onClick={onBuy} disabled={busy}>
            {busy ? 'Opening the payment page…' : `Get Premium — ${price}`}
          </button>
          <span className="reminder-note">You pay on Stripe's secure page; your card never reaches this site.</span>
        </div>
      ) : (
        <p className="reminder-note">Premium purchases open soon.</p>
      )}
      {premium.testMode && <p className="reminder-note">Test mode: no real card is charged.</p>}
      {err && (
        <div className="error" role="alert">
          {err}
        </div>
      )}
    </section>
  );
}

// ---- Password and deletion ----------------------------------------------------------

function Security({ user }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const [pwErr, setPwErr] = useState(null);
  const [confirm, setConfirm] = useState('');
  const [delErr, setDelErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const changePassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    setPwErr(null);
    if (next.length < 10) return setPwErr('Use at least 10 characters for the new password.');
    setBusy(true);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setPwMsg('Password changed. Other devices have been signed out.');
    } catch (err) {
      setPwErr(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async (e) => {
    e.preventDefault();
    setDelErr(null);
    setBusy(true);
    try {
      await api.deleteAccount(confirm.trim());
      window.location.assign('/');
    } catch (err) {
      setDelErr(err.message);
      setBusy(false);
    }
  };

  return (
    <section className="card account-card" aria-labelledby="sec-h">
      <h2 id="sec-h">Password and account</h2>
      {user.hasPassword ? (
        <form onSubmit={changePassword} noValidate>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pw-current">Current password</label>
              <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pw-new">New password (10+ characters)</label>
              <input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn small" disabled={busy || !current || !next}>
              Change password
            </button>
          </div>
          {pwMsg && (
            <p className="reminder-note" role="status">
              {pwMsg}
            </p>
          )}
          {pwErr && (
            <div className="error" role="alert">
              {pwErr}
            </div>
          )}
        </form>
      ) : (
        <p className="section-note">You sign in with Google, so there is no password to change here.</p>
      )}
      <details className="danger-zone">
        <summary>Delete my account</summary>
        <form onSubmit={deleteAccount} noValidate>
          <p className="section-note">
            This permanently deletes your account, ledger, tracker, searches and notification settings. It cannot be undone.
            {PREMIUM_ENABLED && ' Premium time left is not refunded automatically — ask first if you are within 14 days of paying.'}
          </p>
          <div className="field">
            <label htmlFor="del-confirm">Type your email address to confirm</label>
            <input id="del-confirm" type="email" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn small danger" disabled={busy || confirm.trim().toLowerCase() !== user.email}>
              Delete my account
            </button>
          </div>
          {delErr && (
            <div className="error" role="alert">
              {delErr}
            </div>
          )}
        </form>
      </details>
    </section>
  );
}

// ---- Page ---------------------------------------------------------------------------

export default function Account({ user, onSignIn, onSignOut, onUserChange }) {
  const [premium, setPremium] = useState(null);
  const [push, setPush] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!user || !PREMIUM_ENABLED) return;
    let paid = '';
    let canceled = false;
    try {
      const q = new URLSearchParams(window.location.search);
      paid = (q.get('paid') || '').slice(0, 250);
      canceled = q.get('canceled') === '1';
    } catch {
      /* no query */
    }
    if (paid || canceled) window.history.replaceState(window.history.state, '', '/account');
    if (canceled) setNotice('Payment canceled — nothing was charged.');
    (paid ? api.premiumConfirm(paid) : api.premium())
      .then((p) => {
        setPremium(p);
        if (paid && p.premium) {
          setNotice(`Thank you! Premium is on until ${fmtDate(p.premiumUntil)}.`);
          onUserChange?.();
        }
      })
      .catch((e) => {
        setErr(e.message);
        api.premium().then(setPremium).catch(() => {});
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Opened from an alert notification: show the alert section.
  useEffect(() => {
    if (push && window.location.hash === '#alerts') document.getElementById('alerts')?.scrollIntoView({ block: 'start' });
  }, [push]);

  const buy = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await api.premiumCheckout();
      window.location.assign(url);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  if (user === null) return <div className="empty">Loading your account…</div>;
  if (!user) {
    return (
      <EmptyState
        title="Your account"
        illustration="account"
        level={1}
        action={
          <button type="button" className="btn" onClick={onSignIn}>
            Sign in or create an account
          </button>
        }
      >
        {PREMIUM_ENABLED ? 'Sign in to manage notifications and Premium. Accounts are free.' : 'Sign in to manage notifications and your data. Accounts are free.'}
      </EmptyState>
    );
  }

  return (
    <div className="account-page">
      <div className="major-head">
        <div className="eyebrow">Account</div>
        <h1>{user.name || user.email}</h1>
        <p className="section-note">{user.email}</p>
      </div>
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button type="button" className="footer-link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {PREMIUM_ENABLED && <Premium premium={premium} onBuy={buy} busy={busy} err={err} />}
      <Notifications premium={Boolean(premium?.premium)} onState={setPush} />
      {PREMIUM_ENABLED && premium?.premium && <DailyAlert push={push} onChange={setPush} />}
      <section className="card account-card" aria-labelledby="data-h">
        <h2 id="data-h">Your data</h2>
        <p className="section-note">Download everything this site holds about you.</p>
        <div className="form-actions">
          <a className="btn ghost small" href="/api/auth/export.json" download>
            Download (JSON)
          </a>
          <a className="btn ghost small" href="/api/auth/export.csv" download>
            Download (spreadsheet)
          </a>
          <button type="button" className="btn ghost small" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </section>
      <Security user={user} />
    </div>
  );
}
