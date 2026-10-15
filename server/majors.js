// The per-major pages: /certifications (all majors) and /certifications/<id>.
//
// The data is the same the Finder uses. What is different is that the page is
// sent with its content already written into the HTML, because a search engine
// ranks what it can read on arrival — an empty <div id="root"> ranks for
// nothing. React then replaces that markup with the interactive page.

import fs from 'node:fs';
import path from 'node:path';
import { AFFILIATE_NOTE, certRel } from './affiliates.js';
import { cardSvg, faqHtml, faqLd, figure, fitDescription, seoTitle, titleName } from './seo.js';
import { esc } from './html.js';

export const MAJOR_PATH = /^\/certifications(?:\/([a-z-]+))?$/;

const COST_ORDER = { free: 0, audit: 1, check: 2, paid: 3, ref: 4 };
const COST_LABEL = { free: 'Free', audit: 'Free to audit', check: 'Check your campus', paid: 'Paid', ref: 'Reference' };

/**
 * What earning the credential costs, in whole dollars, for the page's
 * "Under $100" filter. Free ones are 0. For a paid one, or the certificate of
 * a free-to-audit course, it is the first amount in its price note, which is
 * written cheapest-route first ("$79 for full-time students ($350 standard)").
 * Null when there is no single figure to trust — a monthly subscription, a
 * price that depends on your campus or country, a reference page — so those
 * never show up as cheap by accident.
 */
