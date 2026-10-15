// Field validation shared by the client form and mirrored on the server.
//
// Client-side validation is a courtesy to the person typing, never a security
// control — anything enforced here is enforced again in server/guard.js.

export const LIMITS = {
  zip: 5,
  major: 80,
  interest: 40,
  interests: 12,
};

const CONTROL_CHARS = /[\x00-\x1f]/;

/** Obvious junk in a free-text field: no letters, or url/markup shaped. */
const looksLikeSpam = (s) =>
  /https?:\/\/|www\.|<\/?[a-z]+>|\[url|\{\{/i.test(s) || /(.)\1{7,}/.test(s);

export function validateZip(zip) {
  const v = String(zip || '').trim();
  if (!v) return 'Enter a ZIP code.';
  if (!/^\d+$/.test(v)) return 'Digits only.';
  if (v.length !== 5) return `${5 - v.length} more digit${5 - v.length === 1 ? '' : 's'}.`;
  if (v === '00000') return 'That is not a real ZIP code.';
  return null;
}

export function validateMajor(major) {
  const v = String(major || '').trim();
  if (!v) return null; // optional
  if (v.length > LIMITS.major) return `Keep it under ${LIMITS.major} characters.`;
  if (CONTROL_CHARS.test(v)) return 'Remove any special control characters.';
  if (looksLikeSpam(v)) return 'Enter a major, not a link.';
  if (!/[a-z]/i.test(v)) return 'That does not look like a major.';
  return null;
}

export function validateInterest(value, existing = []) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return 'Type an interest first.';
  if (v.length > LIMITS.interest) return `Keep each interest under ${LIMITS.interest} characters.`;
  if (existing.includes(v)) return 'You already added that.';
  if (existing.length >= LIMITS.interests) return `That is the maximum of ${LIMITS.interests} interests.`;
  if (looksLikeSpam(v)) return 'Enter an interest, not a link.';
  if (!/[a-z]/i.test(v)) return 'That does not look like an interest.';
  return null;
}

/** Whole-form check. Returns { field: message } — empty object means valid. */
export function validateSearch({ zip, major, interests }) {
  const errors = {};
  const z = validateZip(zip);
  if (z) errors.zip = z;
  const m = validateMajor(major);
  if (m) errors.major = m;
  if ((interests || []).length > LIMITS.interests) {
    errors.interests = `Remove a few — the maximum is ${LIMITS.interests}.`;
  }
  return errors;
}
