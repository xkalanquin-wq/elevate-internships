// Reminder emails: "your deadline is tomorrow" and "your interview is tomorrow".
//
// Opt-in per account: by email (users.remind_email, only when the server has
// an email provider) and as a notification on any browser the person turned
// notifications on in (server/push.js). Each person gets at most one reminder
// per check, listing everything due tomorrow, and each item is only reminded
// once.
//
// "Tomorrow" is judged in the person's own time zone, which the browser sends
// along with the dates. Emails go out from 8am local time onward.
//
// Caveat worth knowing: the check runs inside the web server. On a host that
// sleeps when idle, nothing is sent while it sleeps; the next check runs a
// couple of minutes after it wakes.

const CHECK_EVERY_MS = 60 * 60_000;
const FIRST_CHECK_MS = 2 * 60_000;
const SEND_FROM_HOUR = 8;
const FALLBACK_TZ = 'America/New_York';

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Today's date and the current hour, as seen in a time zone. */
function localNow(now, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

function nextDay(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function timeLabel(interviewAt) {
  const [h, m] = interviewAt.slice(11, 16).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** What is due tomorrow for one person, and not yet reminded. */
export function dueTomorrow(jobs, now = new Date()) {
  const due = [];
  for (const job of jobs) {
    if (job.status === 'closed') continue;
    const tz = job.tz && isValidTimeZone(job.tz) ? job.tz : FALLBACK_TZ;
    const local = localNow(now, tz);
    if (local.hour < SEND_FROM_HOUR) continue;
    const tomorrow = nextDay(local.date);

    // A deadline only matters until you have applied.
    if (job.status === 'saved' && job.deadline === tomorrow && job.remindedDeadline !== job.deadline) {
      due.push({ job, kind: 'deadline' });
    }
    if (job.interviewAt && job.interviewAt.slice(0, 10) === tomorrow && job.remindedInterview !== job.interviewAt) {
      due.push({ job, kind: 'interview' });
    }
  }
  return due;
}

function composeEmail(due, siteUrl) {
  const lines = due.map(({ job, kind }) =>
    kind === 'deadline'
      ? `• Apply by tomorrow: ${job.title} — ${job.company}\n  ${job.url}`
      : `• Interview tomorrow at ${timeLabel(job.interviewAt)}: ${job.title} — ${job.company}\n  ${job.url}`,
  );
  const deadlines = due.filter((d) => d.kind === 'deadline').length;
  const interviews = due.length - deadlines;
  const subject =
    interviews && deadlines
      ? `Tomorrow: ${interviews} interview${interviews === 1 ? '' : 's'} and ${deadlines} deadline${deadlines === 1 ? '' : 's'}`
      : interviews
        ? `Tomorrow: ${interviews === 1 ? 'an interview' : `${interviews} interviews`}`
        : `Tomorrow: ${deadlines === 1 ? 'an application deadline' : `${deadlines} application deadlines`}`;

  const text = [
    'Coming up tomorrow:',
    '',
    ...lines,
    '',
    `Your applications: ${siteUrl}/`,
    '',
    'You are getting this because you turned on reminders in the Applications tab of Elevate Internships.',
    'Turn them off there at any time.',
  ].join('\n');
  return { subject, text };
}

/** The same reminder as a phone or desktop notification. */
export function composePush(due) {
  const first = due[0];
  const title =
    due.length > 1
      ? `Tomorrow: ${due.length} things due`
      : first.kind === 'deadline'
        ? 'Application due tomorrow'
        : `Interview tomorrow at ${timeLabel(first.job.interviewAt)}`;
  const body = due
    .slice(0, 3)
    .map(({ job, kind }) => `${kind === 'deadline' ? 'Apply' : 'Interview'}: ${job.title} — ${job.company}`)
    .join('\n');
  return { title, body, url: '/?tab=tracker', tag: 'reminders' };
}

/**
 * Sends each person one reminder a day covering everything due tomorrow: by
 * email if they turned reminder emails on, and as a notification on every
 * browser they turned notifications on in. An item counts as reminded once
 * either one gets through.
 */
export async function runReminders({ store, sendMail, emailConfigured, siteUrl, sendPush = null }, now = new Date()) {
  const byEmail = emailConfigured() ? store.usersWantingReminders() : [];
  const byPush = sendPush ? store.usersWithPush() : [];
  if (!byEmail.length && !byPush.length) {
    return { sent: 0, pushed: 0, skipped: emailConfigured() || sendPush ? 'nobody to remind' : 'no email provider' };
  }
  const people = new Map();
  for (const u of byEmail) people.set(u.id, { ...u, mail: true });
  for (const u of byPush) people.set(u.id, { ...(people.get(u.id) || u), push: true });

  let sent = 0;
  let pushed = 0;
  for (const user of people.values()) {
    const due = dueTomorrow(store.getTracked(user.id), now);
    if (!due.length) continue;
    let delivered = false;
    if (user.mail) {
      const { subject, text } = composeEmail(due, siteUrl.replace(/\/+$/, ''));
      const result = await sendMail({ to: user.email, subject, text, bulk: true });
      if (result.delivered) {
        delivered = true;
        sent += 1;
      }
    }
    if (user.push && (await sendPush(user.id, composePush(due))) > 0) {
      delivered = true;
      pushed += 1;
    }
    if (!delivered) continue; // try again at the next check
    for (const { job, kind } of due) {
      const payload = kind === 'deadline' ? { remindedDeadline: job.deadline } : { remindedInterview: job.interviewAt };
      store.upsertTracked(user.id, job.jobKey, { payload, touch: false });
    }
  }
  if (sent) console.log(`[reminders] sent ${sent} reminder email${sent === 1 ? '' : 's'}`);
  if (pushed) console.log(`[reminders] sent ${pushed} reminder notification${pushed === 1 ? '' : 's'}`);
  return { sent, pushed };
}

export function startReminders(deps) {
  const run = () =>
    runReminders(deps).catch((err) => console.error(`[reminders] FAILED: ${err?.message || err}`));
  setTimeout(run, FIRST_CHECK_MS).unref?.();
  setInterval(run, CHECK_EVERY_MS).unref?.();
}
