// Search pages: /internships, /internships/<major>, /career-guides,
// /career-guides/<slug>, /interview-questions, /interview-questions/<field>,
// /how-it-works, /premium and /sponsor.
//
// These are plain server-rendered HTML — no JavaScript — so a search engine
// reads the whole page on arrival, and so does a student on a slow phone.
// They reuse the built app's stylesheet and link into the app for anything
// interactive (the ZIP search, the ledger, the tracker).
//
// Listings on the major pages come from the shared job cache, so a page view
// never triggers a fetch. The pages are rebuilt at most every 30 minutes.

import fs from 'node:fs';
import { AFFILIATE_NOTE, certRel } from './affiliates.js';
import { esc } from './html.js';
import { cardSvg, faqHtml, faqLd, figure, fitDescription, seoTitle, titleName } from './seo.js';
import path from 'node:path';
import { PREMIUM_CENTS, SPONSOR_CENTS, SPONSOR_DAYS } from './commerce.js';
import { compileFieldTerms } from './rank.js';
import { PREMIUM_ENABLED } from './features.js';

const COST_LABEL = { free: 'Free', audit: 'Free to audit', check: 'Check your campus', paid: 'Paid', ref: 'Reference' };
const PAGE_TTL_MS = 30 * 60_000;
const BRAND = 'Elevate Internships';

export const CONTENT_PATH = /^\/(internships|career-guides|interview-questions)(?:\/([a-z0-9-]+))?$|^\/how-it-works$|^\/accessibility$|^\/sponsor$|^\/premium$/;

function relativeDays(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'posted today';
  if (days === 1) return 'posted yesterday';
  if (days < 30) return `posted ${days} days ago`;
  return `posted ${Math.floor(days / 30)} mo ago`;
}

