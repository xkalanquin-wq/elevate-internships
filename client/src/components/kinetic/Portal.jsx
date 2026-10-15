import React from 'react';
import { useReveal } from './useReveal';

/**
 * The account section — the way into your own ledger.
 *
 * Signed out, this is the pitch for an account plus the honest statement of
 * what one costs you (a cookie, an email address) and what it does not
 * (tracking, analytics, marketing). Signed in, it becomes a status panel and
 * stops selling.
 *
 * The privacy wording here has to stay true to what the server does. If
 * sessions, storage or third-party requests change, this copy changes with
 * them — it is not boilerplate.
 */
export default function Portal({ user, stats = null, onSignIn, onCreate, onGoLedger, onGoStats }) {
  const ref = useReveal();
  const ruleRef = useReveal({ step: 2 });

  return (
    <section className="mx-auto max-w-page px-s4 py-s7" aria-labelledby="k-portal-title">
      <div ref={ruleRef} className="k-rule mb-s6" aria-hidden="true" />

      <div
        ref={ref}
        className="k-reveal rounded-lg border border-solid border-rule bg-accent-soft p-s6"
      >
        {user ? (
          <>
            <p className="mb-s3 font-mono text-xs uppercase tracking-label text-faint">
              Signed in
            </p>
            <h2 id="k-portal-title" className="font-display text-title leading-tight text-ink">
              {user.name ? `Welcome back, ${user.name}.` : 'Welcome back.'}
            </h2>

            {stats?.totals ? (
              <dl className="mt-s5 flex flex-wrap gap-s6">
                <Stat label="On your ledger" value={stats.totals.items} />
                <Stat label="Completed" value={stats.totals.completed} />
                <Stat label="Hours left" value={stats.totals.hoursLeft} />
              </dl>
            ) : (
              <p className="mt-s4 text-muted">Your ledger is empty — add a track to start one.</p>
            )}

            <div className="mt-s6 flex flex-wrap gap-s3">
              <button type="button" className="btn min-h-tap" onClick={onGoLedger}>
                Open my ledger
              </button>
              <button type="button" className="btn ghost min-h-tap" onClick={onGoStats}>
                See my stats
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-s3 font-mono text-xs uppercase tracking-label text-faint">
              Your account
            </p>
            <h2 id="k-portal-title" className="font-display text-title leading-tight text-ink">
              Keep your progress across devices.
            </h2>
            <p className="mt-s4 max-w-prose text-muted">
              Searching works signed out, and anything you tick is kept in this browser. An account
              is what moves that ledger to the next device you open — and keeps it separate from
              everyone else who signs in.
            </p>

            <ul className="mt-s5 list-none space-y-s2 pl-0 text-base text-muted">
              <li>One strictly-necessary session cookie, set only after you sign in.</li>
              <li>No third-party analytics, no tracking pixels, and no ads in the app.</li>
              <li>Export everything as JSON or CSV, and delete the account outright.</li>
            </ul>

            <div className="mt-s6 flex flex-wrap gap-s3">
              <button type="button" className="btn min-h-tap" onClick={onCreate}>
                Create an account
              </button>
              <button type="button" className="btn ghost min-h-tap" onClick={onSignIn}>
                I already have one
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="font-mono text-xs uppercase tracking-label text-faint">{label}</dt>
      <dd className="mt-s1 font-display text-xl leading-none text-ink">{value ?? 0}</dd>
    </div>
  );
}
