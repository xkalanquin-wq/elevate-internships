// Account auth: sign up, sign in, sessions.
//
// Passwords are hashed with scrypt — a memory-hard KDF built into Node, so
// there is no native dependency to compile. Plaintext passwords are never
// stored, logged, or returned.
//
// Sessions are random opaque tokens. Only a SHA-256 hash of each token is
// stored, so a leaked database cannot be used to impersonate anyone, and a
// session can be revoked server-side (an HMAC-only token cannot).

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import * as store from './store.js';
import { cookiesShouldBeSecure } from './security.js';
import { emailProvider, sendMail } from './email.js';
import { cleanRef } from './commerce.js';

const scrypt = promisify(crypto.scrypt);

/**
 * A real hash of a value nobody knows, verified against when an email has no
 * account. Without this, a failed lookup would return far faster than a failed
 * password check and leak which addresses are registered.
 * Computed once at startup.
 */
let DUMMY_HASH = null;

const COOKIE = 'cl_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

// scrypt cost. N must be a power of two; 2^15 is a reasonable modern default
// and takes ~100ms here, which is the point.
//
// Node caps scrypt memory at 32 MB by default, and this needs 128 * N * r
// (~33.5 MB), so maxmem is raised rather than weakening N.
const SCRYPT_MAXMEM = 96 * 1024 * 1024;
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: SCRYPT_MAXMEM };

// ---- Passwords -------------------------------------------------------------

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    // Parameters come from the stored hash, so old hashes keep verifying if
    // the cost is ever raised for new ones.
    const actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT_MAXMEM,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Called once at boot so the first sign-in attempt is not slower than the rest. */
export async function initAuth() {
  DUMMY_HASH = await hashPassword(crypto.randomBytes(24).toString('hex'));
}

// ---- Validation ------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function validateCredentials({ email, password, name }) {
  const errors = {};
  const e = String(email || '').trim().toLowerCase();

  if (!e) errors.email = 'Enter your email.';
  else if (e.length > 200) errors.email = 'That email is too long.';
  else if (!EMAIL_RE.test(e)) errors.email = 'That does not look like an email address.';

  const pw = String(password || '');
  if (!pw) errors.password = 'Enter a password.';
  // NIST guidance: length is what matters, arbitrary composition rules do not.
  else if (pw.length < 10) errors.password = 'Use at least 10 characters.';
  else if (pw.length > 200) errors.password = 'That password is too long.';

  if (name !== undefined && String(name).length > 80) errors.name = 'Keep your name under 80 characters.';

  return { errors, email: e, password: pw };
}

// ---- Sessions --------------------------------------------------------------

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setSessionCookie(req, res, token) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MS / 1000}`,
    'Path=/',
  ];
  if (cookiesShouldBeSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [`${COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', 'Path=/'];
  if (cookiesShouldBeSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  store.createSession(hashToken(token), userId, new Date(Date.now() + SESSION_MS).toISOString());
  setSessionCookie(req, res, token);

  // Counted here rather than in the login route, so every path that starts a
  // session is included — password sign-in, sign-up, password reset and the
  // OAuth callback. The sessions table only holds *live* sessions, so without
  // this counter a sign-in leaves no trace once the person signs out.
  store.recordLogin(userId);
}

/** Resolves the signed-in user, or null. Never throws. */
export function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const session = store.getSession(hashToken(token));
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    store.deleteSession(hashToken(token));
    return null;
  }
  return store.getUserById(session.user_id);
}

/** Gate for routes that hold personal data. */
export function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to see this.', needsAuth: true });
  req.user = user;
  next();
}

// ---- Routes ----------------------------------------------------------------

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name || '',
  createdAt: u.created_at,
  emailVerified: Boolean(u.email_verified_at),
  isEdu: Boolean(u.is_edu),
  remindEmail: Boolean(u.remind_email),
  premium: store.isPremium(u),
  premiumUntil: u.premium_until || null,
  hasPassword: Boolean(u.password_hash),
  linked: store.identitiesForUser(u.id),
});

