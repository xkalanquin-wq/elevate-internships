// Referral and campus-ambassador links: elevateinternships.com/?ref=uconn-jamie
//
// The code is kept in this browser (not a cookie) for 30 days and sent once,
// with the sign-up form, so the account records who referred it. Nothing is
// sent anywhere else.

const KEY = 'el-ref';
const DAYS = 30;
const VALID = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** Reads ?ref= from the address, if present, and remembers it. */
export function captureReferral(search = window.location.search) {
  try {
    const code = (new URLSearchParams(search).get('ref') || '').trim().toLowerCase();
    if (VALID.test(code)) localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    /* storage blocked: the link still works, it just is not credited */
  }
}

/** The remembered code, or undefined once it is 30 days old. */
export function referralCode() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && VALID.test(saved.code) && Date.now() - saved.at < DAYS * 86_400_000) return saved.code;
  } catch {
    /* unreadable */
  }
  return undefined;
}
