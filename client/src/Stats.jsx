import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import EmptyState from './components/ui/EmptyState.jsx';
import { AnimatedNumber, Reveal, Stagger } from './motion/index.js';

/**
 * Your own numbers, computed on the server from the ledger and search history
 * already on disk. No third-party analytics, no tracking, nothing leaves the
 * machine — adding Google Analytics here would contradict the privacy policy.
 */

function Bar({ label, done, total, hours }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <Reveal className="stat-bar">
      <div className="stat-bar-head">
        <span className="stat-bar-label">{label}</span>
        <span className="stat-bar-num">
          {done}/{total} · {hours}h
        </span>
      </div>
      <div className="stat-track" role="img" aria-label={`${label}: ${done} of ${total} complete`}>
        <div className="stat-fill" style={{ width: `${pct}%` }} />
      </div>
    </Reveal>
  );
}

/** Last 12 weeks of completions, densest-first like a contribution strip. */
function Heat({ byDay }) {
  const days = [];
  const today = new Date();
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, n: byDay[key] || 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.n));
  const total = days.reduce((s, d) => s + d.n, 0);
  const activeDays = days.filter((d) => d.n > 0).length;

  // A role="img" is only useful if its label carries the data the picture
  // shows; "a heatmap" tells a screen-reader user nothing.
  const summary = total
    ? `Completions over the last twelve weeks: ${total} item${total === 1 ? '' : 's'} across ${activeDays} day${
        activeDays === 1 ? '' : 's'
      }. Busiest day: ${max}.`
    : 'Completions over the last twelve weeks: none yet.';

  return (
    <div className="heat" role="img" aria-label={summary}>
      {days.map((d) => (
        <div
          key={d.key}
          className="heat-cell"
          title={`${d.key}: ${d.n} completed`}
          style={{ opacity: d.n ? 0.25 + (d.n / max) * 0.75 : 0.08 }}
        />
      ))}
    </div>
  );
}

/** The real gate is server-side; this is only the prompt for it. */
function Locked({ needsSetup, message, onUnlocked }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  if (needsSetup) {
    return (
      <div className="card narrow-card">
        <h2>Owner only</h2>
        <p className="muted">{message}</p>
        <p className="muted">
          Set <code>OWNER_PASSCODE</code> in your <code>.env</code> and restart the server to unlock this page from
          another device. Until then it opens only on the machine running the app.
        </p>
      </div>
    );
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.ownerLogin(pass);
      setPass('');
      onUnlocked();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card narrow-card" onSubmit={submit}>
      <h2>Owner only</h2>
      <p className="muted">
        This page shows your own activity, so it is locked to you. Enter the owner passcode.
      </p>
      <div className="field spaced">
        <label htmlFor="passcode">Owner passcode</label>
        <input
          id="passcode"
          type="password"
          value={pass}
          autoComplete="current-password"
          onChange={(e) => setPass(e.target.value)}
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={busy || !pass}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </div>
      {err && (
        <div className="error" role="alert">
          {err}
        </div>
      )}
    </form>
  );
}


/**
 * Where applications stand, from the Applications tab. "Applied" counts
 * anything that reached Applied or beyond, including ones later closed after
 * applying; the response rate is interviews and offers out of those.
 */
