// The weekly "new internships for you" email.
//
// Opt-in per account (users.digest_email), only to confirmed addresses, and
// only when the server has an email provider. It re-runs the person's most
// recent search against the listings the server already holds in memory —
// the employer boards, Simplify and Himalayas — so it costs no request to
// any job board, and no Adzuna or USAJOBS quota. Listings already sent are
// remembered, so each email only has ones the person has not seen from us.
//
// No new listings, no email: a week with nothing new is skipped, not padded.
//
// Resend's free plan sends 100 emails a day, shared with password resets and
// reminders, so at most MAX_PER_RUN go out per hourly check.

import crypto from 'node:crypto';
import { esc } from './html.js';

const CHECK_EVERY_MS = 60 * 60_000;
const FIRST_CHECK_MS = 3 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;
// Sent from 9am to 8pm US Eastern; nobody wants a job list at 3am.
const SEND_HOURS = [9, 20];
const TZ = 'America/New_York';
const MAX_PER_RUN = 15;
const MAX_JOBS = 10;
const MAX_REMOTE = 3;
const REMEMBER = 600;
// Right after a restart the shared listings are still loading. An email built
// from half of them would miss things and then remember what it did send.
const MIN_LISTINGS = 200;

export const newUnsubToken = () => crypto.randomBytes(24).toString('base64url');

function easternHour(now) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now)) % 24;
}

/** The listings worth sending: new to this person, recent, mostly within reach. */
export function pickNew(ranked, seen, now = new Date()) {
  const known = new Set(seen || []);
  const fresh = ranked.filter((j) => {
    if (known.has(j.id)) return false;
    if (!j.postedAt) return true;
    return now - new Date(j.postedAt) < 21 * 24 * 60 * 60_000;
  });
  const local = fresh.filter((j) => !j.remote);
  const remote = fresh.filter((j) => j.remote).slice(0, MAX_REMOTE);
  return [...local, ...remote].slice(0, MAX_JOBS);
}

export function composeDigest({ jobs, search, siteUrl, unsubUrl }) {
  const where = search.place ? `${search.place.city}, ${search.place.state}` : search.zip;
  const what = search.major ? `${search.major} ` : '';
  const subject = `${jobs.length} new ${what}internship${jobs.length === 1 ? '' : 's'} near ${where}`;
  // Some employers list a dozen cities in one line.
  const place = (j) => {
    const p = j.remote ? 'Remote' : String(j.location || '');
    // Cut back to the last whole place: "Houston, TX; Des Mo" -> "Houston, TX…"
    return p.length > 60 ? `${p.slice(0, 57).replace(/\s*;[^;]*$/, '')}…` : p;
  };

  const text = [
    `New since last week, for your search: ${what}internships within ${search.radiusMiles} miles of ${where}.`,
    '',
    ...jobs.flatMap((j) => [`• ${j.title} — ${j.company}${place(j) ? ` (${place(j)})` : ''}`, `  ${j.url}`]),
    '',
    `Search again or change your search: ${siteUrl}/`,
    '',
    'You are getting this because you turned on the weekly email in Elevate Internships.',
    `Turn it off: ${unsubUrl}`,
  ].join('\n');

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:600px">
<p>New since last week, for your search: <strong>${esc(what)}internships within ${esc(search.radiusMiles)} miles of ${esc(where)}</strong>.</p>
<ul style="padding-left:18px">${jobs
    .map(
      (j) =>
        `<li style="margin-bottom:10px"><a href="${esc(j.url)}" style="color:#1e3a5f;font-weight:600">${esc(j.title)}</a><br>${esc(j.company)}${
          place(j) ? ` · ${esc(place(j))}` : ''
        }</li>`,
    )
    .join('')}</ul>
<p><a href="${esc(siteUrl)}/" style="color:#1e3a5f">Search again or change your search</a></p>
<p style="font-size:13px;color:#475569">You are getting this because you turned on the weekly email in Elevate Internships.
<a href="${esc(unsubUrl)}" style="color:#475569">Turn it off</a>.</p>
</div>`;
  return { subject, text, html };
}

export async function runDigest({ store, sendMail, emailConfigured, siteUrl, cachedListings, rankJobs }, now = new Date()) {
  if (!emailConfigured()) return { sent: 0, skipped: 'no email provider' };
  const hour = easternHour(now);
  if (hour < SEND_HOURS[0] || hour > SEND_HOURS[1]) return { sent: 0, skipped: 'outside sending hours' };
  const listings = cachedListings();
  if (listings.length < MIN_LISTINGS) return { sent: 0, skipped: 'listings still loading' };

  const base = String(siteUrl || '').replace(/\/+$/, '');
  let sent = 0;
  let checked = 0;
  for (const user of store.usersWantingDigest()) {
    if (sent >= MAX_PER_RUN) break;
    const state = user.state || {};
    if (state.lastRunAt && now - new Date(state.lastRunAt) < WEEK_MS - CHECK_EVERY_MS) continue;
    const search = store.getSearches(user.id)[0];
    if (!search?.origin) continue; // nothing to go on until they search

    checked += 1;
    const { jobs: ranked } = rankJobs(listings.map((j) => ({ ...j })), search);
    const jobs = pickNew(ranked, state.seen, now);
    const unsub = state.unsub || newUnsubToken();

    if (jobs.length === 0) {
      store.setDigestState(user.id, { ...state, unsub, lastRunAt: now.toISOString() });
      continue;
    }
    const mail = composeDigest({ jobs, search, siteUrl: base, unsubUrl: `${base}/unsubscribe?t=${unsub}` });
    const result = await sendMail({
      to: user.email,
      ...mail,
      bulk: true,
      headers: {
        'List-Unsubscribe': `<${base}/unsubscribe?t=${unsub}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    if (!result.delivered) continue; // tried again at the next check
    sent += 1;
    store.setDigestState(user.id, {
      ...state,
      unsub,
      lastRunAt: now.toISOString(),
      lastSentAt: now.toISOString(),
      seen: [...jobs.map((j) => j.id), ...(state.seen || [])].slice(0, REMEMBER),
    });
  }
  if (sent) console.log(`[digest] sent ${sent} weekly email${sent === 1 ? '' : 's'}`);
  return { sent, checked };
}

export function startDigest(deps) {
  const run = () => runDigest(deps).catch((err) => console.error(`[digest] FAILED: ${err?.message || err}`));
  setTimeout(run, FIRST_CHECK_MS).unref?.();
  setInterval(run, CHECK_EVERY_MS).unref?.();
}
