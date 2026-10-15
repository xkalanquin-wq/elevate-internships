// /owner: visit counts and job-source status, for the site's operator only.
//
// Plain server-rendered HTML with no JavaScript, like the content pages, and
// never indexed. The passcode form posts back to the same address; a correct
// passcode starts the same owner session /api/health/detail uses.

import fs from 'node:fs';
import path from 'node:path';
import { PREMIUM_ENABLED } from './features.js';
import { esc } from './html.js';

const STYLE = `<style>
.owner-grid{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));margin-top:24px}
.owner-kpis{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0 8px}
.owner-kpi{border:1px solid var(--rule);border-radius:var(--radius);background:var(--surface);padding:12px 16px;min-width:130px}
.owner-kpi b{display:block;font-size:26px;line-height:1.1;font-family:var(--font-mono)}
.owner-kpi span{font-size:13px;color:var(--muted)}
.owner table{width:100%;border-collapse:collapse;font-size:14px}
.owner th,.owner td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
.owner td.n,.owner th.n{text-align:right;font-variant-numeric:tabular-nums}
.owner td.path{word-break:break-all}
.owner .bar{display:inline-block;height:8px;border-radius:4px;background:var(--accent);vertical-align:middle;margin-right:6px}
.owner .bad{color:var(--amber);font-weight:600}
.owner .ok{color:var(--ink);font-weight:600}
.owner .note{font-size:13px;color:var(--muted);max-width:70ch}
.owner form.inline{display:inline}
.owner-login{max-width:420px;margin-top:24px}
.owner-login input{width:100%;min-height:44px;margin:6px 0 12px;padding:8px 10px;font:inherit;border:1px solid var(--field-border);border-radius:var(--radius);background:var(--surface);color:var(--ink)}
</style>`;

/** A plain, script-free, never-indexed page in the site's style. */
export function page(dist, title, body) {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta\s+name="robots"[^>]*>/, '')
    .replace('</head>', `<meta name="robots" content="noindex, nofollow">\n${STYLE}\n</head>`)
    .replace(/<script type="module"[^>]*><\/script>\s*/g, '')
    .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
    .replace(
      '<div id="root"></div>',
      `<div class="wrap static-page owner">
<header class="static-head"><a class="static-brand" href="/">Elevate Internships</a><nav class="static-nav" aria-label="Main"><a href="/">Back to the site</a></nav></header>
<main id="main">${body}</main>
</div>`,
    );
}

export function renderLogin(dist, { error = '', configured = true } = {}) {
  const body = configured
    ? `<h1>Owner</h1>
<form class="owner-login" method="post" action="/owner">
  <label for="passcode">Owner passcode</label>
  <input id="passcode" name="passcode" type="password" autocomplete="current-password" required autofocus>
  ${error ? `<p class="bad" role="alert">${esc(error)}</p>` : ''}
  <button class="btn" type="submit">Unlock</button>
</form>`
    : `<h1>Owner</h1><p>No <code>OWNER_PASSCODE</code> is set on the server, so this page only opens on the machine running it.</p>`;
  return page(dist, 'Owner — Elevate Internships', body);
}

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const day = (iso) => (iso ? String(iso).slice(0, 10) : '—');

const pct = (n, of) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—');

/** How many people who see Premium go on to pay, over the last 30 days. */
function funnelSection(f) {
  if (!f) return '';
  const kept = f.paid - f.refunded;
  return `<h2 style="margin-top:24px">Premium funnel</h2>
<p class="note">Last 30 days. A step's percentage is out of the step before it.</p>
<table><thead><tr><th>Step</th><th class="n">Count</th><th class="n">Rate</th></tr></thead><tbody>
<tr><td>Premium page loaded</td><td class="n">${f.pageLoads}</td><td class="n"></td></tr>
<tr><td>Payment page opened <span class="note">(from Account, signed in)</span></td><td class="n">${f.checkouts}</td><td class="n">${pct(f.checkouts, f.pageLoads)}</td></tr>
<tr><td>Paid${f.refunded ? ` <span class="note">(${f.refunded} since refunded)</span>` : ''}</td><td class="n">${f.paid}</td><td class="n">${pct(f.paid, f.checkouts)}</td></tr>
</tbody></table>
<p class="note">Of every 100 Premium page loads, ${f.pageLoads > 0 ? (Math.round((kept / f.pageLoads) * 1000) / 10).toString() : '—'} ended in a sale that was kept. Someone can reach the payment page from Account without loading the Premium page, and clicks within two minutes reuse one payment page but are counted each time, so treat the rates as a guide.</p>`;
}