function ApplicationStats({ tracked, onGoTracker }) {
  const WEEK = 7 * 86_400_000;
  const now = Date.now();
  const applied = tracked.filter(
    (j) => ['applied', 'interviewing', 'offer'].includes(j.status) || (j.status === 'closed' && j.appliedAt),
  );
  const interviews = tracked.filter((j) => j.status === 'interviewing' || j.status === 'offer').length;
  const offers = tracked.filter((j) => j.status === 'offer').length;
  const rate = applied.length ? Math.round((interviews / applied.length) * 100) : null;
  const thisWeek = applied.filter((j) => j.appliedAt && now - new Date(j.appliedAt).getTime() < WEEK).length;
  const saved = tracked.filter((j) => j.status === 'saved').length;

  const today = new Date();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const inAWeek = new Date(today);
  inAWeek.setDate(inAWeek.getDate() + 7);
  const dueSoon = tracked.filter((j) => j.status === 'saved' && j.deadline && j.deadline >= ymd(today) && j.deadline <= ymd(inAWeek)).length;
  const overdue = tracked.filter((j) => j.status === 'saved' && j.deadline && j.deadline < ymd(today)).length;

  return (
    <section className="section flush">
      <div className="section-head">
        <div>
          <h2>Applications</h2>
          <div className="section-note">From your Applications tab</div>
        </div>
        <button type="button" className="link-btn" onClick={onGoTracker}>
          Open Applications →
        </button>
      </div>
      <Stagger className="stat-grid">
        <div className="stat-card">
          <div className="stat-num">
            <AnimatedNumber value={applied.length} />
          </div>
          <div className="stat-label">applied</div>
          <div className="stat-sub">{thisWeek} in the last 7 days</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">
            <AnimatedNumber value={interviews} />
          </div>
          <div className="stat-label">{interviews === 1 ? 'interview' : 'interviews'}</div>
          <div className="stat-sub">
            {offers} {offers === 1 ? 'offer' : 'offers'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{rate === null ? '—' : <AnimatedNumber value={rate} format={(n) => `${n}%`} />}</div>
          <div className="stat-label">response rate</div>
          <div className="stat-sub">interviews ÷ applications</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">
            <AnimatedNumber value={saved} />
          </div>
          <div className="stat-label">saved to apply</div>
          <div className="stat-sub">
            {overdue ? `${overdue} past deadline · ` : ''}
            {dueSoon} due this week
          </div>
        </div>
      </Stagger>
    </section>
  );
}

export default function Stats({ onGoFind, onGoTracker, tracked = [], guest = false, guestData = null }) {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [locked, setLocked] = useState(null);

  const load = () => {
    // A guest's stats are computed in the browser from their local ledger.
    if (guest) {
      setS(guestData);
      setLocked(false);
      return;
    }
    setErr(null);
    setLocked(null);
    api
      .stats()
      .then((d) => {
        setS(d);
        setLocked(false);
      })
      .catch((e) => {
        if (e.status === 401) setLocked({ needsSetup: Boolean(e.body?.needsSetup), message: e.message });
        else setErr(e.message);
      });
  };

  useEffect(load, [guest, guestData]);

  if (locked) return <Locked {...locked} onUnlocked={load} />;
  if (err) return <div className="error">{err}</div>;
  if (!s) return <div className="empty">Loading your stats…</div>;

  if (s.totals.items === 0 && tracked.length > 0) {
    return <ApplicationStats tracked={tracked} onGoTracker={onGoTracker} />;
  }

  if (s.totals.items === 0) {
    return (
      <EmptyState
        title="Nothing to measure yet"
        illustration="stats"
        action={
          <button type="button" className="btn" onClick={onGoFind}>
            Go to the Finder
          </button>
        }
      >
        Add a track or a certification and this page will show your progress, your study hours, and what you have been
        searching for. All of it computed locally.
      </EmptyState>
    );
  }

  const t = s.totals;

  return (
    <div>
      {tracked.length > 0 && <ApplicationStats tracked={tracked} onGoTracker={onGoTracker} />}

      <Stagger className="stat-grid">
        <div className="stat-card">
          <div className="stat-num">
            <AnimatedNumber value={t.percent} format={(n) => `${n}%`} />
          </div>
          <div className="stat-label">complete</div>
          <div className="stat-sub">
            {t.completed} of {t.items} items
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-num">
            <AnimatedNumber value={t.hoursDone} format={(n) => `${n}h`} />
          </div>
          <div className="stat-label">studied</div>
          <div className="stat-sub">{t.hoursLeft}h remaining</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">
            <AnimatedNumber value={t.tracks} />
          </div>
          <div className="stat-label">{t.tracks === 1 ? 'track' : 'tracks'}</div>
          <div className="stat-sub">{t.searches} searches run</div>
        </div>
      </Stagger>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Progress by group</h2>
            <div className="section-note">Where the remaining hours actually sit</div>
          </div>
        </div>
        <div className="stack-top">
          {Object.entries(s.byGroup).map(([name, g]) => (
            <Bar key={name} label={name} done={g.done} total={g.total} hours={g.hours} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Last twelve weeks</h2>
            <div className="section-note">Each square is a day; darker means more finished</div>
          </div>
        </div>
        <Heat byDay={s.byDay} />
      </section>

      {s.recentlyCompleted.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <h2>Recently completed</h2>
              <div className="section-note">Newest first</div>
            </div>
          </div>
          {s.recentlyCompleted.map((c) => (
            <div className="row" key={c.title + c.at}>
              <div className="row-body">
                <div className="row-title">{c.title}</div>
                <div className="row-provider">{c.provider}</div>
                <div className="row-meta">
                  <span className="stamp">✓ {new Date(c.at).toLocaleDateString()}</span>
                  {c.hours > 0 && <span>{c.hours}h</span>}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {(s.topTerms.length > 0 || s.byProvider.length > 0) && (
        <section className="section">
          <div className="section-head">
            <div>
              <h2>Patterns</h2>
              <div className="section-note">What you search for, and who you learn from</div>
            </div>
          </div>
          <div className="pattern-cols">
            {s.topTerms.length > 0 && (
              <div>
                <div className="eyebrow">Most searched</div>
                <div className="chips">
                  {s.topTerms.map(([term, n]) => (
                    <span className="chip" key={term}>
                      {term} · {n}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {s.byProvider.length > 0 && (
              <div>
                <div className="eyebrow">Providers in your ledger</div>
                <div className="chips">
                  {s.byProvider.map(([p, n]) => (
                    <span className="chip" key={p}>
                      {p} · {n}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <p className="stat-foot">
        Computed on your machine from your own ledger and search history. No analytics service is used and nothing on
        this page leaves your computer.
      </p>
    </div>
  );
}