export function startingPrice(c) {
  if (c.cost === 'free') return 0;
  if (c.cost !== 'paid' && c.cost !== 'audit') return null;
  const text = c.price || '';
  if (/\/(month|mo|yr|year)\b|per month|subscription|under \$/i.test(text)) return null;
  const m = /\$([\d,]+)/.exec(text);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

export function createMajors({ tracks, catalog, certGuides = {}, hub = {}, images }) {
  const ids = Object.keys(tracks).filter((id) => !id.startsWith('_') && Array.isArray(tracks[id].source));
  const byId = new Map(catalog.map((c) => [c.id, c]));

  // One illustration per page: the starter set for a major, and the how-to-
  // choose steps for the index.
  const pictures = {};
  for (const id of ids) {
    const lower = tracks[id].name.toLowerCase();
    const starter = tracks[id].source.map((cid) => byId.get(cid)).filter(Boolean).slice(0, 5);
    pictures[id] = images
      ? images.add(`best-certifications-for-${id}-students`, `Best certifications for ${lower} students, in order: ${starter.slice(0, 3).map((c) => c.title).join(', ')}`, () =>
          cardSvg({ eyebrow: `${tracks[id].name} starter set`, title: `Best certifications for ${lower} students`, rows: starter.map((c) => ({ label: c.provider, text: c.title })) }),
        )
      : null;
  }
  const hubCopy = hub.certifications || {};
  const hubPicture =
    images && hubCopy.image
      ? images.add(hubCopy.image.name, hubCopy.image.alt, () =>
          cardSvg({ eyebrow: 'Certifications', title: 'Certifications for business majors', rows: (hubCopy.steps || []).map((t) => ({ text: t })) }),
        )
      : null;

  /** Starter set first, in its own order; then the rest, free before paid. */
  function certifications(id) {
    const track = tracks[id];
    if (!track) return [];
    const starter = track.source;
    return catalog
      .filter((c) => c.field === id || (c.fields || []).includes(id) || starter.includes(c.id))
      .sort((a, b) => {
        const sa = starter.indexOf(a.id);
        const sb = starter.indexOf(b.id);
        if (sa !== -1 || sb !== -1) return (sa === -1 ? 1e9 : sa) - (sb === -1 ? 1e9 : sb);
        return (COST_ORDER[a.cost] ?? 9) - (COST_ORDER[b.cost] ?? 9) || a.title.localeCompare(b.title);
      });
  }

  function payload(id) {
    const track = tracks[id];
    if (!track || !ids.includes(id)) return null;
    return {
      id,
      name: track.name,
      note: track.note,
      timeline: track.timeline || [],
      starter: track.source,
      certifications: certifications(id).map((c) => ({
        id: c.id,
        title: c.title,
        provider: c.provider,
        url: c.url,
        hours: c.hours,
        cost: c.cost,
        price: c.price,
        priceFrom: startingPrice(c),
        desc: c.desc,
        field: c.field,
        affiliate: Boolean(c.affiliate),
      })),
      guide: certGuides[id] || null,
      meta: meta(id),
      image: pictures[id] || null,
    };
  }

  function meta(id) {
    if (!id) {
      return {
        title: seoTitle('Best Certifications for Business Majors'),
        description: `Certifications for business majors, by field: the free and paid ones worth your time for ${ids.length} majors, with real prices and recruiting timelines.`,
        path: '/certifications',
      };
    }
    const t = tracks[id];
    const n = certifications(id).length;
    return {
      title: seoTitle(`Best Certifications for ${titleName(id, t.name)} Students`),
      description: fitDescription(
        `The best certifications for ${t.name.toLowerCase()} students: ${n} free and paid options ranked, with real costs and which to do first.`,
        `The best certifications for ${titleName(id, t.name).toLowerCase()} students: ${n} options ranked, with real costs and which to do first.`,
      ),
      path: `/certifications/${id}`,
    };
  }

  function body(id) {
    const nav = `<p><a href="/certifications">All majors</a> · <a href="/">Search internships</a></p>`;
    if (!id) {
      const list = ids
        .map((m) => `<li><a href="/certifications/${m}">${esc(tracks[m].name)}</a> — ${esc(tracks[m].note)} (${certifications(m).length} certifications)</li>`)
        .join('');
      return `<main class="ssr-major"><h1>Certifications for business majors</h1><p>Which certifications are worth your time, what they really cost, and when your field recruits interns.</p>${(hubCopy.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join('')}${figure(hubPicture)}${
        hubCopy.steps?.length ? `<h3>Step by step</h3><ol>${hubCopy.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''
      }<h2>Pick your major</h2><ul>${list}</ul><h2>Questions students ask</h2>${faqHtml(hubCopy.faqs)}${nav}</main>`;
    }
    const t = tracks[id];
    const g = certGuides[id];
    const timeline = (t.timeline || [])
      .map((s) => `<li><strong>${esc(s.when)}</strong> — ${esc(s.what)}</li>`)
      .join('');
    const certs = certifications(id)
      .map(
        (c) =>
          `<li><a href="${esc(c.url)}" rel="${certRel(c)}">${esc(c.title)}</a> — ${esc(c.provider)}. ${esc(COST_LABEL[c.cost] || c.cost)}${c.price ? `: ${esc(c.price)}` : ''} ${esc(c.desc)}</li>`,
      )
      .join('');
    const others = ids
      .filter((m) => m !== id)
      .map((m) => `<a href="/certifications/${m}">${esc(tracks[m].name)}</a>`)
      .join(' · ');
    return (
      `<main class="ssr-major"><h1>Best certifications for ${esc(t.name.toLowerCase())} students</h1><p>${esc(t.note)}</p>` +
      `<p><a href="/internships/${id}">${esc(t.name)} internships for college students</a></p>` +
      (timeline ? `<h2>When ${esc(t.name.toLowerCase())} recruits</h2><ol>${timeline}</ol>` : '') +
      (g ? `<p>${esc(g.intro)}</p>` : '') +
      figure(pictures[id]) +
      (g?.choose?.length ? `<h2>How to choose</h2><ul>${g.choose.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '') +
      `<h2>Certifications for ${esc(t.name)} majors</h2><ul>${certs}</ul>` +
      (certifications(id).some((c) => c.affiliate) ? `<p><small>${esc(AFFILIATE_NOTE)}</small></p>` : '') +
      (g?.faqs?.length ? `<h2>Questions students ask</h2>${faqHtml(g.faqs)}` : '') +
      `<h2>Other majors</h2><p>${others}</p>${nav}</main>`
    );
  }

  // Built HTML is fixed for the life of the process, so each page is rendered
  // once and kept.
  const rendered = new Map();

  function render(dist, id) {
    const key = id || '';
    if (rendered.has(key)) return rendered.get(key);

    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const origin = (/<link rel="canonical" href="([^"]*?)\/?"/.exec(html) || [])[1] || '';
    const m = meta(id);
    const url = `${origin}${m.path}`;
    const set = (re, value) => (out) => out.replace(re, (_, pre, post) => `${pre}${esc(value)}${post}`);

    const out = [
      (h) => h.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(m.title)}</title>`),
      set(/(<meta\s+name="description"\s+content=")[^"]*(")/, m.description),
      set(/(<link rel="canonical" href=")[^"]*(")/, url),
      set(/(<meta property="og:url" content=")[^"]*(")/, url),
      set(/(<meta property="og:title" content=")[^"]*(")/, m.title),
      set(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, m.description),
      set(/(<meta name="twitter:title" content=")[^"]*(")/, m.title),
      set(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, m.description),
      (h) => {
        const ld = faqLd(id ? certGuides[id]?.faqs : hubCopy.faqs);
        return ld ? h.replace('</head>', `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n</head>`) : h;
      },
      (h) => h.replace('<div id="root"></div>', `<div id="root">${body(id)}</div>`),
    ].reduce((h, f) => f(h), html);

    rendered.set(key, out);
    return out;
  }

  return { ids, certifications, payload, render, meta };
}