export function createContent({
  tracks,
  catalog,
  majorsContent,
  guides,
  interviews = { categories: [] },
  hub = {},
  images,
  cachedListings,
  rankJobs,
  contactEmail,
  sponsoredForMajor = () => [],
  adsOn = () => false,
  stripeOn = () => false,
}) {
  const ids = Object.keys(tracks).filter((id) => !id.startsWith('_') && Array.isArray(tracks[id].source));
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const guideList = guides.guides || [];
  const iqList = interviews.categories || [];
  const PREMIUM_PRICE = `$${(PREMIUM_CENTS / 100).toFixed(2)}`;
  const cache = new Map();

  // ---- Illustrations, one per page (served at /images/<name>.svg) ----------
  const img = {};
  img.internshipsHub = images.add('business-internships-by-major', 'Business internships for college students by major: ' + ids.map((i) => tracks[i].name).slice(0, 6).join(', ') + ' and more', () =>
    cardSvg({ eyebrow: 'Internships by major', title: 'Business internships for college students', rows: ids.slice(0, 6).map((i) => ({ label: tracks[i].name, text: majorsContent[i]?.roles?.slice(0, 2).map((r) => r.title).join(', ') || tracks[i].note })) }),
  );
  img.guidesHub = images.add('internship-guides-for-business-students', 'Internship guides for business students: ' + guideList.slice(0, 4).map((g) => g.title).join('; '), () =>
    cardSvg({ eyebrow: 'Career guides', title: 'Internship guides for business students', rows: guideList.slice(0, 6).map((g) => ({ text: g.title })) }),
  );
  img.howItWorks = images.add('find-internships-on-company-career-pages', 'Where Elevate Internships finds internships: company career pages on Greenhouse, Lever, Ashby and SmartRecruiters, plus public feeds', () =>
    cardSvg({
      eyebrow: 'How it works',
      title: 'Finding internships on company career pages',
      rows: [
        { label: 'Company career pages', text: 'About 300 employers\' own job boards on Greenhouse, Lever, Ashby and SmartRecruiters' },
        { label: 'Public feeds', text: 'The Muse, Simplify, Himalayas, Remotive and Jobicy, plus Adzuna and USAJOBS' },
        { label: 'Cleaned up', text: 'Old, non-U.S. and duplicate listings removed before you see them' },
        { label: 'Ranked for you', text: 'By fit with your major and distance from your ZIP code' },
      ],
    }),
  );
  for (const i of ids) {
    img['major:' + i] = images.add(i + '-internship-recruiting-timeline', 'Recruiting timeline for ' + tracks[i].name.toLowerCase() + ' internships' + ((tracks[i].timeline || []).length ? ', from ' + tracks[i].timeline[0].when.toLowerCase() + ' to ' + tracks[i].timeline[tracks[i].timeline.length - 1].when.toLowerCase() : ''), () =>
      cardSvg({ eyebrow: tracks[i].name + ' internships', title: 'When ' + tracks[i].name.toLowerCase() + ' internships recruit', rows: (tracks[i].timeline || []).map((s) => ({ label: s.when, text: s.what })) }),
    );
  }
  img.interviewHub = images.add('business-internship-interview-questions-by-field', 'Internship interview questions by field: ' + iqList.map((c) => c.name).join(', '), () =>
    cardSvg({ eyebrow: 'Interview question bank', title: 'Internship interview questions by field', rows: iqList.slice(0, 6).map((c) => ({ label: c.name, text: c.questions.slice(0, 2).map((q) => q.q).join(' ') })) }),
  );
  for (const c of iqList) {
    img['iq:' + c.slug] = images.add(c.slug + '-internship-interview-questions', c.title + ': ' + c.questions.slice(0, 3).map((q) => q.q).join(' '), () =>
      cardSvg({ eyebrow: 'Interview questions', title: c.title, rows: c.questions.slice(0, 6).map((q) => ({ text: q.q })) }),
    );
  }
  const firstList = (g) => (g.sections.find((s) => s.ol || s.ul) || {}).ol || (g.sections.find((s) => s.ol || s.ul) || {}).ul || [];
  for (const g of guideList) {
    img['guide:' + g.slug] = images.add(g.slug, g.title + ': ' + firstList(g).slice(0, 3).map((x) => x.split(/[.:]/)[0]).join('; '), () =>
      cardSvg({ eyebrow: 'Career guide', title: g.title, rows: firstList(g).slice(0, 6).map((x) => ({ text: x })) }),
    );
  }

  // The search page (/) and the landing page (/home) are the app, but their
  // explanatory section is also written into the HTML (see appPage), from the
  // same copy the app shows. SeoSection.jsx renders the identical markup.
  const block = (h) =>
    h?.image ? images.add(h.image.name, h.image.alt, () => cardSvg({ eyebrow: BRAND, title: h.heading, rows: (h.steps || []).map((t) => ({ text: t })) })) : null;
  img.home = block(hub.home);
  img.landing = block(hub.landing);

  /** Same structure as client/src/SeoSection.jsx. */
  function guideBlock(h, picture) {
    if (!h) return '';
    return `<section class="seo-guide section">${h.heading ? `<h2>${esc(h.heading)}</h2>` : ''}${(h.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join('')}${figure(picture)}${
      h.steps?.length ? `<h3>Step by step</h3><ol class="static-list">${h.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''
    }${h.faqs?.length ? `<h2>Questions students ask</h2>${faqHtml(h.faqs)}` : ''}</section>`;
  }

  const certsFor = (id) =>
    catalog.filter((c) => c.field === id || (c.fields || []).includes(id) || tracks[id].source.includes(c.id));

  /** Recent real listings whose title matches the major, newest first. */
  function listingsFor(id, limit = 8) {
    const words = compileFieldTerms(majorsContent[id]?.keywords);
    if (!words.length) return [];
    // Match titles first, then rank only those: ranking every cached listing
    // for each of the 23 majors was slow enough to time out /llms.txt.
    const matching = cachedListings().filter((j) => {
      const title = String(j.title).toLowerCase();
      // These pages are about internships: no new-grad, full-time or PhD roles.
      if (/full[- ]time|new grad|phd|postdoc/.test(title)) return false;
      return words.some((re) => re.test(title));
    });
    const { jobs } = rankJobs(matching, { major: tracks[id].name, interests: [], radiusMiles: 50, origin: null });
    const when = (j) => new Date(j.publishedAt || j.postedAt || 0).getTime() || 0;
    const seen = new Set();
    return jobs
      .sort((a, b) => when(b) - when(a))
      .filter((j) => {
        const key = `${j.company}|${j.title}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  // ---- Shell --------------------------------------------------------------

  // The app's sections, linked by address (see App.jsx ?tab=), and the More
  // menu. Same order and wording as the app's PrimaryNav and MoreSheet.
  const APP_TABS = [
    { href: '/', label: 'Finder', icon: 'search' },
    { href: '/?tab=ledger', label: 'Ledger', icon: 'ledger' },
    { href: '/?tab=tracker', label: 'Applications', icon: 'applications' },
    { href: '/?tab=stats', label: 'Stats', icon: 'stats' },
  ];
  const MORE_LINKS = [
    { href: '/account', label: 'Your account' },
    ...(PREMIUM_ENABLED ? [{ href: '/premium', label: 'Premium' }] : []),
    { href: '/sponsor', label: 'Sponsor' },
    { href: '/internships', label: 'Internships by major' },
    { href: '/certifications', label: 'Certifications by major' },
    { href: '/career-guides', label: 'Career guides' },
  ];
  // The same drawings as client/src/components/ui/Icon.jsx, as SVG strings.
  const ICON_PATHS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    ledger: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17"/>',
    applications: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18"/>',
    stats: '<path d="M5 20V11M12 20V4M19 20v-7"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  };
  const icon = (name, size = 20) =>
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;


  function shell(dist, { title, description, pathname, body, crumbs = [], jsonLd = [] }) {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const origin = (/<link rel="canonical" href="([^"]*?)\/?"/.exec(html) || [])[1] || '';
    const url = `${origin}${pathname}`;
    const set = (re, value) => (h) => h.replace(re, (_, pre, post) => `${pre}${esc(value)}${post}`);

    const breadcrumbLd = crumbs.length
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [{ name: BRAND, path: '/' }, ...crumbs].map((c, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: c.name,
              item: `${origin}${c.path}`,
            })),
          },
        ]
      : [];
    const ld = [...breadcrumbLd, ...jsonLd.map((f) => (typeof f === 'function' ? f(origin) : f))]
      .map((obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`)
      .join('\n');

    const crumbHtml = crumbs.length
      ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${crumbs
          .map((c, i) => (i === crumbs.length - 1 ? ` › <span aria-current="page">${esc(c.name)}</span>` : ` › <a href="${c.path}">${esc(c.name)}</a>`))
          .join('')}</nav>`
      : '';

    const feedback = contactEmail()
      ? ` · <a class="footer-link" href="mailto:${esc(contactEmail())}?subject=${encodeURIComponent('Elevate Internships feedback')}">Send feedback</a>`
      : '';

    // The app's top bar and phone tab bar, as plain links: these pages run no
    // JavaScript, so the tabs open the app at that section and More is a
    // native <details> menu. Markup and classes match components/ui in the app.
    const page = `<div class="wrap static-page">
<a class="skip-link" href="#main">Skip to content</a>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="/">${BRAND}</a>
    <nav class="primary-nav" aria-label="Main">
      <div class="primary-tabs">
        ${APP_TABS.map((t) => `<a class="tab" href="${t.href}"><span class="tab-icon">${icon(t.icon)}</span><span class="tab-label">${t.label}</span></a>`).join('\n        ')}
      </div>
      <details class="more-menu">
        <summary class="tab tab-more"><span class="tab-icon">${icon('more')}</span><span class="tab-label">More</span></summary>
        <div class="more-menu-panel">
          ${MORE_LINKS.map((l) => `<a class="page-link" href="${l.href}">${l.label}</a>`).join('\n          ')}
        </div>
      </details>
    </nav>
    <div class="account-controls"><a class="theme-toggle" href="/account">${icon('user', 18)}<span>Account</span></a></div>
  </div>
</header>
<nav class="page-links page-links-pills site-links" aria-label="Site">
  <a class="page-link" href="/">Find internships</a>
  <a class="page-link" href="/internships">Internships by major</a>
  <a class="page-link" href="/certifications">Certifications</a>
  <a class="page-link" href="/career-guides">Career guides</a>
</nav>
${crumbHtml}
<main id="main">${body}</main>
<footer class="footer">
  <div class="footer-links">
    <a class="footer-link" href="/terms">Terms and Conditions</a> · <a class="footer-link" href="/privacy">Privacy Policy</a> · <a class="footer-link" href="/how-it-works">How it works</a> · <a class="footer-link" href="/accessibility">Accessibility</a> · <a class="footer-link" href="/interview-questions">Interview questions</a> · ${PREMIUM_ENABLED ? '<a class="footer-link" href="/premium">Premium</a> · ' : ''}<a class="footer-link" href="/sponsor">Sponsor</a>${feedback}
  </div>
  <a class="pref-source" href="https://www.google.com/preferences/source?q=${encodeURIComponent(new URL(origin || 'https://elevateinternships.com').hostname)}" target="_blank" rel="noopener noreferrer"><span class="pref-star" aria-hidden="true">★</span><span>Add ${BRAND} as a <strong>preferred source</strong> on Google</span></a>
  <div class="footer-note">${
    adsOn()
      ? `No third-party analytics. Ads on some pages are served by Google${PREMIUM_ENABLED ? '; <a class="footer-link" href="/premium">Premium</a> removes them' : ''}.`
      : 'No tracking and no third-party analytics.'
  } Certifications do not guarantee a job; listings come from third parties — confirm details on the employer's site.</div>
</footer>
</div>`;

    return [
      (h) => h.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`),
      set(/(<meta\s+name="description"\s+content=")[^"]*(")/, description),
      set(/(<link rel="canonical" href=")[^"]*(")/, url),
      set(/(<meta property="og:url" content=")[^"]*(")/, url),
      set(/(<meta property="og:title" content=")[^"]*(")/, title),
      set(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, description),
      set(/(<meta name="twitter:title" content=")[^"]*(")/, title),
      set(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, description),
      // No JavaScript on these pages: drop the app bundle, keep its stylesheet.
      (h) => h.replace(/<script type="module"[^>]*><\/script>\s*/g, '').replace(/<link rel="modulepreload"[^>]*>\s*/g, ''),
      (h) => h.replace('</head>', `${ld}\n</head>`),
      (h) => h.replace('<div id="root"></div>', page),
    ].reduce((h, f) => f(h), html);
  }

  const cta = (href, label) => `<p class="static-cta"><a class="btn" href="${href}">${esc(label)} →</a></p>`;

  // ---- /internships ---------------------------------------------------------

  function internshipsHub() {
    const cards = ids
      .map(
        (id) =>
          `<a class="site" href="/internships/${id}"><div class="site-name">${esc(tracks[id].name)} internships</div><div class="site-note">${esc(
            majorsContent[id]?.roles?.slice(0, 2).map((r) => r.title).join(', ') || tracks[id].note,
          )}</div></a>`,
      )
      .join('');
    const h = hub.internships || {};
    return {
      title: seoTitle('Business Internships for College Students by Major'),
      description: 'Business internships for college students by major: what each field hires for, when it recruits, and real listings you can search by ZIP code.',
      pathname: '/internships',
      crumbs: [{ name: 'Internships', path: '/internships' }],
      jsonLd: [faqLd(h.faqs)].filter(Boolean),
      body: `<div class="major-head"><div class="eyebrow">Internships by major</div>
<h1>Business internships for college students, by major</h1>
<p>Pick your major to see the internships it leads to, the skills employers look for, when that field recruits, and the certifications worth adding. Then search real listings near you by ZIP code and distance.</p>
${cta('/', 'Search internships near you')}</div>
${(h.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join('')}
${figure(img.internshipsHub)}
<section class="section"><div class="section-head"><div><h2>Choose your major</h2><div class="section-note">${ids.length} business majors</div></div></div>
<div class="major-grid">${cards}</div></section>
<section class="section"><div class="section-head"><div><h2>Questions students ask</h2></div></div>${faqHtml(h.faqs)}</section>
<p>Looking for credentials instead? See <a href="/certifications">certifications for business majors</a>.</p>
${guidesTeaser()}`,
    };
  }

  // ---- /internships/<major> -------------------------------------------------

  function internshipsMajor(id) {
    const t = tracks[id];
    const c = majorsContent[id] || {};
    const name = t.name;
    const lower = name.toLowerCase();
    const listings = listingsFor(id);
    const sponsoredHere = sponsoredForMajor(id);
    const certs = certsFor(id);
    const starter = t.source.map((cid) => byId.get(cid)).filter(Boolean).slice(0, 5);

    const roles = (c.roles || []).map((r) => `<li><strong>${esc(r.title)}</strong> — ${esc(r.what)}</li>`).join('');
    const skills = (c.skills || []).map((s) => `<li>${esc(s)}</li>`).join('');
    const keywords = (c.resumeKeywords || []).map((k) => `<span class="chip">${esc(k)}</span>`).join('');
    const faqs = (c.faqs || []).map((f) => `<div class="faq"><h3>${esc(f.q)}</h3><p>${esc(f.a)}</p></div>`).join('');
    const timeline = (t.timeline || [])
      .map((s) => `<li><div class="timeline-when">${esc(s.when)}</div><div class="timeline-what">${esc(s.what)}</div></li>`)
      .join('');
    const sponsoredHtml = sponsoredHere.length
      ? `<ul class="listing-mini sponsored-mini">${sponsoredHere
          .map(
            (j) =>
              `<li><span class="badge sponsored">Sponsored</span> <a href="${esc(j.applyUrl)}" target="_blank" rel="sponsored noopener">${esc(j.title)}</a><div class="listing-meta">${esc(j.company)} · ${esc(j.location)}</div></li>`,
          )
          .join('')}</ul>`
      : '';
    const listingHtml = sponsoredHtml + (listings.length
      ? `<ul class="listing-mini">${listings
          .map(
            (j) =>
              `<li><a href="${esc(j.url)}" target="_blank" rel="nofollow noopener">${esc(j.title)}</a><div class="listing-meta">${esc(j.company)} · ${esc(
                j.location,
              )} · ${esc(relativeDays(j.publishedAt || j.postedAt))} · via ${esc(j.source)}</div></li>`,
          )
          .join('')}</ul><p class="section-note">A sample of recent postings from employer job boards and public feeds. Search by ZIP code to see the ones near you.</p>`
      : `<p class="section-note">New listings load throughout the day. Search by ZIP code to see what is open near you now.</p>`);
    const certHtml = starter
      .map(
        (cert) =>
          `<li><a href="${esc(cert.url)}" target="_blank" rel="${certRel(cert)}">${esc(cert.title)}</a> — ${esc(cert.provider)}. <span class="tag ${esc(
            cert.cost,
          )}">${esc(COST_LABEL[cert.cost] || cert.cost)}</span>${cert.price ? ` <span class="price-note">${esc(cert.price)}</span>` : ''}</li>`,
      )
      .join('');
    const others = ids
      .filter((m) => m !== id)
      .map((m) => `<a href="/internships/${m}">${esc(tracks[m].name)} internships</a>`)
      .join(' · ');
    const searchHref = `/?major=${encodeURIComponent(name)}`;

    const tn = titleName(id, name);
    const phrase = `${tn} Internships for College Students`.length <= 60 ? `${tn} Internships for College Students` : `${tn} Internships for Students`;
    return {
      title: seoTitle(phrase),
      description: fitDescription(
        `${name} internships for college students: roles, skills, when ${lower} internships recruit, and listings near your ZIP code.`,
        `${name} internships for college students: roles, skills, recruiting timeline and listings near your ZIP code.`,
        `${tn} internships for college students: roles, skills, recruiting timeline and listings near you.`,
      ),
      jsonLd: [faqLd(c.faqs)].filter(Boolean),
      pathname: `/internships/${id}`,
      crumbs: [
        { name: 'Internships', path: '/internships' },
        { name: `${name} internships`, path: `/internships/${id}` },
      ],
      body: `<div class="major-head"><div class="eyebrow">${esc(name)}</div>
<h1>${esc(name)} internships for college students</h1>
<p>${esc(c.intro || t.note)}</p>
${cta(searchHref, `Find ${lower} internships near you`)}</div>

<section class="section"><div class="section-head"><div><h2>Recent ${esc(lower)} internship listings</h2></div></div>${listingHtml}</section>

<section class="section"><div class="section-head"><div><h2>Common ${esc(lower)} internships</h2></div></div><ul class="static-list">${roles}</ul></section>

<section class="section"><div class="section-head"><div><h2>Skills employers look for</h2></div></div><ul class="static-list">${skills}</ul></section>

<section class="section"><div class="timeline"><h2>When ${esc(lower)} internships recruit</h2><ol>${timeline}</ol><div class="timeline-foot">Typical timing — firms set their own dates, so check each one.</div></div>${figure(img['major:' + id])}
<p>For every major side by side, see <a href="/career-guides/when-to-apply-for-business-internships">when to apply for business internships</a>.</p></section>

<section class="section"><div class="section-head"><div><h2>Certifications that strengthen a ${esc(lower)} application</h2><div class="section-note">Where to start — none is required</div></div></div><ul class="static-list">${certHtml}</ul>${starter.some((c) => c.affiliate) ? `<p class="section-note">${esc(AFFILIATE_NOTE)}</p>` : ''}
<p><a href="/certifications/${id}">See all ${certs.length} ${esc(lower)} certifications, free ones first</a></p></section>

<section class="section"><div class="section-head"><div><h2>Resume keywords for ${esc(lower)} internships</h2><div class="section-note">Use the ones that are true for you</div></div></div><div class="chips">${keywords}</div>
<p><a href="/career-guides/business-internship-resume">How to write a business internship resume</a></p></section>

<section class="section"><div class="section-head"><div><h2>Questions students ask</h2></div></div>${faqs}</section>

<section class="section"><div class="section-head"><div><h2>Guides for your applications</h2></div></div><ul class="static-list">
<li><a href="/career-guides/business-internship-interview-questions">Business internship interview questions and answers</a></li>
${iqList.filter((c) => c.majors.includes(id)).map((c) => `<li><a href="/interview-questions/${c.slug}">${esc(c.title)}</a></li>`).join('')}
<li><a href="/career-guides/internship-cover-letter">Internship cover letter for business students, with an example</a></li>
<li><a href="/career-guides/networking-for-internships">How to network for a business internship</a></li>
</ul></section>

${cta(searchHref, `Search ${lower} internships by ZIP code`)}
<section class="section"><div class="section-head"><div><h2>Other majors</h2></div></div><p class="other-links">${others}</p></section>`,
    };
  }

  // ---- /career-guides -------------------------------------------------------

  function guidesTeaser() {
    return `<section class="section"><div class="section-head"><div><h2>Career guides</h2><div class="section-note">Practical help for business students</div></div></div>
<ul class="static-list">${guideList
      .map((g) => `<li><a href="/career-guides/${g.slug}">${esc(g.title)}</a> — ${esc(g.description)}</li>`)
      .join('')}</ul></section>`;
  }

  function guidesIndex() {
    const h = hub.careerGuides || {};
    return {
      title: seoTitle('Internship Guides for Business Students'),
      description: 'Free internship guides for business students: when to apply, resumes, cover letters, interviews, networking and turning an internship into a job.',
      pathname: '/career-guides',
      crumbs: [{ name: 'Career guides', path: '/career-guides' }],
      jsonLd: [faqLd(h.faqs)].filter(Boolean),
      body: `<div class="major-head"><div class="eyebrow">Career guides</div><h1>Internship guides for business students</h1>
<p>Short, practical guides that end with something you can do today.</p></div>
${(h.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join('')}
${figure(img.guidesHub)}
${guidesTeaser()}
<section class="section"><div class="section-head"><div><h2>Questions students ask</h2></div></div>${faqHtml(h.faqs)}</section>
${cta('/internships', 'Browse internships by major')}`,
    };
  }

  function generated(kind) {
    if (kind === 'free-certs') {
      return ids
        .map((id) => {
          const free = certsFor(id).filter((c) => c.cost === 'free' || c.cost === 'audit');
          if (!free.length) return '';
          return `<h2>${esc(tracks[id].name)}</h2><ul class="static-list">${free
            .map(
              (c) =>
                `<li><a href="${esc(c.url)}" target="_blank" rel="${certRel(c)}">${esc(c.title)}</a> — ${esc(c.provider)}. <span class="tag ${esc(c.cost)}">${esc(
                  COST_LABEL[c.cost],
                )}</span>${c.hours ? ` · about ${c.hours} hours` : ''}. ${esc(c.desc)}</li>`,
            )
            .join('')}</ul><p><a href="/certifications/${id}">All ${esc(tracks[id].name)} certifications, including paid ones</a></p>`;
        })
        .join('');
    }
    if (kind === 'timelines') {
      return ids
        .map(
          (id) =>
            `<h2><a href="/internships/${id}">${esc(tracks[id].name)}</a></h2><div class="timeline"><ol>${(tracks[id].timeline || [])
              .map((s) => `<li><div class="timeline-when">${esc(s.when)}</div><div class="timeline-what">${esc(s.what)}</div></li>`)
              .join('')}</ol></div>`,
        )
        .join('');
    }
    if (kind === 'resume-keywords') {
      return ids
        .map(
          (id) =>
            `<h3><a href="/internships/${id}">${esc(tracks[id].name)}</a></h3><div class="chips">${(majorsContent[id]?.resumeKeywords || [])
              .map((k) => `<span class="chip">${esc(k)}</span>`)
              .join('')}</div>`,
        )
        .join('');
    }
    return '';
  }

  const CTA_HREF = {
    'Track your applications and interviews': '/',
    'Find internships to apply to': '/',
    'Search internships near you': '/',
    'Find certifications and internships for your major': '/internships',
  };

  function guide(slug) {
    const g = guideList.find((x) => x.slug === slug);
    if (!g) return null;
    const body = g.sections
      .map((s) => {
        if (s.p) return `<p>${esc(s.p)}</p>`;
        if (s.h2) return `<h2>${esc(s.h2)}</h2>`;
        if (s.ul) return `<ul class="static-list">${s.ul.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
        if (s.ol) return `<ol class="static-list">${s.ol.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`;
        if (s.generated) return generated(s.generated);
        if (s.cta) return cta(CTA_HREF[s.cta] || '/', s.cta);
        if (s.faq) return faqHtml(s.faq);
        return '';
      })
      .join('\n');
    const faqs = g.sections.flatMap((s) => s.faq || []);
    const picture = img['guide:' + slug];
    const updated = new Date(`${g.updated}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const more = guideList
      .filter((x) => x.slug !== slug)
      .map((x) => `<li><a href="/career-guides/${x.slug}">${esc(x.title)}</a></li>`)
      .join('');
    return {
      title: seoTitle(g.metaTitle || g.title),
      description: g.description,
      pathname: `/career-guides/${slug}`,
      crumbs: [
        { name: 'Career guides', path: '/career-guides' },
        { name: g.title, path: `/career-guides/${slug}` },
      ],
      jsonLd: [
        (origin) => ({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: g.title,
          description: g.description,
          dateModified: g.updated,
          datePublished: g.published || g.updated,
          author: { '@type': 'Organization', name: BRAND, url: `${origin}/` },
          publisher: { '@type': 'Organization', name: BRAND, url: `${origin}/` },
          mainEntityOfPage: `${origin}/career-guides/${slug}`,
          image: `${origin}${picture.src}`,
        }),
        faqLd(faqs),
      ].filter(Boolean),
      body: `<article class="guide"><div class="eyebrow">Career guide · Updated ${esc(updated)}</div><h1>${esc(g.title)}</h1>
${figure(picture)}
${body}
<p>Next: find <a href="/internships">business internships for your major</a> or compare <a href="/certifications">certifications for business majors</a>.</p></article>
<section class="section"><div class="section-head"><div><h2>More guides</h2></div></div><ul class="static-list">${more}</ul></section>`,
    };
  }

  // ---- /how-it-works --------------------------------------------------------

  const HOW_FAQS = [
    { q: 'How do I find internships that are not on Indeed or LinkedIn?', a: "Check companies' own career pages, which usually run on Greenhouse, Lever, Ashby or SmartRecruiters. Many internships are posted there first or only there. Elevate Internships searches about 300 of those pages for you." },
    { q: 'How often are listings updated?', a: 'Employer job boards are refreshed about every 30 minutes and public feeds about every hour, so new postings appear the same day.' },
    { q: 'Does Elevate Internships verify listings?', a: "No. Listings come from employers and public feeds. Confirm the details on the employer's own site before applying, and never pay to apply for an internship." },
  ];

  function howItWorks() {
    return {
      title: seoTitle('How We Find Internships on Company Career Pages'),
      description: 'How Elevate Internships finds internships on company career pages, cleans up listings, chooses certifications and keeps links working.',
      pathname: '/how-it-works',
      crumbs: [{ name: 'How it works', path: '/how-it-works' }],
      jsonLd: [faqLd(HOW_FAQS)],
      body: `<article class="guide"><div class="eyebrow">Editorial standards</div><h1>How Elevate Internships finds internships on company career pages</h1>
${figure(img.howItWorks)}
<h2>Where the internships come from</h2>
<p>Listings are pulled from employers' own public job boards (on Greenhouse, Lever, Ashby and SmartRecruiters) and from public feeds including The Muse, Simplify's internship list, Himalayas, Remotive and Jobicy. Nothing is scraped from sites that do not offer their listings publicly, which is why LinkedIn, Handshake and Indeed appear as prefilled search links instead of listings.</p>
<p>Before you see them, listings older than nine months are hidden, listings outside the United States are hidden, and duplicates posted in several places are merged. When you search by ZIP code, each listing's distance is measured from its city; a listing whose location cannot be placed is left out rather than guessed.</p>
<p>We do not write or verify the listings themselves. Always confirm the details on the employer's own site before applying, and never pay to apply for an internship.</p>
<h2>Why company career pages matter</h2>
<p>Most companies post internships on their own careers site first, using an applicant tracking system such as Greenhouse, Lever, Ashby or SmartRecruiters. Posting to the large job boards is often an extra step, sometimes a paid one, so plenty of internships — especially at startups and mid-size companies — only ever appear on the company's own page. Reading those pages directly is how we show internships you might not find on the big boards.</p>
<p>You can do the same by hand for a company you care about: open its careers page, filter for internships, and check back every week or two during recruiting season. Our search does that for about 300 employers at once and adds public feeds on top.</p>
<h2>How certifications are chosen</h2>
<p>Every certification is picked for its relevance to one or more business majors and labelled honestly: <strong>free</strong>, <strong>free to audit</strong> (the course is free, the certificate is not), <strong>check your campus</strong>, <strong>paid</strong> with the real cost, or <strong>reference</strong> for reading rather than a credential. Prices change, so confirm with the provider before you pay.</p>
<p>Every certification link is checked automatically, and pages that have moved or closed are replaced or removed. Some providers block automated checks; those are checked by hand.</p>
<p>A certification is a way to show a skill. It does not guarantee an interview or a job, and no employer on this site requires one because we recommend it. Browse them by field on <a href="/certifications">certifications for business majors</a>, or start with the <a href="/career-guides/free-certifications-for-business-students">free certifications for business students</a>.</p>
<h2>Recruiting timelines and guides</h2>
<p>Timelines describe typical patterns for each field. Employers set their own dates and change them from year to year, so treat them as a planning guide and check each firm's deadline. Each major's timeline is on its page under <a href="/internships">internships by major</a>, and <a href="/career-guides/when-to-apply-for-business-internships">when to apply for business internships</a> puts them side by side. The <a href="/career-guides">internship guides</a> cover resumes, cover letters, interviews and networking.</p>
<h2>Your privacy</h2>
<p>You can search without an account. Your ZIP code is used to measure distances and is not shared with the employer boards, which are fetched in full and filtered on our server. ${
        adsOn()
          ? `There are no third-party analytics. Some pages show ads served by Google, which uses cookies to choose them; the app itself${PREMIUM_ENABLED ? ' and Premium members see' : ' shows'} none.`
          : 'There is no advertising, no tracking and no third-party analytics.'
      } The full details are in the <a href="/privacy">Privacy Policy</a>.</p>
<h2>Report a problem</h2>
<p>Found an expired listing, a broken link or a wrong price? ${
        contactEmail()
          ? `Email <a href="mailto:${esc(contactEmail())}?subject=${encodeURIComponent('Problem report')}">${esc(contactEmail())}</a> with the link and what is wrong.`
          : 'Use the feedback link in the footer.'
      } Every listing in the Finder also has a <em>Report</em> link.</p>
<h2>Questions students ask</h2>
${faqHtml(HOW_FAQS)}
<p>Ready to look? <a href="/">Find business internships by ZIP code</a>, or browse <a href="/internships">internships by major</a>.</p>
</article>`,
    };
  }

  // ---- /sponsor ---------------------------------------------------------------

  function sponsor() {
    const email = contactEmail();
    const contact = email
      ? `Email <a href="mailto:${esc(email)}?subject=${encodeURIComponent('Sponsoring Elevate Internships')}">${esc(email)}</a> with your organization, what you would like to promote, and your timing.`
      : 'Use the feedback link in the footer to get in touch.';
    const price = `$${(SPONSOR_CENTS / 100).toFixed(0)}`;
    const majorBoxes = ids
      .map((id) => `<label class="check-line"><input type="checkbox" name="majors" value="${esc(id)}"> ${esc(tracks[id].name)}</label>`)
      .join('');
    const postForm = stripeOn()
      ? `<h2 id="post">Post a sponsored internship — ${price} for ${SPONSOR_DAYS} days</h2>
<p>Your internship appears at the top of searches from students in the majors you choose, within their search distance (or everywhere, if it is remote), and on those majors' internship pages. It is labeled <em>Sponsored</em> and links straight to your application page.</p>
<form class="card sponsor-form" method="post" action="/sponsor/checkout">
<div class="form-grid">
<div class="field"><label for="sp-company">Company</label><input id="sp-company" name="company" type="text" maxlength="120" required autocomplete="organization"></div>
<div class="field"><label for="sp-title">Internship title</label><input id="sp-title" name="title" type="text" maxlength="160" required placeholder="Summer Finance Intern"></div>
<div class="field full"><label for="sp-url">Link to apply (https://…)</label><input id="sp-url" name="url" type="url" maxlength="500" required placeholder="https://careers.example.com/jobs/123"></div>
<div class="field"><label for="sp-zip">ZIP code where the intern works</label><input id="sp-zip" name="zip" type="text" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="06103"></div>
<div class="field"><span class="field-label">Remote?</span><label class="check-line"><input type="checkbox" name="remote" value="yes"> This internship is fully remote</label></div>
<div class="field full"><span class="field-label">Majors to reach (choose at least one)</span><div class="check-grid">${majorBoxes}</div></div>
<div class="field full"><label for="sp-email">Your email, for the receipt and review result</label><input id="sp-email" name="email" type="email" maxlength="200" required autocomplete="email"></div>
<div class="hp" aria-hidden="true"><label for="sp-website">Leave this empty</label><input id="sp-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
</div>
<p class="section-note">You pay ${price} by card on Stripe's secure page. Every listing is reviewed by hand, usually within one business day, and runs for ${SPONSOR_DAYS} days from approval. If we do not approve it, you get a full refund.</p>
<div class="form-actions"><button class="btn" type="submit">Continue to payment →</button></div>
</form>`
      : '';
    return {
      title: seoTitle('Sponsor Elevate Internships'),
      description: 'Reach college students in business majors while they look for internships: clearly labeled sponsored listings on relevant searches and pages.',
      pathname: '/sponsor',
      crumbs: [{ name: 'Sponsor', path: '/sponsor' }],
      body: `<article class="guide"><div class="eyebrow">For employers and education providers</div><h1>Sponsor Elevate Internships</h1>
<p>Elevate Internships is a free internship finder and tracker for college students in business majors — accounting, finance, marketing, analytics and ten more. Students come here to find internships near them, plan the certifications that fit their field, and track applications through recruiting season. That makes it a focused place to reach them, and sponsorship is how we keep the site free.</p>
${postForm}
<h2>What you can sponsor</h2>
<ul class="static-list">
<li><strong>A featured internship or program.</strong> Your internship, rotational program or early-insight event shown as a clearly labeled sponsored listing in searches and on the pages for the majors you recruit.${stripeOn() ? ' <a href="#post">Post one above.</a>' : ''}</li>
<li><strong>A certification or course.</strong> Your course, exam prep or credential featured on the certification page for the relevant majors, labeled as sponsored and shown alongside our independent recommendations — never instead of them.</li>
<li><strong>A career guide.</strong> Support a practical guide for students, such as interview preparation or recruiting timelines for your field, with your organization credited as sponsor.</li>
</ul>
<h2>The rules</h2>
<ul class="static-list">
<li>Every sponsorship is labeled <em>Sponsored</em>, and it never changes how other listings or certifications are ranked.</li>
<li>It has to be relevant and useful to business students. We do not run offers that ask students to pay to apply, or anything we would not recommend to a friend.</li>
<li>Sponsorships carry no tracking pixels or scripts, and we never share students' personal data. We report aggregate numbers only — how many times your listing was shown and how many people clicked through.</li>
<li>Sponsored links are marked for search engines as sponsored, as Google asks.</li>
</ul>
<h2>Who it reaches</h2>
<p>Undergraduate business students in the United States, mostly freshmen through seniors planning summer internships, across ${ids.length} majors. Each major has its own internship and certification pages, so a sponsorship can target the students you actually want to hire or teach.</p>
<h2>Get in touch</h2>
<p>${contact} We will reply with what is available for your majors and dates.</p>
<p>Recruiting students directly? You can also <a href="/internships">browse internships by major</a> to see how your field is presented, or read <a href="/how-it-works">how the site finds internships on company career pages</a> — if your company posts on Greenhouse, Lever, Ashby or SmartRecruiters, your internships may already appear here.</p>
</article>`,
    };
  }

  // ---- /accessibility -------------------------------------------------------------
  //
  // Every claim here is checked by the test suite (a11y-check, layout-check,
  // motion-check, scripts/check-contrast.js). Change the date when the page or
  // the site's accessibility changes.

  const A11Y_REVIEWED = 'October 13, 2026';

  function accessibilityPage() {
    const email = contactEmail();
    const reach = email
      ? `email <a href="mailto:${esc(email)}?subject=${encodeURIComponent('Accessibility')}">${esc(email)}</a>`
      : 'write to the operator of this site';
    return {
      title: seoTitle('Accessibility Statement'),
      description: 'How Elevate Internships is built and tested to meet WCAG 2.2 level AA, what is known to fall short, and how to report a barrier.',
      pathname: '/accessibility',
      crumbs: [{ name: 'Accessibility', path: '/accessibility' }],
      jsonLd: [],
      body: `<article class="guide"><div class="eyebrow">Accessibility</div><h1>Accessibility statement</h1>
<p>Elevate Internships should work for every student, including people who use a screen reader, a keyboard instead of a mouse, screen magnification, or reduced motion. We aim to meet the <a href="https://www.w3.org/TR/WCAG22/">Web Content Accessibility Guidelines (WCAG) 2.2</a> at level AA.</p>
<h2>What we have done</h2>
<ul class="static-list">
<li>Text and controls meet the WCAG AA color contrast ratios in both the light and the dark theme.</li>
<li>Everything works with a keyboard. Each page starts with a link that skips to the main content, every control shows a visible focus outline, and the section tabs use the standard tab pattern, including the arrow keys.</li>
<li>Buttons, links and form fields have names a screen reader can announce. Form errors are linked to their field and read out when they appear.</li>
<li>Buttons, tabs and other controls are at least 44 by 44 pixels, so they are easy to tap.</li>
<li>Pages reflow to 320 pixels wide, the same as zooming to 400% on a laptop, without scrolling sideways.</li>
<li>If your device asks for reduced motion, the site's animations switch off.</li>
<li>The light and dark themes follow your device's setting, or your own choice.</li>
<li>The guide and information pages are plain HTML and work without JavaScript.</li>
</ul>
<h2>How we test</h2>
<p>Before each release, an automated check runs <a href="https://github.com/dequelabs/axe-core">axe-core</a> against the WCAG 2.2 A and AA rules on more than 20 pages and states — the internship search with results, the ledger, the application tracker, statistics, your account, certification and internship pages, the guides, the interview questions and the policies — at phone and desktop widths, in light and dark mode. On ${A11Y_REVIEWED} it found no violations. Other automated tests check color contrast, control size and reduced motion, and that every page reflows at 320 pixels.</p>
<p>Automated checks catch many problems but not all of them, which is why reports from people using the site matter.</p>
<h2>Known limitations</h2>
<ul class="static-list">
<li>Internship listings are written by employers and job boards. We show the title, company and location as they give them, and the pages you apply on are theirs.</li>
<li>Certification courses run on their providers' own sites.</li>
<li>The site has not yet been reviewed by people who use assistive technology every day. We would welcome that review.</li>
</ul>
<h2>Report a problem</h2>
<p>If something on this site is hard or impossible to use, ${reach} with the page address and what happened. We aim to reply within five business days and to fix barriers on our own pages as quickly as we can. If you need information from the site in another format, ask and we will send it.</p>
<h2>Technical details</h2>
<p>The site relies on HTML, CSS and WAI-ARIA, plus JavaScript for the interactive search, ledger and tracker. The automated checks run in Google Chrome.</p>
<p class="section-note">This statement was last reviewed on ${A11Y_REVIEWED}.</p>
</article>`,
    };
  }

  // ---- /premium -----------------------------------------------------------------

  const PREMIUM_FAQS = [
    { q: 'How much is Premium?', a: `${PREMIUM_PRICE} for one semester — six months of Premium. It is a single payment and does not renew; buy another semester whenever you want one.` },
    { q: 'Is Elevate Internships still free without Premium?', a: 'Yes. Searching internships, the certification ledger, the application tracker, calendar export, deadline reminders and the weekly email all stay free. Premium adds extras on top.' },
    { q: 'Can I get a refund?', a: 'Yes. If Premium is not for you, email us within 14 days of paying for a full refund.' },
    { q: 'How do daily alerts work?', a: 'Turn on notifications on your phone or computer, and each day Premium checks your most recent search for internships posted since the last check. If there are new ones, you get one notification. Nothing new, no notification.' },
  ];

  function premiumPage() {
    const total = iqList.reduce((n, c) => n + c.questions.length, 0);
    const points = [
      ['Daily new-internship alerts', 'A notification on your phone or computer when new internships match your latest search, checked every day instead of once a week.'],
      ['The Recruiting Kit', 'An Excel recruiting planner, a one-page resume template, cover letter and networking templates, and a start-here guide, ready to download.'],
      ['Sample interview answers', `Written sample answers for all ${total} questions in the <a href="/interview-questions">interview question bank</a>, for behavioral, accounting, finance, marketing, analytics and consulting interviews.`],
      ['No ads', 'Pages that show ads to everyone else show none to Premium members.'],
    ];
    return {
      title: seoTitle('Elevate Internships Premium'),
      description: `Premium for business students: daily internship alerts, the Recruiting Kit, sample interview answers and no ads. ${PREMIUM_PRICE} a semester, no subscription.`,
      pathname: '/premium',
      crumbs: [{ name: 'Premium', path: '/premium' }],
      jsonLd: [faqLd(PREMIUM_FAQS)],
      body: `<article class="guide"><div class="eyebrow">Premium</div><h1>Elevate Internships Premium</h1>
<p>Everything that helps you find and land an internship stays free. Premium is for the busiest part of recruiting season: faster alerts, ready-made templates and practice answers, for <strong>${PREMIUM_PRICE} a semester</strong>. One payment covers six months, and it never renews on its own.</p>
<ul class="premium-points">${points.map(([t, d]) => `<li><strong>${esc(t)}</strong><span>${d}</span></li>`).join('')}</ul>
${cta('/account', stripeOn() ? `Get Premium — ${PREMIUM_PRICE} a semester` : 'See your account')}
${stripeOn() ? '' : '<p class="section-note">Premium purchases open soon.</p>'}
<h2>What stays free</h2>
<p>Internship search by ZIP code across about 300 company career pages and public feeds, certifications for ${ids.length} business majors, the certification ledger, the application tracker with deadlines and calendar export, day-before reminders by email or notification, the weekly new-internships email, and every career guide.</p>
<h2>Questions students ask</h2>
${faqHtml(PREMIUM_FAQS)}
<p>Payments are handled by Stripe; your card details never reach this site. See the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
</article>`,
    };
  }

  // ---- /interview-questions -------------------------------------------------------

  const IQ_FAQS = [
    { q: 'How should I prepare for an internship interview?', a: 'Prepare four or five true stories you can tell with the STAR method, practice the technical basics for your field out loud, research the company, and have two or three questions ready for the interviewer.' },
    { q: 'What is the STAR method?', a: 'Situation, Task, Action, Result: set the scene in a sentence, say what you needed to do, spend most of the answer on what you did, and finish with what happened.' },
    { q: 'Do internship interviews ask technical questions?', a: 'Accounting, finance and analytics interviews usually include a few, and consulting interviews include short cases. Interviewers expect the basics from your classes, not expert knowledge.' },
  ];

  function interviewHub() {
    const total = iqList.reduce((n, c) => n + c.questions.length, 0);
    return {
      title: seoTitle('Internship Interview Questions by Field'),
      description: `${total} internship interview questions for business students, by field — behavioral, accounting, finance, marketing, analytics and consulting — with how to answer each.`,
      pathname: '/interview-questions',
      crumbs: [{ name: 'Interview questions', path: '/interview-questions' }],
      jsonLd: [faqLd(IQ_FAQS)],
      body: `<div class="major-head"><div class="eyebrow">Interview question bank</div>
<h1>Internship interview questions by field</h1>
<p>The questions business internship interviews actually ask, sorted by field. For each one: what the interviewer is really looking for, and how to build a strong answer.${PREMIUM_ENABLED ? ' Premium members also get a written sample answer for every question.' : ''}</p></div>
${figure(img.interviewHub)}
<section class="section"><div class="major-grid">${iqList
        .map(
          (c) =>
            `<a class="site" href="/interview-questions/${c.slug}"><div class="site-name">${esc(c.title)}</div><div class="site-note">${c.questions.length} questions · ${esc(
              c.questions.slice(0, 2).map((q) => q.q).join(' '),
            )}</div></a>`,
        )
        .join('')}</div></section>
<section class="section"><div class="section-head"><div><h2>Questions students ask</h2></div></div>${faqHtml(IQ_FAQS)}</section>
<p>Start with <a href="/career-guides/business-internship-interview-questions">how to prepare for a business internship interview</a>, then practice the questions for your field.</p>
${cta('/', 'Find internships to apply to')}`,
    };
  }

  function interviewCategory(slug, premium) {
    const c = iqList.find((x) => x.slug === slug);
    if (!c) return null;
    // Sample answers are a Premium perk; with Premium switched off they are
    // not shown, and neither is the offer to unlock them.
    const sample = (q) =>
      premium
        ? `<div class="sample-answer"><div class="sample-label">Sample answer</div><p>${esc(q.sample)}</p></div>`
        : PREMIUM_ENABLED
          ? `<div class="sample-answer locked"><div class="sample-label">Sample answer</div><p>A written sample answer for this question comes with <a href="/premium">Premium</a> (${PREMIUM_PRICE} a semester).</p></div>`
          : '';
    const qs = c.questions
      .map(
        (q, i) => `<section class="iq" id="q${i + 1}"><h2>${i + 1}. ${esc(q.q)}</h2>
<p><strong>What they are looking for:</strong> ${esc(q.why)}</p>
<p><strong>How to answer:</strong> ${esc(q.how)}</p>
${sample(q)}</section>`,
      )
      .join('\n');
    const others = iqList
      .filter((x) => x.slug !== slug)
      .map((x) => `<a href="/interview-questions/${x.slug}">${esc(x.title)}</a>`)
      .join(' · ');
    const majorLinks = c.majors
      .filter((m) => tracks[m])
      .map((m) => `<a href="/internships/${m}">${esc(tracks[m].name)} internships</a>`)
      .join(' · ');
    const faqs = c.questions.slice(0, 4).map((q) => ({ q: q.q, a: `${q.why} ${q.how}` }));
    const updated = new Date(`${interviews.updated || '2026-09-25'}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return {
      title: seoTitle(c.title),
      description: c.description,
      pathname: `/interview-questions/${slug}`,
      crumbs: [
        { name: 'Interview questions', path: '/interview-questions' },
        { name: c.name, path: `/interview-questions/${slug}` },
      ],
      jsonLd: [faqLd(faqs)],
      body: `<article class="guide"><div class="eyebrow">Interview questions · Updated ${esc(updated)}</div><h1>${esc(c.title)}</h1>
<p>${esc(c.intro)}</p>
${figure(img['iq:' + slug])}
${premium || !PREMIUM_ENABLED ? '' : '<p class="premium-note">Every question below shows what the interviewer wants and how to answer. <a href="/premium">Premium</a> adds a written sample answer for each.</p>'}
${qs}
<h2>Before and after the interview</h2>
<p>Research the company, prepare two or three questions of your own, and send a short thank-you email within a day. Then record the interview in your <a href="/?tab=tracker">application tracker</a> so you get a reminder and do not lose track of next steps.</p>
${majorLinks ? `<p>Internships for these majors: ${majorLinks}</p>` : ''}
</article>
<section class="section"><div class="section-head"><div><h2>More interview questions</h2></div></div><p class="other-links">${others}</p></section>`,
    };
  }

  // ---- Router ---------------------------------------------------------------

  /** Pages that differ for Premium members (the sample answers). */
  const premiumSensitive = (pathname) => pathname.startsWith('/interview-questions/');

  /** Returns HTML for a content path, or null if the path is not one. */
  function render(dist, pathname, { premium = false } = {}) {
    const m = CONTENT_PATH.exec(pathname);
    if (!m) return null;
    const key = premium && premiumSensitive(pathname) ? `${pathname}|premium` : pathname;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.html;

    let page = null;
    if (pathname === '/how-it-works') page = howItWorks();
    else if (pathname === '/accessibility') page = accessibilityPage();
    else if (pathname === '/sponsor') page = sponsor();
    // Switched off, /premium is not a page (the app answers 404).
    else if (pathname === '/premium') page = PREMIUM_ENABLED ? premiumPage() : null;
    else if (m[1] === 'internships') page = m[2] ? (ids.includes(m[2]) ? internshipsMajor(m[2]) : null) : internshipsHub();
    else if (m[1] === 'career-guides') page = m[2] ? guide(m[2]) : guidesIndex();
    else if (m[1] === 'interview-questions') page = m[2] ? interviewCategory(m[2], premium) : interviewHub();
    if (!page) return null;

    const html = shell(dist, page);
    cache.set(key, { at: Date.now(), html });
    return html;
  }

  // ---- App pages that need their own head --------------------------------
  //
  // /home, /privacy and /terms are rendered by the app, but the raw HTML used
  // to carry the home page's title and canonical until the script ran — so a
  // crawler reading it first was told /privacy was a copy of /. The head is
  // set here, and the app keeps it in step once it loads.
  const APP_META = {
    '/': {
      title: seoTitle('Business Internship Finder by ZIP Code'),
      description:
        'A free business internship finder by ZIP code: real internships near you, ranked by fit and distance, with the certifications that fit your major.',
      root: () =>
        `<main id="main"><h1>Find business internships by ZIP code.</h1><p>Real listings near you, free certifications matched to your field, and a ledger that remembers what you have finished.</p>${guideBlock(hub.home, img.home)}</main>`,
      jsonLd: (origin) => [
        faqLd(hub.home?.faqs),
        {
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          name: BRAND,
          url: `${origin}/`,
          applicationCategory: 'EducationalApplication',
          operatingSystem: 'Any (web browser); Windows',
          description: 'Free internship finder and tracker for college students in business majors: search internships by ZIP code, track applications and plan certifications.',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        },
      ],
    },
    '/home': {
      title: seoTitle('Internship Tracker for Business Majors'),
      description:
        'A free internship tracker for business majors: find internships near you, track every application to an offer, and plan the certifications for your field.',
      root: () =>
        `<main id="k-main"><h1>The internship tracker for business majors.</h1><p>Real listings near you, free and low-cost certifications worth putting on a resume, and a ledger that remembers what you have finished.</p>${guideBlock(hub.landing, img.landing)}</main>`,
      jsonLd: () => [faqLd(hub.landing?.faqs)],
    },
    '/terms': {
      title: `Terms and Conditions — ${BRAND}`,
      description:
        'The terms covering Elevate Internships: listings come from third parties, certification costs change, and nothing here is career or financial advice.',
    },
    '/privacy': {
      title: `Privacy Policy — ${BRAND}`,
      description: 'No tracking cookies and no third-party analytics. What is stored, what leaves your machine, and how to stop it.',
    },
  };
  const appCache = new Map();

  /** index.html with this app page's own title, description and canonical; null for any other path. */
  function appPage(dist, pathname) {
    const meta = APP_META[pathname];
    if (!meta) return null;
    if (appCache.has(pathname)) return appCache.get(pathname);
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const origin = (/<link rel="canonical" href="([^"]*?)\/?"/.exec(html) || [])[1] || '';
    const url = `${origin}${pathname}`;
    const set = (re, value) => (h) => h.replace(re, (_, pre, post) => `${pre}${esc(value)}${post}`);
    const out = [
      (h) => h.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(meta.title)}</title>`),
      set(/(<meta\s+name="description"\s+content=")[^"]*(")/, meta.description),
      set(/(<link rel="canonical" href=")[^"]*(")/, url),
      set(/(<meta property="og:url" content=")[^"]*(")/, url),
      set(/(<meta property="og:title" content=")[^"]*(")/, meta.title),
      set(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, meta.description),
      set(/(<meta name="twitter:title" content=")[^"]*(")/, meta.title),
      set(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, meta.description),
      (h) =>
        meta.jsonLd
          ? h.replace(
              '</head>',
              `${meta
                .jsonLd(origin)
                .filter(Boolean)
                .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`)
                .join('\n')}\n</head>`,
            )
          : h,
      (h) => (meta.root ? h.replace('<div id="root"></div>', `<div id="root">${meta.root()}</div>`) : h),
    ].reduce((h, f) => f(h), html);
    appCache.set(pathname, out);
    return out;
  }

  /** Every content path, for the sitemap check and tests. */
  const paths = () => [
    '/internships',
    ...ids.map((id) => `/internships/${id}`),
    '/career-guides',
    ...guideList.map((g) => `/career-guides/${g.slug}`),
    '/interview-questions',
    ...iqList.map((c) => `/interview-questions/${c.slug}`),
    '/how-it-works',
    '/accessibility',
    ...(PREMIUM_ENABLED ? ['/premium'] : []),
  ];

  /** Title, description and path of every content page, for /llms.txt. */
  function summaries() {
    const pick = (p) => {
      const m = CONTENT_PATH.exec(p);
      let page;
      if (p === '/how-it-works') page = howItWorks();
      else if (p === '/accessibility') page = accessibilityPage();
      else if (p === '/premium') page = premiumPage();
      else if (m[1] === 'internships') page = m[2] ? internshipsMajor(m[2]) : internshipsHub();
      else if (m[1] === 'interview-questions') page = m[2] ? interviewCategory(m[2], false) : interviewHub();
      else page = m[2] ? guide(m[2]) : guidesIndex();
      return { path: p, title: page.title.replace(` | ${BRAND}`, ''), description: page.description };
    };
    return {
      internships: ['/internships', ...ids.map((i) => `/internships/${i}`)].map(pick),
      guides: ['/career-guides', ...guideList.map((g) => `/career-guides/${g.slug}`)].map(pick),
      interviews: ['/interview-questions', ...iqList.map((c) => `/interview-questions/${c.slug}`)].map(pick),
      premium: PREMIUM_ENABLED ? [pick('/premium')] : [],
      about: [pick('/how-it-works'), pick('/accessibility')],
      app: ['/', '/home'].map((p) => ({ path: p, title: APP_META[p].title.replace(` | ${BRAND}`, ''), description: APP_META[p].description })),
    };
  }

  return { render, appPage, paths, summaries };
}
