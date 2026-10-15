// Consent for the one third-party request this app makes.
//
// Nothing here is theatre: the app sets no tracking cookies and runs no third-party
// analytics (the server keeps only an anonymous page-view tally), so a
// generic "we value your privacy" banner would be decorative. The genuinely
// consent-worthy thing is Google Fonts, which discloses the visitor's IP to
// Google on every page load. Declining actually prevents that request.

const KEY = 'cl-consent';

/** 'granted' | 'denied' | null (not yet asked) */
export function getConsent() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    // Private mode or blocked storage: treat as not asked, and do not load fonts.
    return null;
  }
}

export function setConsent(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* nothing we can do; the session still honours the choice in memory */
  }
  if (value === 'granted') loadGoogleFonts();
}

let loaded = false;

/** Inject the stylesheet only on an explicit yes. */
export function loadGoogleFonts() {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;

  for (const href of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
    const pre = document.createElement('link');
    pre.rel = 'preconnect';
    pre.href = href;
    if (href.includes('gstatic')) pre.crossOrigin = 'anonymous';
    document.head.appendChild(pre);
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;1,400&display=swap';
  document.head.appendChild(link);
  document.documentElement.setAttribute('data-webfonts', 'on');
}

/** Apply a previously saved choice on boot. */
export function applySavedConsent() {
  if (getConsent() === 'granted') loadGoogleFonts();
}
