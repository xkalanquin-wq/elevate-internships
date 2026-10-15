// Abuse protection. There is no public form to spam here, so the real risks are
// a runaway client burning a metered API quota (Adzuna's free tier is 250/day)
// or racking up Claude API charges, plus oversized/garbage input.

/** Fixed-window limiter, in memory. Enough for a single-user local app. */
function limiter({ windowMs, max, name }) {
  const hits = new Map();

  return (req, res, next) => {
    const key = req.ip || 'local';
    const now = Date.now();
    const rec = hits.get(key);

    if (!rec || now > rec.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
    } else if (rec.count >= max) {
      const retry = Math.ceil((rec.reset - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({
        error: `Too many ${name} requests. Try again in ${retry}s.`,
        retryAfter: retry,
      });
    } else {
      rec.count += 1;
    }

    // Opportunistic cleanup so the map cannot grow without bound.
    if (hits.size > 500) {
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    }
    next();
  };
}

/** Searches fan out to five upstream APIs, two of them metered. */
export const searchLimiter = limiter({ windowMs: 60_000, max: 20, name: 'search' });

/** Each call costs real money, so keep it tight. */
export const suggestLimiter = limiter({ windowMs: 60_000, max: 5, name: 'suggestion' });

/** Writes are cheap but should not be floodable. */
export const writeLimiter = limiter({ windowMs: 60_000, max: 120, name: 'write' });

/** Outbound URL check; keep it off internal hosts. */
export const checkLimiter = limiter({ windowMs: 60_000, max: 30, name: 'link check' });

/** Brute-force protection on the owner passcode: deliberately strict. */
export const loginLimiter = limiter({ windowMs: 15 * 60_000, max: 8, name: 'sign-in' });

/** Every request from one visitor, across the whole site: a flood ceiling. */
export const siteLimiter = limiter({ windowMs: 60_000, max: 600, name: 'page' });

/** Error reports from browsers: a broken page must not become a flood. */
export const clientErrorLimiter = limiter({ windowMs: 60_000, max: 10, name: 'error report' });

/** Opening a payment page or sending a test notification. */
export const payLimiter = limiter({ windowMs: 15 * 60_000, max: 10, name: 'payment' });

/** Strip control characters and cap length on anything a user typed. */
export function clean(value, maxLen = 120) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    .trim()
    .slice(0, maxLen);
}

/**
 * The link checker fetches a URL the client supplies, which is an SSRF shape.
 * Only allow public http(s) targets — never localhost or private ranges.
 */
export function isSafePublicUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return { ok: false, reason: 'Not a valid URL.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https are allowed.' };
  }

  const host = u.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^0\./.test(host) ||
    host === '169.254.169.254'; // cloud metadata

  if (blocked) return { ok: false, reason: 'That host is not allowed.' };
  return { ok: true };
}
