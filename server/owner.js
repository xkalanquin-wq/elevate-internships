// Owner-only access for the Stats page.
//
// The check is server-side. Hiding the tab in React would be theatre — anyone
// could read the bundle and call /api/stats directly — so the endpoint itself
// refuses without a valid session.
//
// The passcode lives in OWNER_PASSCODE in .env. It is never written to code,
// never sent to the browser, and compared in constant time.

import crypto from 'node:crypto';
import { cookiesShouldBeSecure } from './security.js';

const COOKIE = 'cl_owner';
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Per-process secret: restarting invalidates sessions, which is fine here. */
const SECRET = process.env.OWNER_SECRET || crypto.randomBytes(32).toString('hex');

export const ownerConfigured = () => Boolean(process.env.OWNER_PASSCODE);

function sign(expiry) {
  return crypto.createHmac('sha256', SECRET).update(String(expiry)).digest('hex');
}

function makeToken() {
  const expiry = Date.now() + TTL_MS;
  return `${expiry}.${sign(expiry)}`;
}

function validToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [expiryRaw, mac] = token.split('.');
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;

  const expected = sign(expiry);
  const a = Buffer.from(String(mac));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Loopback requests are the machine's own user, who is the owner by definition. */
function isLoopback(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '');
  return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}

/**
 * Gate for owner-only routes.
 *
 * - Passcode set  -> a valid session cookie is required, from anywhere.
 * - Passcode unset -> loopback only, so a deployed instance never exposes the
 *   page by accident just because the owner forgot to configure it.
 */
export function requireOwner(req, res, next) {
  if (!ownerConfigured()) {
    if (isLoopback(req)) return next();
    return res.status(401).json({
      error: 'This page is owner-only. Set OWNER_PASSCODE in .env to unlock it remotely.',
      needsSetup: true,
    });
  }

  if (validToken(readCookie(req, COOKIE))) return next();
  return res.status(401).json({ error: 'Enter the owner passcode to view this page.', needsPasscode: true });
}

/** True for the owner: a valid session, or the machine itself when no passcode is set. */
export function isOwner(req) {
  return ownerConfigured() ? validToken(readCookie(req, COOKIE)) : isLoopback(req);
}

/** Constant-time comparison with OWNER_PASSCODE. False when none is set. */
export function passcodeMatches(passcode) {
  if (!ownerConfigured()) return false;
  const supplied = Buffer.from(String(passcode ?? ''));
  const actual = Buffer.from(String(process.env.OWNER_PASSCODE));

  // Hash both sides so timingSafeEqual sees equal-length buffers and the
  // comparison cannot leak the passcode's length.
  const h = (buf) => crypto.createHash('sha256').update(buf).digest();
  return crypto.timingSafeEqual(h(supplied), h(actual));
}

/** Constant-time passcode check, then set the session cookie. */
export function login(req, res) {
  if (!ownerConfigured()) {
    return res.status(400).json({ error: 'No OWNER_PASSCODE is set on the server.' });
  }
  if (!passcodeMatches(req.body?.passcode)) return res.status(401).json({ error: 'That passcode is not right.' });
  const secure = setOwnerCookie(req, res);
  return res.json({ ok: true, secure });
}

/** Starts an owner session. Returns whether the cookie is Secure. */
export function setOwnerCookie(req, res) {
  // One token, one header. The earlier version minted a second token in an
  // unreachable fallback branch.
  const secure = cookiesShouldBeSecure(req);
  const parts = [
    `${COOKIE}=${encodeURIComponent(makeToken())}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${TTL_MS / 1000}`,
    'Path=/',
  ];
  if (secure) parts.push('Secure');

  res.setHeader('Set-Cookie', parts.join('; '));
  return secure;
}

export function clearOwnerCookie(req, res) {
  const parts = [`${COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', 'Path=/'];
  if (cookiesShouldBeSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function logout(req, res) {
  clearOwnerCookie(req, res);
  res.json({ ok: true });
}

/** Tells the client which UI to show, without revealing anything sensitive. */
export function ownerStatus(req, res) {
  res.json({
    configured: ownerConfigured(),
    authenticated: ownerConfigured() ? validToken(readCookie(req, COOKIE)) : isLoopback(req),
    localAccess: isLoopback(req),
  });
}
