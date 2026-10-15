import React, { useState } from 'react';
import EmptyState from './components/ui/EmptyState.jsx';
import { AnimatedNumber, Reveal, Stagger, useCelebrate } from './motion/index.js';

const COST_LABEL = {
  free: 'Free',
  audit: 'Free to audit',
  check: 'Check your campus',
  ref: 'Reference',
  paid: 'Paid',
};

function Check({ checked, onChange, label }) {
  return (
    <button
      type="button"
      className="check"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <polyline points="1.5,6.5 4.5,9.5 10.5,2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function stamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Two LinkedIn links for a finished certification.
 *
 * "Add to profile" opens LinkedIn's own add-a-certification form with the
 * name, issuer and date filled in — the person reviews and saves it there.
 * "Share" posts a link to this major's page, which is what brings the next
 * student to the site. Neither sends anything until the person confirms on
 * LinkedIn. Reference entries are reading, not credentials, so they get
 * neither.
 */
function linkedInLinks(item, doneAt) {
  const d = new Date(doneAt);
  const profile = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: item.title,
    // "Wharton · Coursera" and "Microsoft / Certiport" name the issuer first.
    organizationName: String(item.provider || '').split(/ · | \/ /)[0],
  });
  if (!Number.isNaN(d.getTime())) {
    profile.set('issueYear', String(d.getFullYear()));
    profile.set('issueMonth', String(d.getMonth() + 1));
  }
  const page = `${window.location.origin}/certifications${item.field ? `/${item.field}` : ''}`;
  return {
    addToProfile: `https://www.linkedin.com/profile/add?${profile}`,
    share: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(page)}`,
  };
}

function Row({ item, doneAt, onToggle, onRemove }) {
  const li = doneAt && item.cost !== 'ref' ? linkedInLinks(item, doneAt) : null;
  // A short ring around the card the moment it is marked complete.
  const celebrating = useCelebrate(Boolean(doneAt));
  return (
    <div className={`row${doneAt ? ' done' : ''}${celebrating ? ' celebrate' : ''}`}>
      <Check checked={Boolean(doneAt)} onChange={(v) => onToggle(item.id, v)} label={`Mark ${item.title} complete`} />
      <div className="row-body">
        <div className="row-title">{item.title}</div>
        <div className="row-provider">{item.provider}</div>
        {item.desc && <div className="row-desc">{item.desc}</div>}
        {item.links?.length > 0 && (
          <div className="row-links">
            {item.links.map((l) => (
              <a key={l.url} className="link-btn" href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label} ↗
              </a>
            ))}
          </div>
        )}
        {li && (
          <div className="row-links">
            <a className="link-btn linkedin" href={li.addToProfile} target="_blank" rel="noopener noreferrer">
              Add to LinkedIn profile ↗
            </a>
            <a className="link-btn linkedin" href={li.share} target="_blank" rel="noopener noreferrer">
              Share on LinkedIn ↗
            </a>
          </div>
        )}
        <div className="row-meta">
          <span className={`tag ${item.cost}`}>{COST_LABEL[item.cost] || item.cost}</span>
          {item.hours > 0 && <span>{item.hours}h</span>}
          {doneAt && <span className="stamp">✓ {stamp(doneAt)}</span>}
        </div>
        {item.price && <div className="price-note">{item.price}</div>}
      </div>
      <button type="button" className="row-remove" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.title}`}>
        ×
      </button>
    </div>
  );
}

export default function Ledger({ state, onToggle, onClear, onRemove, onGoFind }) {
  const [confirming, setConfirming] = useState(false);

  if (!state) return <div className="empty">Loading the ledger…</div>;

  const all = state.items;

  if (all.length === 0) {
    return (
      // h2, not h3: this is the only heading in the panel and it sits
      // directly under the page h1, so an h3 skips a level.
      <EmptyState
        title="Your ledger is empty"
        illustration="ledger"
        action={
          <button type="button" className="btn" onClick={onGoFind}>
            Go to the Finder
          </button>
        }
      >
        Run a search on the Finder and it will offer a starter track for your major — accounting, finance, marketing,
        analytics, supply chain and ten more — plus individual certifications you can add one at a time.
      </EmptyState>
    );
  }

  const doneCount = all.filter((i) => state.done[i.id]).length;
  const totalHours = all.reduce((s, i) => s + (i.hours || 0), 0);
  const hoursLeft = all.filter((i) => !state.done[i.id]).reduce((s, i) => s + (i.hours || 0), 0);

  const groups = state.groups
    .map((g) => ({ ...g, rows: all.filter((i) => i.group === g.id) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div>
      {/* The count runs up and the tick strip fills as the meter comes into view. */}
      <Reveal className="meter">
        <div className="meter-top">
          <div className="meter-count">
            <AnimatedNumber value={doneCount} /> <span>of {all.length} complete</span>
          </div>
          <div className="meter-hours">
            {hoursLeft}h of study left
            <br />
            {totalHours}h total
          </div>
        </div>
        <div className="ticks" aria-hidden="true">
          {all.map((i) => (
            <div key={i.id} className={`tick${state.done[i.id] ? ' on' : ''}`} />
          ))}
        </div>
      </Reveal>

      {groups.map((group) => (
        <section className="section" key={group.id}>
          <div className="section-head">
            <div>
              <h2>{group.name}</h2>
              <div className="section-note">{group.note}</div>
            </div>
            <div className="section-count">
              {group.rows.filter((i) => state.done[i.id]).length} / {group.rows.length}
            </div>
          </div>
          <Stagger>
            {group.rows.map((item) => (
              <Row key={item.id} item={item} doneAt={state.done[item.id]} onToggle={onToggle} onRemove={onRemove} />
            ))}
          </Stagger>
        </section>
      ))}

      <div className="form-actions">
        {confirming ? (
          <>
            <span className="error">Clear every mark? This cannot be undone.</span>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                onClear();
                setConfirming(false);
              }}
            >
              Yes, clear
            </button>
            <button type="button" className="btn ghost small" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn ghost small" onClick={() => setConfirming(true)}>
            Clear all marks
          </button>
        )}
      </div>
    </div>
  );
}
