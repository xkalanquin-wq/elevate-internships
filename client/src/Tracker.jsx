import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import EmptyState from './components/ui/EmptyState.jsx';
import { Stagger } from './motion/index.js';
import { downloadIcs, eventsFor } from './calendar.js';

/**
 * The application tracker: every internship you chose to follow, grouped by
 * the stage you say it is at.
 *
 * Stages move forward by one click but can be set to anything from the menu,
 * because real applications do not move in a straight line — an offer can be
 * declined, a "closed" posting can reopen.
 */

export const STAGES = [
  { id: 'saved', label: 'Saved', note: 'Worth applying to' },
  { id: 'applied', label: 'Applied', note: 'Application sent' },
  { id: 'interviewing', label: 'Interviewing', note: 'In conversation with the employer' },
  { id: 'offer', label: 'Offer', note: 'Offer received' },
  { id: 'closed', label: 'Closed', note: 'Rejected, withdrawn, or no longer pursuing' },
];

const NEXT = { saved: 'applied', applied: 'interviewing', interviewing: 'offer' };
const LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label]));

function stamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}


// ---- Dates ------------------------------------------------------------------
// Deadlines are calendar dates ("2026-10-03") and interviews are local date
// and time ("2026-10-07T14:30"), both read in the student's own time zone.

const pad2 = (n) => String(n).padStart(2, '0');

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Whole days from today to a date: 0 today, 1 tomorrow, -1 yesterday. */
export function daysUntil(ymd) {
  if (!ymd) return null;
  const a = new Date(`${todayYmd()}T12:00:00`);
  const b = new Date(`${ymd.slice(0, 10)}T12:00:00`);
  return Math.round((b - a) / 86_400_000);
}

