// "Add to calendar" for application deadlines and interviews.
//
// Builds a standard .ics file in the browser and downloads it — Google
// Calendar, Outlook and Apple Calendar all open it. Nothing is sent anywhere,
// and each event carries its own reminder, so this works as a free reminder
// service with no email involved.

const pad = (n) => String(n).padStart(2, '0');

/** Text fields in iCalendar escape backslashes, commas, semicolons and newlines. */
const esc = (s) =>
  String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

/** Lines longer than 75 octets must be folded; a leading space continues them. */
const fold = (line) => {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
};

const stampUtc = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

const dateOnly = (ymd) => ymd.replace(/-/g, '');

function nextDay(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Every calendar event one tracked internship has: its deadline and its interview. */
export function eventsFor(job) {
  const events = [];
  const link = job.url ? `\n${job.url}` : '';
  if (job.deadline) {
    events.push({
      uid: `deadline-${job.deadline}-${job.jobKey}`,
      allDay: true,
      start: job.deadline,
      summary: `Apply by today: ${job.title} — ${job.company}`,
      description: `Application deadline for ${job.title} at ${job.company}.${link}`,
      // An all-day event starts at midnight; this fires at 9am the day before.
      alarm: '-PT15H',
    });
  }
  if (job.interviewAt) {
    events.push({
      uid: `interview-${job.interviewAt}-${job.jobKey}`,
      allDay: false,
      start: job.interviewAt,
      summary: `Interview: ${job.title} — ${job.company}`,
      description: `Interview for ${job.title} at ${job.company}.${job.note ? `\n${job.note}` : ''}${link}`,
      location: job.location || '',
      alarm: '-PT1H',
    });
  }
  return events;
}

export function buildIcs(events) {
  const now = stampUtc(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Elevate Internships//Applications//EN', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${esc(e.uid.replace(/[^\w.-]+/g, '-').slice(0, 180))}@elevateinternships.com`);
    lines.push(`DTSTAMP:${now}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.start)}`);
      lines.push(`DTEND;VALUE=DATE:${dateOnly(nextDay(e.start))}`);
    } else {
      // "Floating" local time: the interview is at 2pm wherever the calendar is.
      const [d, t] = e.start.split('T');
      lines.push(`DTSTART:${dateOnly(d)}T${t.replace(':', '')}00`);
      lines.push('DURATION:PT1H');
    }
    lines.push(`SUMMARY:${esc(e.summary)}`);
    lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.summary)}`, `TRIGGER:${e.alarm}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(events, filename) {
  const blob = new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
