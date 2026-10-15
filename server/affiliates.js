// Affiliate links for certifications.
//
// server/data/affiliates.json lists the programs the operator has been
// approved for, keyed by the provider's hostname, and how to turn an ordinary
// course link into a tracked one:
//
//   "corporatefinanceinstitute.com": { "append": { "via": "yourcode" } }
//   "coursera.org": { "template": "https://example.net/c/123?u={url}" }
//
// `append` adds query parameters to the course's own URL; `template` wraps
// the URL-encoded course link in the network's redirect link. Anything not
// listed keeps its plain link. The rewrite happens once, when the catalog is
// loaded, so every page that links to a certification uses the same link,
// and each rewritten one carries `affiliate: true` so pages can disclose it
// and mark the link rel="sponsored".
//
// Commission never feeds into ranking: rank.js does not read `affiliate`.

export const AFFILIATE_NOTE =
  'Some certification links are affiliate links: if you pay for a course after clicking one, this site may earn a commission, at no extra cost to you. It never changes which certifications are listed or how they are ranked.';

function ruleFor(hostname, programs) {
  const host = hostname.replace(/^www\./, '');
  const key = Object.keys(programs).find((k) => host === k || host.endsWith(`.${k}`));
  return key ? programs[key] : null;
}

/** The tracked link for `url`, or null when no program covers it or the rule is unusable. */
export function affiliateUrl(url, programs = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const rule = ruleFor(u.hostname, programs);
  if (!rule) return null;

  if (typeof rule.template === 'string') {
    if (!rule.template.startsWith('https://') || !rule.template.includes('{url}')) return null;
    return rule.template.replace('{url}', encodeURIComponent(url));
  }
  if (rule.append && typeof rule.append === 'object') {
    const entries = Object.entries(rule.append).filter(([k, v]) => k && typeof v === 'string' && v);
    if (!entries.length) return null;
    for (const [k, v] of entries) u.searchParams.set(k, v);
    return u.href;
  }
  return null;
}

/** The catalog with affiliate links swapped in. Unlisted providers are unchanged. */
export function applyAffiliates(catalog, config) {
  const programs = config?.programs || {};
  if (!Object.keys(programs).length) return catalog;
  return catalog.map((c) => {
    const tracked = affiliateUrl(c.url, programs);
    return tracked ? { ...c, url: tracked, affiliate: true } : c;
  });
}

/** rel for a certification link. */
export const certRel = (c) => (c.affiliate ? 'sponsored noopener' : 'noopener');
