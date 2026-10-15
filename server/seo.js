// Shared search and AI-search helpers: page titles, FAQ markup, the
// illustration on each content page, and /llms.txt.
//
// Every indexable page targets one search phrase (see store/SEO-KEYWORDS.md),
// and no two pages share one. The phrase appears in the <title>, the H1, the
// meta description, the image file name and its alt text.

import { esc } from './html.js';

export const BRAND = 'Elevate Internships';

/** "<phrase> | Elevate Internships" when that fits in 60 characters, else the phrase alone. */
export function seoTitle(phrase) {
  const withBrand = `${phrase} | ${BRAND}`;
  return withBrand.length <= 60 ? withBrand : phrase;
}

/** The first wording that fits in a search snippet (about 155 characters). */
export function fitDescription(...options) {
  return options.find((d) => d.length <= 155) || options[options.length - 1];
}

/**
 * Shorter names for titles, where the full major name would push past 60
 * characters or is not the phrase students search ("sales internships").
 */
const TITLE_NAME = {
  mis: 'MIS',
  risk: 'Risk Management & Insurance',
  hospitality: 'Hospitality Management',
  'supply-chain': 'Supply Chain',
  'retail-management': 'Retail Management',
  sales: 'Sales',
};
export const titleName = (id, name) => TITLE_NAME[id] || name;

/** schema.org FAQPage for questions that are shown on the page. */
export function faqLd(faqs) {
  if (!faqs?.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

/** Visible questions and answers, matching the FAQPage markup. */
export const faqHtml = (faqs) => (faqs || []).map((f) => `<div class="faq"><h3>${esc(f.q)}</h3><p>${esc(f.a)}</p></div>`).join('');

export const figure = (img) =>
  img
    ? `<figure class="page-figure"><img src="${esc(img.src)}" alt="${esc(img.alt)}" width="1200" height="630" loading="lazy" decoding="async"></figure>`
    : '';

// ---- Illustrations ------------------------------------------------------------
//
// One per content page, drawn from the page's own data (a recruiting timeline,
// a starter set, a guide's steps), so it adds information rather than
// decoration. Served as SVG: sharp at any size, a few KB, indexable text.

function wrap(text, max) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) {
      lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

/** A 1200×630 card: eyebrow, title, and up to six numbered rows. */
export function cardSvg({ eyebrow, title, rows }) {
  const items = rows.slice(0, 6);
  const titleLines = wrap(title, 44).slice(0, 2);
  let y = 96 + titleLines.length * 50 + 24;
  const rowGap = Math.min(78, Math.floor((600 - y) / Math.max(items.length, 1)));
  const rowsSvg = items
    .map((r, i) => {
      const top = y + i * rowGap;
      const all = wrap(r.text, r.label ? 62 : 70);
      const text = all.slice(0, rowGap >= 70 ? 2 : 1);
      // A row cut short says so, instead of stopping mid-sentence.
      if (all.length > text.length) text[text.length - 1] = `${text[text.length - 1].replace(/[\s,;:—-]+$/, '')}…`;
      const label = r.label
        ? `<text x="140" y="${top + 22}" font-family="Consolas, 'IBM Plex Mono', monospace" font-size="17" fill="#1e3a5f" font-weight="700">${esc(
            r.label.toUpperCase().slice(0, 40),
          )}</text>`
        : '';
      const textTop = r.label ? top + 48 : top + 30;
      return `<circle cx="92" cy="${top + 22}" r="22" fill="#1e3a5f"/><text x="92" y="${top + 29}" text-anchor="middle" font-family="Georgia, serif" font-size="20" fill="#fff" font-weight="700">${i + 1}</text>${label}${text
        .map((t, k) => `<text x="140" y="${textTop + k * 24}" font-family="'Segoe UI', Arial, sans-serif" font-size="20" fill="#0f172a">${esc(t)}</text>`)
        .join('')}`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${esc(title)}">
<rect width="1200" height="630" fill="#f7f9fc"/><rect x="0" y="0" width="1200" height="10" fill="#1e3a5f"/>
<text x="70" y="70" font-family="Consolas, 'IBM Plex Mono', monospace" font-size="18" letter-spacing="3" fill="#475569">${esc(String(eyebrow).toUpperCase())}</text>
${titleLines.map((t, i) => `<text x="70" y="${120 + i * 50}" font-family="Georgia, 'Times New Roman', serif" font-size="42" font-weight="700" fill="#0f172a">${esc(t)}</text>`).join('')}
${rowsSvg}
<text x="1130" y="600" text-anchor="end" font-family="Georgia, serif" font-size="20" font-weight="700" fill="#1e3a5f">${BRAND}</text>
</svg>`;
}

/** Registry of the illustrations: file name -> { alt, svg() }. */
export function createImages() {
  const images = new Map();
  const add = (name, alt, draw) => {
    images.set(name, { alt, draw });
    return { src: `/images/${name}.svg`, alt };
  };
  return {
    add,
    get: (name) => images.get(name) || null,
    names: () => [...images.keys()],
  };
}

// ---- /llms.txt ------------------------------------------------------------------
//
// A plain-text map of the site for AI assistants (the llms.txt convention):
// what the site is, then every page worth reading with one line on each.

export function llmsTxt({ origin, pages, majors }) {
  // "Accounting", "Supply Chain & Operations" -> "accounting, …, and supply chain and operations"
  const names = majors.map((m) => m.toLowerCase().replace(/ & /g, ' and '));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}` : names.join('');
  const lines = [
    `# ${BRAND}`,
    '',
    `> ${BRAND} is a free internship finder and tracker for U.S. college students in business majors. It searches real internship listings by ZIP code and distance — including employers' own career pages on Greenhouse, Lever, Ashby and SmartRecruiters — and lists the free and paid certifications that fit each of ${majors.length} business majors, with each field's recruiting timeline.`,
    '',
    'Key facts:',
    '- Free to use; no account needed to search. A free account adds application tracking, reminders and a weekly email of new matches.',
    `- Covers ${majors.length} business majors: ${list}.`,
    '- Listings come from employer job boards and public feeds; older than nine months, non-U.S. and duplicate listings are removed.',
    '- Certifications are labelled free, free to audit, check your campus, paid (with price) or reference.',
    '',
  ];
  for (const [section, items] of pages) {
    lines.push(`## ${section}`, '');
    for (const p of items) lines.push(`- [${p.title}](${origin}${p.path}): ${p.description}`);
    lines.push('');
  }
  return lines.join('\n');
}
