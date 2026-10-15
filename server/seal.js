// Encryption for the secrets this server has to keep readable (not hashes):
// the notification signing key and each browser's notification keys.
// Passwords, sessions and email links are hashed instead, so they cannot be
// read back at all.
//
// AES-256-GCM with a key derived from DATA_KEY, or failing that from
// OWNER_SECRET (which Render generates). Without either — on a developer's
// machine — values are stored as they are. Anything stored before encryption
// was switched on is still read, and is encrypted the next time it is saved.
//
// If the key ever changes, sealed values can no longer be opened: open()
// returns null, notification keys are made again, and people turn
// notifications back on. Nothing else depends on it.

import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';
let cached;

function key() {
  if (cached !== undefined) return cached;
  const secret = String(process.env.DATA_KEY || process.env.OWNER_SECRET || '').trim();
  cached = secret ? Buffer.from(crypto.hkdfSync('sha256', secret, 'elevate-internships', 'data-encryption-v1', 32)) : null;
  return cached;
}

export const sealingEnabled = () => Boolean(key());

/** Encrypts a string. Returns it unchanged when no key is configured. */
export function seal(text) {
  const k = key();
  if (!k) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Decrypts seal()'s output; passes plain values through; null if it cannot be opened. */
export function open(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const k = key();
  if (!k) return null;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** For tests. */
export function resetSealKey() {
  cached = undefined;
}
