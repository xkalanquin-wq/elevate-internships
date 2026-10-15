// Reports errors in this browser to the site owner's error log (/owner), so a
// broken page gets noticed. Only the message, the page path and where in the
// code it happened are sent — nothing typed into the page, no personal data.
// At most five reports per page load, and each distinct message once.

const MAX_REPORTS = 5;
const sent = new Set();

export function reportError(error, extra = '') {
  try {
    const message = String(error?.message || error || 'Unknown error').slice(0, 300);
    if (sent.size >= MAX_REPORTS || sent.has(message)) return;
    // Errors from browser extensions and third-party scripts are not ours to fix.
    const stack = String(error?.stack || extra || '');
    if (/chrome-extension:|moz-extension:|safari-extension:/.test(stack)) return;
    sent.add(message);
    const at = stack.split('\n').find((l) => /\/assets\//.test(l)) || '';
    const body = JSON.stringify({ message, path: window.location.pathname, at: at.trim().slice(0, 200) });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
    else fetch('/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    /* reporting must never cause an error of its own */
  }
}

export function startErrorReporting() {
  window.addEventListener('error', (e) => {
    // Only script errors from this site's own files.
    if (e.filename && !e.filename.startsWith(window.location.origin)) return;
    reportError(e.error || e.message, `${e.filename}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // A failed request is already shown to the person; it is not a code error.
    if (r && typeof r.status === 'number') return;
    reportError(r);
  });
}
