// Phone and desktop notifications (the Web Push standard).
//
// Free to run: the browser maker's push service (Google, Apple, Mozilla,
// Microsoft) delivers them, with no account, no per-message cost and no daily
// limit. That is why alerts go out this way rather than by email, which is
// capped at 100 a day on the free plan.
//
// Two kinds are sent:
//   - the day-before reminder for a deadline or interview (server/reminders.js),
//     for anyone who turns notifications on;
//   - Premium's daily "new internships for your search" alert, below.
//
// The signing keys (VAPID) are made on first start and kept in the database,
// so there is nothing to set up. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY override
// them if you ever need to move to fixed keys.

import webpush from 'web-push';
import { pickNew } from './digest.js';
import { open as unseal, seal } from './seal.js';

const CHECK_EVERY_MS = 60 * 60_000;
const FIRST_CHECK_MS = 4 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
// Sent from 9am to 8pm US Eastern, like the weekly email.
const SEND_HOURS = [9, 20];
const TZ = 'America/New_York';
const REMEMBER = 600;
const MIN_LISTINGS = 200;

export function createPush({ store, contactEmail, siteUrl }) {
  let keys = null;

  function vapid() {
    if (keys) return keys;
    const envPub = String(process.env.VAPID_PUBLIC_KEY || '').trim();
    const envPriv = String(process.env.VAPID_PRIVATE_KEY || '').trim();
    if (envPub && envPriv) {
      keys = { publicKey: envPub, privateKey: envPriv };
      return keys;
    }
    // Kept encrypted in the database (server/seal.js).
    const stored = store.getMeta('vapid.v1');
    try {
      const saved = JSON.parse(unseal(stored) || 'null');
      if (saved?.publicKey && saved?.privateKey) {
        keys = saved;
        // Saved before encryption was on: encrypt it now.
        if (stored && !stored.startsWith('enc:')) store.setMeta('vapid.v1', seal(JSON.stringify(keys)));
      }
    } catch {
      /* unreadable: make new ones below */
    }
    if (!keys) {
      keys = webpush.generateVAPIDKeys();
      store.setMeta('vapid.v1', seal(JSON.stringify(keys)));
      console.log('[push] created notification signing keys');
    }
    return keys;
  }

  // Push services contact this address if a sender misbehaves.
  const subject = () => {
    const email = contactEmail();
    if (email) return `mailto:${email}`;
    const site = String(siteUrl || '');
    return /^https:\/\//.test(site) ? site : 'https://elevateinternships.com';
  };

  const publicKey = () => vapid().publicKey;

  /**
   * Sends one notification to every browser a person turned notifications on
   * in. Subscriptions the push service says are gone are deleted. Returns how
   * many browsers accepted it.
   */
  async function sendToUser(userId, { title, body, url = '/', tag }) {
    const subs = store.pushSubsFor(userId);
    if (!subs.length) return 0;
    const { publicKey: pub, privateKey } = vapid();
    const payload = JSON.stringify({ title, body, url, tag });
    let delivered = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, payload, {
          vapidDetails: { subject: subject(), publicKey: pub, privateKey },
          TTL: 24 * 60 * 60,
          timeout: 15_000,
        });
        delivered += 1;
      } catch (err) {
        // 404 and 410 mean the person turned notifications off or the
        // browser dropped the subscription; either way it will never work again.
        if (err?.statusCode === 404 || err?.statusCode === 410) store.removePushSub(sub.endpoint);
        else console.warn(`[push] send failed (${err?.statusCode || 'no status'}): ${String(err?.body || err?.message || err).slice(0, 160)}`);
      }
    }
    return delivered;
  }

  return { publicKey, sendToUser };
}

// ---- Premium: daily new-internship alert ---------------------------------------

function easternHour(now) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now)) % 24;
}

export function composeAlert(jobs, search) {
  const where = search.place ? `${search.place.city}, ${search.place.state}` : search.zip;
  const what = search.major ? `${search.major} ` : '';
  const n = jobs.length;
  return {
    title: `${n} new ${what}internship${n === 1 ? '' : 's'} near ${where}`,
    body: jobs
      .slice(0, 2)
      .map((j) => `${j.title} — ${j.company}`)
      .join('\n') + (n > 2 ? `\n+${n - 2} more` : ''),
    url: '/account#alerts',
    tag: 'daily-alert',
  };
}

export async function runAlerts({ store, push, cachedListings, rankJobs }, now = new Date()) {
  const hour = easternHour(now);
  if (hour < SEND_HOURS[0] || hour > SEND_HOURS[1]) return { sent: 0, skipped: 'outside sending hours' };
  const listings = cachedListings();
  if (listings.length < MIN_LISTINGS) return { sent: 0, skipped: 'listings still loading' };

  let sent = 0;
  for (const user of store.usersWantingAlerts(now)) {
    const state = user.state || {};
    if (state.lastRunAt && now - new Date(state.lastRunAt) < DAY_MS - CHECK_EVERY_MS) continue;
    const search = store.getSearches(user.id)[0];
    if (!search?.origin) continue;
    if (!store.countPushSubs(user.id)) continue;

    const { jobs: ranked } = rankJobs(listings.map((j) => ({ ...j })), search);
    const jobs = pickNew(ranked, state.seen, now);
    if (!jobs.length) {
      store.setUserFields(user.id, { alert_state: JSON.stringify({ ...state, lastRunAt: now.toISOString() }) });
      continue;
    }
    const delivered = await push.sendToUser(user.id, composeAlert(jobs, search));
    if (!delivered) continue; // tried again at the next check
    sent += 1;
    store.setUserFields(user.id, {
      alert_state: JSON.stringify({
        ...state,
        lastRunAt: now.toISOString(),
        lastSentAt: now.toISOString(),
        seen: [...jobs.map((j) => j.id), ...(state.seen || [])].slice(0, REMEMBER),
        // Shown on the account page, which is where the notification opens.
        lastJobs: jobs.map((j) => ({
          title: j.title,
          company: j.company,
          location: j.remote ? 'Remote' : j.location,
          url: j.url,
          source: j.source,
        })),
      }),
    });
  }
  if (sent) console.log(`[alerts] sent ${sent} daily alert${sent === 1 ? '' : 's'}`);
  return { sent };
}

export function startAlerts(deps) {
  const run = () => runAlerts(deps).catch((err) => console.error(`[alerts] FAILED: ${err?.message || err}`));
  setTimeout(run, FIRST_CHECK_MS).unref?.();
  setInterval(run, CHECK_EVERY_MS).unref?.();
}
