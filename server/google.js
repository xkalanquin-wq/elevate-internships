// Sign in with Google (OAuth 2.0 + OpenID Connect).
//
// No SDK: Google's endpoints are plain HTTP and a dependency here would be
// more code to audit than the flow itself.
//
// Disabled until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set — the
// credentials belong to whoever runs the app, and only they can create them.

import crypto from 'node:crypto';
import * as store from './store.js';
import { cookiesShouldBeSecure } from './security.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const STATE_COOKIE = 'cl_oauth_state';

export const googleEnabled = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const redirectUri = (req) => {
  const base = process.env.OAUTH_REDIRECT_BASE || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/+$/, '')}/api/auth/google/callback`;
};

const appUrl = () => (process.env.SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Step 1: bounce the browser to Google with a CSRF state value. */
export function googleStart(req, res) {
  if (!googleEnabled()) {
    return res.status(400).json({ error: 'Google sign-in is not configured on this server.' });
  }

  const state = crypto.randomBytes(24).toString('base64url');
  const parts = [
    `${STATE_COOKIE}=${state}`,
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600',
    'Path=/',
  ];
  if (cookiesShouldBeSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Ask for an account picker rather than silently reusing one.
    prompt: 'select_account',
  });

  res.redirect(`${AUTH_URL}?${params}`);
}

/** Step 2: Google sends the browser back here with a code. */
export async function googleCallback(req, res, startSession) {
  if (!googleEnabled()) return res.redirect(`${appUrl()}/?auth=google_unconfigured`);

  const { code, state, error } = req.query || {};
  if (error) return res.redirect(`${appUrl()}/?auth=google_denied`);

  // CSRF: the state must match the cookie set when the flow started.
  const expected = readCookie(req, STATE_COOKIE);
  const ok =
    expected &&
    state &&
    expected.length === String(state).length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(state)));

  // Clear the state cookie either way.
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);

  if (!ok || !code) return res.redirect(`${appUrl()}/?auth=google_state`);

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}`);
    const { access_token } = await tokenRes.json();

    const infoRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access_token}` } });
    if (!infoRes.ok) throw new Error(`userinfo ${infoRes.status}`);
    const profile = await infoRes.json();

    const subject = profile.sub;
    const email = String(profile.email || '').toLowerCase();
    if (!subject || !email) throw new Error('profile missing sub or email');

    // Only trust an email Google says it verified — otherwise account linking
    // by email would let someone claim an address they do not control.
    if (!profile.email_verified) return res.redirect(`${appUrl()}/?auth=google_unverified`);

    let identity = store.getIdentity('google', subject);
    let user;

    if (identity) {
      user = store.getUserById(identity.user_id);
    } else {
      user = store.getUserByEmail(email);
      if (!user) {
        // Google-only account: no password, which auth.js treats as
        // "password sign-in not available for this account".
        user = store.createUser({ email, name: profile.name || '', passwordHash: '' });
        store.claimOrphanedData(user.id);
      }
      store.linkIdentity('google', subject, user.id);
      // Google has already proven the address.
      store.markEmailVerified(user.id, /\.(edu)(\.[a-z]{2})?$/.test(email.split('@')[1] || ''));
    }

    startSession(req, res, user.id);
    res.redirect(`${appUrl()}/?auth=ok`);
  } catch (err) {
    console.error(`[google] sign-in failed: ${err.message}`);
    res.redirect(`${appUrl()}/?auth=google_failed`);
  }
}