export async function signup(req, res) {
  // Bot trap: a field people never see or fill in.
  if (req.body?.website) return res.status(400).json({ error: 'That account could not be created. Try again.' });
  const { errors, email, password } = validateCredentials(req.body || {});
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
  }

  if (store.getUserByEmail(email)) {
    // Deliberately specific here: on signup, "already registered" is the only
    // useful message, and the address is one the person already typed.
    return res.status(409).json({ error: 'That email already has an account. Sign in instead.', fields: { email: 'Already registered.' } });
  }

  const user = store.createUser({ email, name, passwordHash: await hashPassword(password) });

  // The referral or campus-ambassador code from the link they arrived by.
  const ref = cleanRef(req.body?.ref);
  if (ref) store.setUserFields(user.id, { ref_code: ref });

  // The very first account adopts any data created before accounts existed,
  // so upgrading an existing install does not silently orphan a ledger.
  const adopted = store.claimOrphanedData(user.id);

  startSession(req, res, user.id);

  // Confirmation is best-effort: a mail provider may not be configured, and
  // that must not block someone from using the app.
  let verification = { delivered: false, provider: emailProvider() };
  try {
    const token = await issueToken(user, 'verify', 24 * 60 * 60 * 1000);
    verification = await sendMail({
      to: user.email,
      subject: 'Confirm your Elevate Internships email',
      text: [
        `Hi${name ? ` ${name}` : ''},`,
        '',
        'Confirm your email address:',
        '',
        `${APP_URL()}/verify?token=${token}`,
        '',
        'The link is good for 24 hours.',
      ].join('\n'),
    });
  } catch (err) {
    console.error(`[auth] verification email failed: ${err.message}`);
  }

  res.json({
    user: publicUser(store.getUserById(user.id)),
    adopted,
    looksAcademic: isAcademicEmail(email),
    verificationSent: verification.delivered,
  });
}

// Failed sign-ins per email address. The per-visitor limit (guard.js) stops
// one computer guessing; this stops many computers guessing one account.
// Counted for any address, registered or not, so it reveals nothing.
const FAIL_WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;
const failures = new Map();

function tooManyFailures(email) {
  const rec = failures.get(email);
  if (!rec || Date.now() > rec.reset) return 0;
  return rec.count >= MAX_FAILS ? Math.ceil((rec.reset - Date.now()) / 60_000) : 0;
}

function recordFailure(email) {
  const now = Date.now();
  const rec = failures.get(email);
  if (!rec || now > rec.reset) failures.set(email, { count: 1, reset: now + FAIL_WINDOW_MS });
  else rec.count += 1;
  if (failures.size > 5000) for (const [k, v] of failures) if (now > v.reset) failures.delete(k);
}

export async function login(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
  const password = String(req.body?.password || '').slice(0, 200);

  const wait = email && tooManyFailures(email);
  if (wait) {
    res.set('Retry-After', String(wait * 60));
    return res.status(429).json({
      error: `Too many wrong passwords for this account. Try again in ${wait} minute${wait === 1 ? '' : 's'}, or use "Forgot password?".`,
    });
  }

  const user = email ? store.getUserByEmail(email) : null;

  // Always run a full verification, even when the account does not exist or
  // has no password, so response time cannot be used to enumerate which
  // emails are registered.
  const stored = user?.password_hash || DUMMY_HASH;
  const matched = await verifyPassword(password, stored);

  // A Google-only account has an empty password hash; it can never match.
  if (user && !user.password_hash) {
    return res.status(401).json({
      error: 'This account signs in with Google. Use the Google button, or set a password from your account page.',
    });
  }

  if (!user || !matched) {
    if (email) recordFailure(email);
    return res.status(401).json({ error: 'That email and password do not match.' });
  }

  failures.delete(email);
  startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
}

export function logout(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) store.deleteSession(hashToken(token));
  clearSessionCookie(req, res);
  res.json({ ok: true });
}

export function me(req, res) {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null });
}

// ---- Email verification and .edu status ------------------------------------

/** Recognises US .edu and common international academic suffixes. */
export function isAcademicEmail(email) {
  const domain = String(email).toLowerCase().split('@')[1] || '';
  return (
    domain.endsWith('.edu') ||
    /\.(ac|edu)\.[a-z]{2}$/.test(domain) || // ac.uk, edu.au, ac.nz …
    domain.endsWith('.edu.pl') ||
    domain.endsWith('.uni.edu')
  );
}

