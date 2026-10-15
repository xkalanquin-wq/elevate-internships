// Transport and header hardening.
//
// HTTPS is enforced when deployed, never on localhost — forcing it locally
// would just break the app, since there is no certificate for 127.0.0.1.

const isProd = () => process.env.NODE_ENV === 'production';

/** Explicit opt-out for the rare case of a trusted TLS-terminating sidecar. */
const httpsDisabled = () => String(process.env.FORCE_HTTPS || '').toLowerCase() === 'false';

function isLocal(req) {
  const host = String(req.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
}

/**
 * Behind a load balancer the connection to Node is plain HTTP, so `req.secure`
 * is only trustworthy once Express is told to honour X-Forwarded-Proto. Without
 * this the redirect below would loop forever and `secure` cookies would never
 * be set.
 */
export function configureProxyTrust(app) {
  // 1 = trust the single proxy in front of us (Heroku, Fly, Render, nginx).
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
}

export function forceHttps(req, res, next) {
  if (!isProd() || httpsDisabled() || isLocal(req) || req.secure) return next();

  // Only redirect idempotent requests; 307 on the rest so the body survives.
  const target = `https://${req.headers.host}${req.originalUrl}`;
  const code = req.method === 'GET' || req.method === 'HEAD' ? 301 : 307;
  return res.redirect(code, target);
}

export function securityHeaders(req, res, next) {
  // Tell browsers never to try plain HTTP again. Only meaningful over TLS, and
  // sending it from localhost would poison the developer's own browser for the
  // whole domain, so it is gated.
  if (isProd() && req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // The page loads its own bundle plus, after consent, Google Fonts. Nothing
  // else should ever execute or be embedded.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      // React inline style objects need this; scripts stay strict.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      // The sponsor form posts here and is redirected to Stripe's payment page;
      // browsers apply form-action to that redirect too.
      "form-action 'self' https://checkout.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      ...(isProd() ? ['upgrade-insecure-requests'] : []),
    ].join('; '),
  );

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // No Flash/PDF-era cross-domain policy files, and API answers can only be
  // read by this site's own pages.
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (req.path.startsWith('/api/')) res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Powered-By', '');
  res.removeHeader('X-Powered-By');

  next();
}

/**
 * The policy for a content page that shows Google ads. Google's ad script
 * loads further scripts and frames from many of its own domains, so the
 * policy follows Google's recommended "strict CSP": only the script carrying
 * this response's nonce may run, and 'strict-dynamic' lets the scripts it
 * adds run too. Any other script, including one injected into the page,
 * is still blocked. ('unsafe-inline' and https: are ignored by browsers that
 * understand nonces; they are the fallback for old ones.)
 */
export function adsCsp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "frame-src https:",
    "connect-src 'self' https:",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isProd() ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** True when the response cookie should carry the Secure attribute. */
export const cookiesShouldBeSecure = (req) => Boolean(req.secure) || (isProd() && !isLocal(req));