/** Sales, referral codes, notifications and the sponsored listings queue. */
function commerceSection(c) {
  if (!c) return '';
  const premium = c.sales.byKind.premium || { sales: 0, refunds: 0, netCents: 0 };
  const sponsor = c.sales.byKind.sponsor || { sales: 0, refunds: 0, netCents: 0 };
  // Premium switched off (server/features.js): no funnel or Premium column.
  // Its sales figures still show if a Premium payment is on record, so one
  // that arrives anyway can be seen and refunded.
  const showPremiumSales = PREMIUM_ENABLED || premium.sales > 0;
  const refs = [...new Set([...Object.keys(c.signupsByRef), ...Object.keys(c.sales.premiumByRef)])].sort();
  const refTable = refs.length
    ? `<table><thead><tr><th>Code</th><th class="n">Sign-ups</th>${PREMIUM_ENABLED ? '<th class="n">Premium</th>' : ''}</tr></thead><tbody>${refs
        .map((r) => `<tr><td>${esc(r)}</td><td class="n">${c.signupsByRef[r] || 0}</td>${PREMIUM_ENABLED ? `<td class="n">${c.sales.premiumByRef[r] || 0}</td>` : ''}</tr>`)
        .join('')}</tbody></table>`
    : '<p class="note">No sign-ups through a referral link yet.</p>';

  const action = (s, what, label, cls = '') =>
    `<form class="inline" method="post" action="/owner/sponsored/${s.id}/${what}"><button class="btn small ${cls}" type="submit">${label}</button></form>`;
  const rows = c.sponsored
    .map((s) => {
      const buttons =
        s.status === 'pending'
          ? `${action(s, 'approve', 'Approve')} ${action(s, 'reject', 'Reject and refund', 'ghost')}`
          : s.status === 'live'
            ? action(s, 'end', 'End early', 'ghost')
            : '';
      return `<tr><td><strong>${esc(s.title)}</strong><br>${esc(s.company)} · ${esc(s.location || '')}<br><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(
        s.url.slice(0, 60),
      )}</a><br><span class="note">${esc(s.majors.join(', '))} · ${esc(s.contact_email)}</span></td><td class="${s.status === 'pending' ? 'bad' : 'ok'}">${esc(
        s.status,
      )}<br><span class="note">paid ${day(s.paid_at)}${s.ends_at ? `<br>until ${day(s.ends_at)}` : ''}</span></td><td class="n">${s.impressions}</td><td class="n">${s.clicks}</td><td>${buttons}</td></tr>`;
    })
    .join('');
  const sponsoredTable = rows
    ? `<table><thead><tr><th>Listing</th><th>Status</th><th class="n">Shown</th><th class="n">Clicks</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="note">No sponsored listings yet.</p>';

  return `<section style="margin-top:32px" id="sponsored"><h2>Sales</h2>
${c.message ? `<p class="ok" role="status">${esc(c.message)}</p>` : ''}
${c.payments ? '' : '<p class="bad">Payments are off: STRIPE_SECRET_KEY is not set on the server.</p>'}
<div class="owner-kpis">
${
  showPremiumSales
    ? `  <div class="owner-kpi"><b>${premium.sales}</b><span>Premium sold${premium.refunds ? `, ${premium.refunds} refunded` : ''}</span></div>
  <div class="owner-kpi"><b>${money(premium.netCents)}</b><span>Premium, before Stripe fees</span></div>
`
    : ''
}  <div class="owner-kpi"><b>${sponsor.sales}</b><span>sponsored listings sold</span></div>
  <div class="owner-kpi"><b>${money(sponsor.netCents)}</b><span>listings, before Stripe fees</span></div>
  <div class="owner-kpi"><b>${c.pushDevices}</b><span>browsers with notifications on</span></div>
</div>
<p class="note">Stripe's dashboard has the full record, including fees and payouts. A refund made there is reflected here automatically when the webhook is set up.</p>
${PREMIUM_ENABLED ? funnelSection(c.funnel) : ''}
<h2 style="margin-top:24px">Sponsored listings</h2>
<p class="note">Check that each one is a real, paid internship for business students before approving. Approving starts its 30 days. Rejecting refunds the employer in full through Stripe and emails them.</p>
${sponsoredTable}
<h2 style="margin-top:24px">Referral codes</h2>
<p class="note">Give each campus ambassador a link like <code>elevateinternships.com/?ref=uconn-jamie</code>. Visits from it show above as <code>ref:uconn-jamie</code>; sign-ups${PREMIUM_ENABLED ? ' and Premium purchases' : ''} are counted here.</p>
${refTable}
</section>`;
}

/** Live version, daily caps and recent errors. */
function healthSection(h) {
  if (!h) return '';
  const caps = h.limits
    .map((l) => `<tr><td>${esc(l.name)}</td><td class="n ${l.used >= l.cap ? 'bad' : ''}">${l.used} / ${l.cap}</td></tr>`)
    .join('');
  const errors = h.errors.length
    ? `<table><thead><tr><th>Error</th><th class="n">Times</th><th>Last</th></tr></thead><tbody>${h.errors
        .slice(0, 25)
        .map(
          (e) =>
            `<tr><td><span class="note">${esc(e.source)}</span> ${esc(e.message)}</td><td class="n">${e.count}</td><td>${esc(e.last.replace('T', ' ').slice(0, 16))} UTC</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="note">No errors recorded.</p>';
  return `<section style="margin-top:32px" id="health"><h2>Site health</h2>
<p class="note">Version <code>${esc(h.version)}</code>, running since ${esc(h.startedAt.replace('T', ' ').slice(0, 16))} UTC.</p>
<h3>Today's use of capped services</h3>
<p class="note">Caps keep each service inside its free allowance (Adzuna 250 a day, Resend 100 a day) or bound its cost (suggestions). They reset at midnight UTC.</p>
<table><thead><tr><th>Service</th><th class="n">Used / cap</th></tr></thead><tbody>${caps}</tbody></table>
<h3 style="margin-top:20px">Recent errors</h3>
<p class="note">From the server and from visitors' browsers; repeats are counted. A few job-board timeouts are normal.</p>
${errors}
</section>`;
}

export function renderOwner(dist, { visits, sources, showLogout, commerce = null, health = null }) {
  const t = visits.totals;
  const maxDay = Math.max(1, ...visits.days.map((d) => d.visits));
  const bar = (n, max) => `<span class="bar" style="width:${Math.round((n / max) * 80)}px"></span>`;

  // The last two weeks; the 30-day totals above cover the rest.
  const days = visits.days
    .slice(0, 14)
    .map((d) => `<tr><td>${esc(d.day)}</td><td class="n">${bar(d.visits, maxDay)}${d.visits}</td><td class="n">${d.views}</td></tr>`)
    .join('');
  const list = (rows, label) =>
    rows.length
      ? `<table><thead><tr><th>${label}</th><th class="n">Count</th></tr></thead><tbody>${rows
          .map(([k, n]) => `<tr><td class="path">${esc(k)}</td><td class="n">${n}</td></tr>`)
          .join('')}</tbody></table>`
      : '<p class="note">None yet.</p>';

  const srcRows = Object.entries(sources);
  const sourceTable = srcRows.length
    ? `<table><thead><tr><th>Source</th><th>Status</th><th>Last worked</th></tr></thead><tbody>${srcRows
        .map(
          ([name, s]) =>
            `<tr><td>${esc(name)}${s.alerts ? '' : ' <span class="note">(no alert)</span>'}</td><td class="${
              s.status === 'ok' ? 'ok' : 'bad'
            }">${esc(s.status)}${s.error ? `<br><span class="note">${esc(s.error)}</span>` : ''}</td><td>${esc(
              s.lastWorked ? s.lastWorked.replace('T', ' ').slice(0, 16) + ' UTC' : 'never',
            )}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="note">Nothing recorded since the server last started. Run a search, or wait for the next check.</p>';

  const body = `<h1>Owner</h1>
<div class="owner-kpis">
  <div class="owner-kpi"><b>${t.visits7}</b><span>visits, last 7 days</span></div>
  <div class="owner-kpi"><b>${t.visits30}</b><span>visits, last 30 days</span></div>
  <div class="owner-kpi"><b>${t.views30}</b><span>pages loaded, 30 days</span></div>
</div>
<p class="note">Counted by this server: no cookies, no IP addresses, no outside service. Bots, uptime checks and your own
visits while unlocked are left out. A visit is a page load that did not come from another page of this site; moving
between tabs in the app does not load a page. Days are in UTC. To see where a shared link brings people, add
<code>?utm_source=handshake</code> (or any word) to it.</p>
<div class="owner-grid">
  <section><h2>Where visitors came from</h2><p class="note">Last 30 days</p>${list(visits.sources, 'Site')}</section>
  <section><h2>Pages loaded</h2><p class="note">Last 30 days</p>${list(visits.pages, 'Page')}</section>
</div>
<section style="margin-top:32px"><h2>Job sources and email</h2>
<p class="note">Latest result for each since the server last started. Adzuna, USAJOBS and email send an alert through
UptimeRobot after two failures in a row.</p>${sourceTable}</section>
${commerceSection(commerce)}
${healthSection(health)}
<section style="margin-top:32px"><h2>By day</h2><p class="note">Last 14 days</p><table><thead><tr><th>Day</th><th class="n">Visits</th><th class="n">Pages</th></tr></thead><tbody>${days}</tbody></table></section>
${showLogout ? '<form class="inline" method="post" action="/owner/logout" style="margin-top:24px;display:block"><button class="btn btn-ghost" type="submit">Lock this page</button></form>' : ''}`;
  return page(dist, 'Owner — Elevate Internships', body);
}
