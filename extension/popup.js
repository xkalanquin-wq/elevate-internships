// Save to Elevate Internships.
//
// When the popup opens, it reads the job title, company and location from the
// page in the current tab (activeTab: only that tab, only when clicked), shows
// them for editing, and opens Elevate Internships with them in the address:
// /?add=1&url=…&title=…&company=…&location=…  The site opens the tracker's Add
// form filled in; nothing is saved until the person presses Add there.
//
// The extension stores nothing and sends nothing anywhere else.

const SITE = 'https://elevateinternships.com';
const $ = (id) => document.getElementById(id);
let pageUrl = '';

/** Runs inside the job page. Must be self-contained. */
function extractJob() {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const out = {};
  const isJob = (t) => [].concat(t || []).includes('JobPosting');
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try {
      data = JSON.parse(el.textContent);
    } catch {
      continue;
    }
    const items = [].concat(data).flatMap((d) => (d && d['@graph'] ? d['@graph'] : [d]));
    const job = items.find((i) => i && isJob(i['@type']));
    if (!job) continue;
    out.fromLd = true;
    out.title = clean(job.title);
    const org = [].concat(job.hiringOrganization || [])[0];
    out.company = clean(typeof org === 'string' ? org : org?.name);
    if (String(job.jobLocationType || '').toUpperCase() === 'TELECOMMUTE') {
      out.location = 'Remote';
    } else {
      const place = [].concat(job.jobLocation || [])[0];
      const a = place?.address || {};
      out.location = clean([a.addressLocality, a.addressRegion].filter((x) => typeof x === 'string').join(', '));
    }
    break;
  }
  if (!out.title) {
    out.title = clean(document.querySelector('meta[property="og:title"]')?.content || document.querySelector('h1')?.innerText || document.title);
  }
  if (!out.company) out.company = clean(document.querySelector('meta[property="og:site_name"]')?.content);
  return out;
}

/** "Finance Intern | Acme | LinkedIn" -> title "Finance Intern", company "Acme". */
function tidy(info) {
  const t = { ...info };
  // A posting's own structured data is already clean.
  if (t.fromLd) return t;
  const boards = /^(linkedin|indeed|glassdoor|handshake|ziprecruiter|careers?|jobs?)$/i;
  // og:site_name on a job board names the board, not the employer.
  if (boards.test(String(t.company || '').trim())) t.company = '';
  const parts = String(t.title || '').split(/\s+[|–—-]\s+/);
  while (parts.length > 1 && boards.test(parts[parts.length - 1].trim())) parts.pop();
  if (parts.length >= 2 && !t.company) t.company = parts[1].trim();
  if (parts.length >= 2) t.title = parts[0].trim();
  return t;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  pageUrl = tab?.url || '';
  if (!/^https?:\/\//i.test(pageUrl)) {
    $('status').textContent = 'Open an internship posting first, then click this button again.';
    return;
  }
  let info = { title: tab.title || '' };
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJob });
    if (res?.result) info = { ...info, ...Object.fromEntries(Object.entries(res.result).filter(([, v]) => v)) };
  } catch {
    // Some pages (browser pages, the web store) cannot be read; the tab title is still there.
  }
  info = tidy(info);
  $('title').value = (info.title || '').slice(0, 200);
  $('company').value = (info.company || '').slice(0, 160);
  $('location').value = (info.location || '').slice(0, 200);
  $('status').textContent = 'Check the details, then open your tracker.';
  $('save').disabled = false;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = new URLSearchParams({
    add: '1',
    url: pageUrl.slice(0, 500),
    title: $('title').value.trim(),
    company: $('company').value.trim(),
    location: $('location').value.trim(),
  });
  await chrome.tabs.create({ url: `${SITE}/?${q}` });
  window.close();
});

init().catch(() => {
  $('status').textContent = 'This page could not be read. You can still type the details.';
  $('save').disabled = !/^https?:\/\//i.test(pageUrl);
});