const APP_URL = () => (process.env.SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');

async function issueToken(user, purpose, ttlMs) {
  const token = crypto.randomBytes(32).toString('base64url');
  store.createToken(hashToken(token), user.id, purpose, new Date(Date.now() + ttlMs).toISOString());
  return token;
}

export async function sendVerification(req, res) {
  const user = req.user;
  if (user.email_verified_at) return res.json({ ok: true, alreadyVerified: true });

  const token = await issueToken(user, 'verify', 24 * 60 * 60 * 1000);
  const link = `${APP_URL()}/verify?token=${token}`;

  const result = await sendMail({
    to: user.email,
    subject: 'Confirm your Elevate Internships email',
    text: [
      `Hi${user.name ? ` ${user.name}` : ''},`,
      '',
      'Confirm your email address to finish setting up your account:',
      '',
      link,
      '',
      'The link is good for 24 hours. If you did not create an account, ignore this.',
    ].join('\n'),
  });

  // Tell the truth about whether it actually went anywhere.
  res.json({ ok: true, delivered: result.delivered, provider: result.provider });
}

export function verifyEmail(req, res) {
  const token = String(req.query?.token || req.body?.token || '');
  if (!token) return res.status(400).json({ error: 'Missing token.' });

  const row = store.consumeToken(hashToken(token), 'verify');
  if (!row) return res.status(400).json({ error: 'That link has expired or already been used.' });

  const user = store.getUserById(row.user_id);
  if (!user) return res.status(400).json({ error: 'That account no longer exists.' });

  store.markEmailVerified(user.id, isAcademicEmail(user.email));
  res.json({ ok: true, isEdu: isAcademicEmail(user.email) });
}

// ---- Password reset --------------------------------------------------------

export async function requestReset(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  // Bot trap as on sign-up; answered like any other request.
  const user = email && !req.body?.website ? store.getUserByEmail(email) : null;

  if (user) {
    const token = await issueToken(user, 'reset', 60 * 60 * 1000);
    const link = `${APP_URL()}/reset?token=${token}`;
    await sendMail({
      to: user.email,
      subject: 'Reset your Elevate Internships password',
      text: [
        'Someone asked to reset the password on this account.',
        '',
        link,
        '',
        'The link is good for one hour and can be used once.',
        'If this was not you, nothing has changed — ignore this message.',
      ].join('\n'),
    });
  }

  // Always the same answer, so this cannot be used to discover which addresses
  // have accounts.
  res.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' });
}

export async function performReset(req, res) {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');

  if (password.length < 10) return res.status(400).json({ error: 'Use at least 10 characters.' });

  const row = store.consumeToken(hashToken(token), 'reset');
  if (!row) return res.status(400).json({ error: 'That link has expired or already been used.' });

  const user = store.getUserById(row.user_id);
  if (!user) return res.status(400).json({ error: 'That account no longer exists.' });

  store.updatePassword(user.id, await hashPassword(password));
  // Anyone holding an old session is signed out — the point of a reset.
  store.deleteSessionsForUser(user.id);
  startSession(req, res, user.id);

  res.json({ ok: true, user: publicUser(user) });
}

// ---- Data export and deletion ----------------------------------------------

export function exportData(req, res) {
  const data = store.exportUserData(req.user.id);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="career-launchpad-${stamp}.json"`);
  res.send(JSON.stringify(data, null, 2));
}

export function exportCsv(req, res) {
  const { ledger, completed, trackedInternships } = store.exportUserData(req.user.id);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const rows = [
    ['Title', 'Provider', 'Group', 'Cost', 'Price', 'Hours', 'Completed', 'Completed on', 'Link'],
    ...ledger.map((i) => [
      i.title,
      i.provider,
      i.group,
      i.cost,
      i.price || '',
      i.hours,
      completed[i.id] ? 'yes' : 'no',
      completed[i.id] ? String(completed[i.id]).slice(0, 10) : '',
      i.links?.[0]?.url || '',
    ]),
  ];

  // The application tracker follows, as its own table under a blank line.
  if (trackedInternships.length) {
    rows.push(
      [],
      ['Internship', 'Company', 'Location', 'Stage', 'Note', 'Tracked since', 'Last updated', 'Link'],
      ...trackedInternships.map((j) => [
        j.title,
        j.company,
        j.location || '',
        j.status,
        j.note || '',
        String(j.createdAt || '').slice(0, 10),
        String(j.updatedAt || '').slice(0, 10),
        j.url || j.jobKey,
      ]),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="career-launchpad-${stamp}.csv"`);
  res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
}

export function deleteAccount(req, res) {
  const confirm = String(req.body?.email || '').trim().toLowerCase();
  if (confirm !== req.user.email) {
    return res.status(400).json({ error: 'Type your email address exactly to confirm.' });
  }
  store.deleteUser(req.user.id);
  res.setHeader('Set-Cookie', `cl_session=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);
  res.json({ ok: true });
}

export async function changePassword(req, res) {
  const user = req.user;
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');

  const full = store.getUserById(user.id);
  if (!(await verifyPassword(current, full.password_hash))) {
    return res.status(401).json({ error: 'Your current password is not right.' });
  }
  if (next.length < 10) return res.status(400).json({ error: 'Use at least 10 characters.' });

  store.updatePassword(user.id, await hashPassword(next));
  // Every other session is invalidated; the current one is re-issued.
  store.deleteSessionsForUser(user.id);
  startSession(req, res, user.id);
  res.json({ ok: true });
}