const fmtDay = (ymd) =>
  new Date(`${ymd.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const fmtInterview = (dt) =>
  new Date(dt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function relative(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** A deadline only matters until you apply; an interview until it is closed. */
const liveDeadline = (job) => job.deadline && job.status === 'saved';
const liveInterview = (job) => job.interviewAt && job.status !== 'closed';

/** The date that matters most for ordering a card: its next deadline or interview. */
function nextDate(job) {
  const dates = [];
  if (liveDeadline(job)) dates.push(job.deadline);
  if (liveInterview(job)) dates.push(job.interviewAt.slice(0, 10));
  return dates.sort()[0] || null;
}

function DateChips({ job }) {
  const chips = [];
  if (liveDeadline(job)) {
    const d = daysUntil(job.deadline);
    const tone = d < 0 ? 'overdue' : d <= 2 ? 'soon' : '';
    chips.push(
      <span key="d" className={`date-chip ${tone}`}>
        {d < 0 ? 'Deadline passed' : 'Apply by'} {fmtDay(job.deadline)} · {relative(d)}
      </span>,
    );
  }
  if (liveInterview(job)) {
    const d = daysUntil(job.interviewAt);
    chips.push(
      <span key="i" className={`date-chip interview ${d >= 0 && d <= 2 ? 'soon' : ''}`}>
        Interview {fmtInterview(job.interviewAt)}
        {d >= 0 ? ` · ${relative(d)}` : ''}
      </span>,
    );
  }
  return chips.length ? <div className="date-chips">{chips}</div> : null;
}

function DatesEditor({ job, onDates, onClose }) {
  const [deadline, setDeadline] = useState(job.deadline || '');
  const [interviewAt, setInterviewAt] = useState(job.interviewAt || '');
  return (
    <div className="dates-editor">
      <div className="field">
        <label htmlFor={`deadline-${job.jobKey}`}>Apply by</label>
        <input id={`deadline-${job.jobKey}`} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`interview-${job.jobKey}`}>Interview</label>
        <input
          id={`interview-${job.jobKey}`}
          type="datetime-local"
          value={interviewAt}
          onChange={(e) => setInterviewAt(e.target.value.slice(0, 16))}
        />
      </div>
      <div className="row-links">
        <button
          type="button"
          className="link-btn primary"
          onClick={() => {
            onDates(job.jobKey, { deadline, interviewAt });
            onClose();
          }}
        >
          Save dates
        </button>
        <button type="button" className="link-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ComingUp({ jobs }) {
  const items = [];
  for (const job of jobs) {
    if (liveDeadline(job)) items.push({ job, kind: 'deadline', date: job.deadline, days: daysUntil(job.deadline) });
    if (liveInterview(job)) items.push({ job, kind: 'interview', date: job.interviewAt, days: daysUntil(job.interviewAt) });
  }
  // Overdue deadlines stay listed so they are not silently missed; anything
  // more than two weeks out waits until it is nearer.
  const shown = items.filter((i) => (i.kind === 'deadline' ? i.days <= 14 : i.days >= 0 && i.days <= 14)).sort((a, b) => a.date.localeCompare(b.date));
  const withDates = items.map((i) => i.job);

  return (
    <section className="section coming-up">
      <div className="section-head">
        <div>
          <h2>Coming up</h2>
          <div className="section-note">Deadlines and interviews in the next two weeks</div>
        </div>
        {withDates.length > 0 && (
          <button
            type="button"
            className="link-btn"
            onClick={() => downloadIcs([...new Set(withDates)].flatMap(eventsFor), 'internship-dates.ics')}
          >
            Add all to calendar ↓
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="empty">
          Nothing in the next two weeks. Add an <strong>Apply by</strong> date or an <strong>Interview</strong> to any
          internship with <em>Dates</em>, and it shows up here.
        </div>
      ) : (
        <ul className="coming-list">
          {shown.map(({ job, kind, date, days }) => (
            <li key={kind + job.jobKey} className={days < 0 ? 'overdue' : days <= 2 ? 'soon' : ''}>
              <span className="coming-when">
                {kind === 'deadline' ? fmtDay(date) : fmtInterview(date)} · {relative(days)}
              </span>
              <span className="coming-what">
                {kind === 'deadline' ? (days < 0 ? 'Deadline passed' : 'Apply by') : 'Interview'} — {job.title},{' '}
                {job.company}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Email reminders: opt-in, signed-in only, and honest when email is not set up. */
function Reminders({ signedIn, onSignIn }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    api
      .reminders()
      .then(setState)
      .catch(() => setState(null));
  }, [signedIn]);

  if (!signedIn) {
    return (
      <p className="reminder-note">
        Want an email the day before a deadline or interview?{' '}
        <button type="button" className="footer-link" onClick={onSignIn}>
          Sign in
        </button>{' '}
        to turn on reminders — or use <em>Add all to calendar</em>, which works without an account.
      </p>
    );
  }
  if (!state) return null;

  return (
    <div className="reminder-toggle">
      <label className="toggle-line">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            try {
              setState(await api.setReminders(e.target.checked));
            } finally {
              setBusy(false);
            }
          }}
        />
        <span>Email me the day before a deadline or interview</span>
      </label>
      {!state.available && (
        <div className="reminder-note">
          Email is not switched on for this site yet. Your choice is saved, and reminders start as soon as it is. Until
          then, <em>Add all to calendar</em> gives you phone reminders.
        </div>
      )}
    </div>
  );
}

function Job({ job, onStatus, onNote, onRemove, onDates }) {
  const [editing, setEditing] = useState(false);
  const [editingDates, setEditingDates] = useState(false);
  const [draft, setDraft] = useState(job.note || '');
  const next = NEXT[job.status];
  const selectId = `stage-${job.jobKey}`;

  return (
    <article className="job tracked">
      <div className="job-top">
        <div className="job-head">
          <div className="job-title">{job.title}</div>
          <div className="job-company">
            {job.company}
            {job.location ? ` · ${job.location}` : ''}
          </div>
        </div>
        <div className="job-badges">
          {job.remote && <span className="badge">remote</span>}
          {job.source && <span className="badge">{job.source}</span>}
        </div>
      </div>

      <DateChips job={job} />

      {job.note && !editing && <div className="job-desc tracked-note">{job.note}</div>}

      {editingDates && <DatesEditor job={job} onDates={onDates} onClose={() => setEditingDates(false)} />}

      {editing && (
        <div className="field spaced">
          <label htmlFor={`note-${job.jobKey}`}>Note — interview dates, contacts, deadlines</label>
          <textarea
            id={`note-${job.jobKey}`}
            rows={3}
            maxLength={500}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="row-links">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                onNote(job.jobKey, draft.trim());
                setEditing(false);
              }}
            >
              Save note
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setDraft(job.note || '');
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="row-links tracker-actions">
        {next && (
          <button type="button" className="link-btn primary" onClick={() => onStatus(job.jobKey, next)}>
            Move to {LABEL[next]} →
          </button>
        )}
        <label className="sr-only" htmlFor={selectId}>
          Stage for {job.title}
        </label>
        <select
          id={selectId}
          className="stage-select"
          value={job.status}
          onChange={(e) => onStatus(job.jobKey, e.target.value)}
        >
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <a className="link-btn" href={job.url} target="_blank" rel="noopener noreferrer">
          Posting ↗
        </a>
        {!editing && (
          <button type="button" className="link-btn" onClick={() => setEditing(true)}>
            {job.note ? 'Edit note' : '+ Note'}
          </button>
        )}
        {!editingDates && (
          <button type="button" className="link-btn" onClick={() => setEditingDates(true)}>
            {job.deadline || job.interviewAt ? 'Edit dates' : '+ Dates'}
          </button>
        )}
        {(job.deadline || job.interviewAt) && (
          <button
            type="button"
            className="link-btn"
            onClick={() => downloadIcs(eventsFor(job), 'internship-dates.ics')}
            aria-label={`Add ${job.title} dates to your calendar`}
          >
            Add to calendar ↓
          </button>
        )}
        <button
          type="button"
          className="link-btn"
          onClick={() => onRemove(job.jobKey)}
          aria-label={`Remove ${job.title} from the tracker`}
        >
          Remove
        </button>
      </div>

      <div className="row-meta">
        {stamp(job.createdAt) && <span>tracked {stamp(job.createdAt)}</span>}
        {job.updatedAt !== job.createdAt && stamp(job.updatedAt) && <span>updated {stamp(job.updatedAt)}</span>}
      </div>
    </article>
  );
}

// Where a pasted link came from, so the student does not have to say.
const SOURCES = [
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)joinhandshake\.com$/, 'Handshake'],
  [/(^|\.)indeed\.com$/, 'Indeed'],
  [/(^|\.)glassdoor\.com$/, 'Glassdoor'],
  [/(^|\.)wayup\.com$/, 'WayUp'],
  [/(^|\.)usajobs\.gov$/, 'USAJOBS'],
];
const SOURCE_OPTIONS = ['LinkedIn', 'Handshake', 'Indeed', 'Company website', 'Career fair or referral', 'Other'];

function sourceFor(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (SOURCES.find(([re]) => re.test(host)) || [])[1] || 'Company website';
  } catch {
    return '';
  }
}

/**
 * Adds an internship found anywhere else — LinkedIn, Handshake, a career fair —
 * so everything a student applies to is tracked in one place. Only a link,
 * title and company are required.
 */
function AddInternship({ jobs, onAdd, prefill = null, onPrefillUsed }) {
  // Filled in by the "Save to Elevate" browser extension; still needs a click.
  const [open, setOpen] = useState(Boolean(prefill));
  const [url, setUrl] = useState(prefill?.url || '');
  const [title, setTitle] = useState(prefill?.title || '');
  const [company, setCompany] = useState(prefill?.company || '');
  const [location, setLocation] = useState(prefill?.location || '');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('saved');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <div className="form-actions">
        <button type="button" className="btn small" onClick={() => setOpen(true)}>
          + Add an internship from LinkedIn, Handshake or anywhere
        </button>
      </div>
    );
  }

  const guessed = sourceFor(url.trim());
  const chosen = source || guessed || 'Other';

  const submit = async (e) => {
    e.preventDefault();
    const link = url.trim();
    if (!/^https?:\/\/\S+\.\S+/i.test(link)) return setError('Paste the full link to the posting, starting with https://');
    if (!title.trim()) return setError('Add the internship title.');
    if (!company.trim()) return setError('Add the company.');
    if (jobs.some((j) => j.jobKey === link)) return setError('That posting is already in your tracker.');
    setBusy(true);
    setError(null);
    // Used up now: adding the first internship swaps the empty tracker for the
    // list, which mounts a fresh form that must not reopen pre-filled.
    onPrefillUsed?.();
    try {
      await onAdd(
        {
          url: link,
          title: title.trim(),
          company: company.trim(),
          location: location.trim(),
          source: chosen,
          remote: /remote/i.test(location),
          deadline,
        },
        status,
      );
      setUrl('');
      setTitle('');
      setCompany('');
      setLocation('');
      setSource('');
      setStatus('saved');
      setDeadline('');
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card add-internship" onSubmit={submit} noValidate>
      <h2>Add an internship</h2>
      <p className="section-note">
        {prefill
          ? 'Filled in from the page you were on. Check the details, then press Add to tracker.'
          : 'Found it on LinkedIn, Handshake or a company site? Paste it here and track it with everything else.'}
      </p>
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="add-url">Link to the posting</label>
          <input
            id="add-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="https://www.linkedin.com/jobs/view/…"
            value={url}
            maxLength={500}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="add-title">Internship title</label>
          <input
            id="add-title"
            type="text"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Summer Finance Intern"
          />
        </div>
        <div className="field">
          <label htmlFor="add-company">Company</label>
          <input
            id="add-company"
            type="text"
            value={company}
            maxLength={160}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Acme Corp"
          />
        </div>
        <div className="field">
          <label htmlFor="add-location">Location — optional</label>
          <input
            id="add-location"
            type="text"
            value={location}
            maxLength={200}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Chicago, IL or Remote"
          />
        </div>
        <div className="field">
          <label htmlFor="add-source">Found it on</label>
          <select id="add-source" value={chosen} onChange={(e) => setSource(e.target.value)}>
            {[...new Set([...SOURCE_OPTIONS, guessed].filter(Boolean))].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="add-deadline">Apply by — optional</label>
          <input id="add-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="add-stage">Stage</label>
          <select id="add-stage" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="btn small" disabled={busy}>
          {busy ? 'Adding…' : 'Add to tracker'}
        </button>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            setOpen(false);
            onPrefillUsed?.();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function Tracker({ jobs, onStatus, onNote, onRemove, onGoFind, onAdd, onDates, signedIn, onSignIn, prefill = null, onPrefillUsed }) {
  if (!jobs) return <div className="empty">Loading your applications…</div>;

  if (jobs.length === 0) {
    return (
      <>
        <EmptyState
          title="No applications tracked yet"
          illustration="applications"
          action={
            <button type="button" className="btn" onClick={onGoFind}>
              Go to the Finder
            </button>
          }
        >
          Press <strong>Save</strong> on any internship in the Finder and it lands here — or add one you found on
          LinkedIn, Handshake or anywhere else below. Move it from Saved to Applied, Interviewing and Offer as things
          happen, and keep notes on dates and contacts.
        </EmptyState>
        <AddInternship jobs={jobs} onAdd={onAdd} prefill={prefill} onPrefillUsed={onPrefillUsed} />
      </>
    );
  }

  const count = (id) => jobs.filter((j) => j.status === id).length;

  return (
    <div>
      <div className="meter">
        <div className="meter-top">
          <div className="meter-count">
            {jobs.length} <span>internship{jobs.length === 1 ? '' : 's'} tracked</span>
          </div>
        </div>
        <ol className="stage-strip" aria-label="Applications by stage">
          {STAGES.map((s) => (
            <li key={s.id} className={count(s.id) ? 'on' : ''}>
              <span className="stage-num">{count(s.id)}</span>
              <span className="stage-label">{s.label}</span>
            </li>
          ))}
        </ol>
      </div>

      <AddInternship jobs={jobs} onAdd={onAdd} prefill={prefill} onPrefillUsed={onPrefillUsed} />

      <ComingUp jobs={jobs} />
      <Reminders signedIn={signedIn} onSignIn={onSignIn} />

      {STAGES.filter((s) => count(s.id) > 0).map((s) => (
        <section className="section" key={s.id}>
          <div className="section-head">
            <div>
              <h2>{s.label}</h2>
              <div className="section-note">{s.note}</div>
            </div>
            <div className="section-count">{count(s.id)}</div>
          </div>
          <Stagger>
            {jobs
              .filter((j) => j.status === s.id)
              // Soonest date first; undated ones after, most recently touched first.
              .sort((a, b) => {
                const da = nextDate(a);
                const db = nextDate(b);
                if (da && db) return da.localeCompare(db);
                if (da || db) return da ? -1 : 1;
                return String(b.updatedAt).localeCompare(String(a.updatedAt));
              })
              .map((job) => (
                <Job key={job.jobKey} job={job} onStatus={onStatus} onNote={onNote} onRemove={onRemove} onDates={onDates} />
              ))}
          </Stagger>
        </section>
      ))}
    </div>
  );
}
