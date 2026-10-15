// Works out which career track a search belongs to, so a teaching candidate is
// never handed the finance ledger.

/**
 * Score every track's match list against the user's major and interests.
 * The major counts for more than an interest, and a whole-phrase hit counts
 * for more than a word that merely appears inside a longer phrase.
 */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-word containment. Plain `includes` would match "IT" inside
 * "nonprofIT management" and hand a nonprofit student the IT track.
 */
function containsPhrase(haystack, needle) {
  return new RegExp(`(^|[^a-z0-9])${escape(needle)}($|[^a-z0-9])`, 'i').test(haystack);
}

export function detectField(query, tracks) {
  const major = String(query.major || '').toLowerCase().trim();
  const interests = (query.interests || []).map((s) => String(s).toLowerCase().trim());

  let best = null;
  let bestScore = 0;

  for (const [id, track] of Object.entries(tracks)) {
    if (!major && !interests.length) break;

    // Take the strongest single signal rather than the sum. Summing lets a
    // track with many loosely-related phrases win: "Management" would hit
    // "hotel management", "event management", "sports management" and so on,
    // and out-score the Management track's own exact match.
    let majorScore = 0;
    let interestBest = 0;
    let interestHits = 0;

    for (const term of track.match) {
      if (major === term) {
        majorScore = Math.max(majorScore, 30);
      } else if (containsPhrase(major, term)) {
        // Weight by how much of the major the term actually covers, so
        // "risk management" beats a bare "management" inside
        // "Risk Management & Insurance".
        const coverage = major.length ? term.length / major.length : 0;
        majorScore = Math.max(majorScore, 18 + coverage * 12);
      } else if (major.length > 3 && containsPhrase(term, major)) {
        majorScore = Math.max(majorScore, 10);
      }

      for (const interest of interests) {
        let s = 0;
        if (interest === term) s = 12;
        else if (containsPhrase(interest, term)) s = 6;
        else if (interest.length > 3 && containsPhrase(term, interest)) s = 4;
        if (s > 0) {
          interestBest = Math.max(interestBest, s);
          interestHits += 1;
        }
      }
    }

    // Extra interest matches break ties without ever overtaking the major.
    const score = majorScore + interestBest + Math.min(interestHits, 4);

    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }

  // Below this the guess is noise, and a wrong track is worse than none.
  return bestScore >= 12 ? { id: best, score: bestScore, ...tracks[best] } : null;
}

/** Turn a catalog entry into a ledger row. */
export function catalogToLedgerItem(cert, groupId) {
  return {
    id: cert.id,
    group: groupId,
    title: cert.title,
    provider: cert.provider,
    desc: cert.desc,
    hours: cert.hours,
    cost: cert.cost,
    price: cert.price || '',
    links: cert.url ? [{ label: 'Open', url: cert.url }] : [],
    // The major this certification belongs to, so a finished one can be
    // shared with a link to that major's page.
    field: cert.field,
  };
}

/**
 * Build a track's starter items. The finance track keeps the original seed
 * data verbatim; every other track is assembled from the catalog.
 *
 * Each item goes in its own catalog group. The ledger draws every group by
 * id (index.js ALL_GROUPS), so a group the track does not list still shows.
 * Spreading items over the track's own groups instead put Khan Academy's free
 * macroeconomics course under "The credential path". Only an entry with no
 * group is spread across the track's groups in order.
 */
export function buildTrackItems(track, { ledgerItems, catalog }) {
  if (track.source === 'ledger-items') return ledgerItems;

  const byId = new Map(catalog.map((c) => [c.id, c]));
  const groups = track.groups;

  return track.source
    .map((id, i) => {
      const cert = byId.get(id);
      if (!cert) return null;
      const group = cert.group || groups[i % groups.length].id;
      return catalogToLedgerItem(cert, group);
    })
    .filter(Boolean);
}
