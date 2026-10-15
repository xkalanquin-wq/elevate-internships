import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Finder from './Finder.jsx';
import Ledger from './Ledger.jsx';
import Stats from './Stats.jsx';
import Tracker from './Tracker.jsx';
import MajorPage from './MajorPage.jsx';
import Legal from './Legal.jsx';
import NotFound from './NotFound.jsx';
import Auth from './Auth.jsx';
import ConsentBanner from './ConsentBanner.jsx';
import InstallApp from './InstallApp.jsx';
import AccountLink from './AccountLink.jsx';
import Account from './Account.jsx';
import { captureReferral } from './referral.js';
import { PREMIUM_ENABLED } from './features.js';
import { confetti } from './motion.js';
import SeoSection from './SeoSection.jsx';
import HUB from '../../server/data/hub-content.json';
import { seoTitle } from '../../server/seo.js';
import { api, preferredSourceUrl } from './api.js';
import { applySavedConsent, getConsent, setConsent } from './consent.js';
import {
  clearGuest,
  guestAdd,
  guestAddTrack,
  guestClearDone,
  guestLedger,
  guestPayload,
  guestRemove,
  guestStats,
  guestToggle,
  guestTracker,
  guestTrackRemove,
  guestTrackSave,
  guestTrackUpdate,
  hasGuestData,
} from './guestStore.js';
import Home from './pages/Home.jsx';
import PrimaryNav from './components/ui/PrimaryNav.jsx';
import PageLinks, { plainClick } from './components/ui/PageLinks.jsx';
import AccountControls from './components/ui/AccountControls.jsx';
import MoreSheet from './components/ui/MoreSheet.jsx';
import { AnimatedBackdrop, PageTransition } from './motion/index.js';

const TABS = [
  { id: 'finder', label: 'Finder', icon: 'search' },
  { id: 'ledger', label: 'Ledger', icon: 'ledger' },
  { id: 'tracker', label: 'Applications', icon: 'applications' },
  { id: 'stats', label: 'Stats', icon: 'stats' },
];

// The site's own pages, one click from the tabs. /certifications is part of
// the app; the rest are server-rendered pages, so they are plain links.
const PAGE_LINKS = [
  ...(PREMIUM_ENABLED ? [{ href: '/premium', label: 'Premium' }] : []),
  { href: '/sponsor', label: 'Sponsor' },
  { href: '/internships', label: 'Internships by major' },
  { href: '/certifications', label: 'Certifications by major', inApp: true },
  { href: '/career-guides', label: 'Career guides' },
];

/**
 * The legal pages get real URLs so they can be linked, bookmarked and crawled.
 * Everything else is one page, so the tabs stay as state.
 */
const LEGAL_PATHS = { '/terms': 'terms', '/privacy': 'privacy' };
const PATH_FOR = { terms: '/terms', privacy: '/privacy' };
const KNOWN_PATHS = new Set(['/', '/home', '/terms', '/privacy', '/verify', '/reset', '/account']);
const isAccountPath = (p) => normalizePath(p) === '/account';

const normalizePath = (p) => String(p || '').replace(/\/+$/, '') || '/';
const legalFromPath = (p) => LEGAL_PATHS[normalizePath(p)] || null;
/* /certifications is the list of majors ('' here); /certifications/<id> is one
   major. null means the path is not a major page at all. An unknown major id
   is still routed here — the page itself says it does not exist, and the
   server has already answered 404 for it. */
const majorFromPath = (p) => {
  const m = /^\/certifications(?:\/([a-z-]+))?$/.exec(normalizePath(p));
  return m ? m[1] || '' : null;
};
const isUnknownPath = (p) => !KNOWN_PATHS.has(normalizePath(p)) && majorFromPath(p) === null;
/* The kinetic landing page. It lives at /home rather than / so the working
   app keeps its front door; to promote it, change this to '/'. */
const isHomePath = (p) => normalizePath(p) === '/home';
/* Where the links in account emails land: confirming an address, or choosing
   a new password. Never indexed; the token is read once, then dropped from the
   address bar. */
const ACCOUNT_LINK_PATHS = { '/verify': 'verify', '/reset': 'reset' };
const accountLinkFromLocation = () => {
  const kind = ACCOUNT_LINK_PATHS[normalizePath(window.location.pathname)];
  if (!kind) return null;
  let token = '';
  try {
    token = (new URLSearchParams(window.location.search).get('token') || '').slice(0, 200);
  } catch {
    /* an unreadable query is the same as a missing token */
  }
  return { kind, token };
};

const PAGE_META = {
  terms: {
    title: 'Terms and Conditions — Elevate Internships',
    description:
      'The terms covering Elevate Internships: listings come from third parties, certification costs change, and nothing here is career or financial advice.',
  },
  privacy: {
    title: 'Privacy Policy — Elevate Internships',
    description:
      'No tracking cookies and no third-party analytics. What is stored, what leaves your machine, and how to stop it.',
  },
  kinetic: {
    title: seoTitle('Internship Tracker for Business Majors'),
    description:
      'A free internship tracker for business majors: find internships near you, track every application to an offer, and plan the certifications for your field.',
  },
  home: {
    title: seoTitle('Business Internship Finder by ZIP Code'),
    description:
      'A free business internship finder by ZIP code: real internships near you, ranked by fit and distance, with the certifications that fit your major.',
  },
};

/**
 * The "Save to Elevate" browser extension opens /?add=1&url=…&title=…&company=…
 * &location=…, which opens the Applications tab with the Add form filled in.
 * Nothing is saved until the person presses Add.
 */
function prefillFromLocation() {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('add') !== '1') return null;
    const url = (q.get('url') || '').slice(0, 500);
    if (!/^https?:\/\//i.test(url)) return null;
    return {
      url,
      title: (q.get('title') || '').slice(0, 200),
      company: (q.get('company') || '').slice(0, 160),
      location: (q.get('location') || '').slice(0, 200),
    };
  } catch {
    return null;
  }
}

/** An offer is the big one; sending an application gets a smaller burst. */
function celebrate(status) {
  if (status === 'offer') confetti({ size: 'big' });
  else if (status === 'applied') confetti({ size: 'small' });
}

export default function App() {
  // ?tab= opens a section directly: the installed app's shortcuts use it.
  const [prefill, setPrefill] = useState(prefillFromLocation);
  const [tab, setTab] = useState(() => {
    try {
      if (prefillFromLocation()) return 'tracker';
      const wanted = new URLSearchParams(window.location.search).get('tab');
      return TABS.some((t) => t.id === wanted) ? wanted : 'finder';
    } catch {
      return 'finder';
    }
  });
  const [legal, setLegal] = useState(() => legalFromPath(window.location.pathname));
  const [kinetic, setKinetic] = useState(() => isHomePath(window.location.pathname));
  // A ZIP handed over from the kinetic hero, prefilled into the Finder once.
  const [seedZip, setSeedZip] = useState('');
  // Likewise a major, handed over from a major's page or a /?major= link
  // from the internships pages.
  const [seedMajor, setSeedMajor] = useState(() => {
    try {
      return (new URLSearchParams(window.location.search).get('major') || '').slice(0, 80);
    } catch {
      return '';
    }
  });
  const [majorRoute, setMajorRoute] = useState(() => majorFromPath(window.location.pathname));
  const [tracked, setTracked] = useState(null);
  const [contactEmail, setContactEmail] = useState(null);
  const [notFound, setNotFound] = useState(() => isUnknownPath(window.location.pathname));
  const [accountLink, setAccountLink] = useState(accountLinkFromLocation);
  const [accountPage, setAccountPage] = useState(() => isAccountPath(window.location.pathname));
  const [ads, setAds] = useState(false);
  const [ledger, setLedger] = useState(null);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('cl-theme') || 'system';
    } catch {
      return 'system';
    }
  });
  const [consent, setConsentState] = useState(() => getConsent());

  // null = still checking, false = signed out, object = signed in.
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    applySavedConsent();
    captureReferral();
    // The major, tab, referral, extension hand-off or email-link token is now
    // in the page; keep the address bar clean (a token left there would sit in
    // history and in any share). /account reads and clears its own ?paid=.
    if (/[?&](major|tab|token|ref|add)=/.test(window.location.search) && !isAccountPath(window.location.pathname)) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then(({ user: u }) => setUser(u || false))
      .catch(() => setUser(false));
  }, []);

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('cl-theme', theme);
    } catch {
      /* storage blocked; the choice still applies for this session */
    }
  }, [theme]);

  // Groups describe the catalog, not a person, so guest mode needs them too.
  const [groups, setGroups] = useState([]);
  const [notice, setNotice] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);

  useEffect(() => {
    api.tracks().then(() => {}).catch(() => {});
    api
      .site()
      .then((s) => {
        setContactEmail(s.contactEmail || null);
        setAds(Boolean(s.ads));
      })
      .catch(() => {});
  }, []);

  /**
   * Signed in: the server is the source of truth.
   * Signed out: a guest ledger in localStorage, so the app is usable before
   * anyone commits to an account.
   */
  const reloadLedger = useCallback(async () => {
    if (user) {
      const state = await api.ledger();
      setGroups(state.groups);
      setLedger(state);
      return;
    }
    // Guest needs the group list, which only the server has.
    let gs = groups;
    if (!gs.length) {
      gs = await api.groups().then((r) => r.groups).catch(() => []);
      setGroups(gs);
    }
    setLedger(guestLedger(gs));
  }, [user, groups]);

  useEffect(() => {
    if (user === null) return; // still checking the session
    reloadLedger().catch(console.error);
    if (user) {
      api
        .tracker()
        .then((r) => setTracked(r.jobs))
        .catch(() => setTracked([]));
    } else {
      setTracked(guestTracker());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // After an email is confirmed, pick up the "verified" flag for whoever is
  // signed in (nobody may be; confirming works without a session).
  const refreshUser = useCallback(() => {
    api
      .me()
      .then(({ user: u }) => setUser(u || false))
      .catch(() => {});
  }, []);

  const onAuthed = useCallback(async ({ user: u, adopted }) => {
    setShowAuth(false);

    // Carry anything tried as a guest into the new account.
    let imported = 0;
    let importedJobs = 0;
    if (hasGuestData()) {
      try {
        const res = await api.importGuest(guestPayload());
        imported = res.imported || 0;
        importedJobs = res.importedJobs || 0;
        clearGuest();
      } catch {
        /* keep the guest data rather than losing it on a failed import */
      }
    }

    setUser(u);

    const parts = [];
    if (imported) parts.push(`${imported} item${imported === 1 ? '' : 's'} you added before signing in`);
    if (adopted) parts.push(`${adopted} item${adopted === 1 ? '' : 's'} saved before accounts existed`);
    if (importedJobs) parts.push(`${importedJobs} tracked internship${importedJobs === 1 ? '' : 's'}`);
    if (parts.length) setNotice(`Moved ${parts.join(' and ')} into your account.`);
  }, []);

  const openAccount = () => {
    setLegal(null);
    setMajorRoute(null);
    setNotFound(false);
    setKinetic(false);
    setAccountPage(true);
    window.history.pushState({ legal: null }, '', '/account');
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const onSignOut = useCallback(async () => {
    await api.logout().catch(() => {});
    setAccountPage(false);
    if (isAccountPath(window.location.pathname)) window.history.pushState({ legal: null }, '', '/');
    setUser(false);
    setLedger(null);
    setTracked(null);
    setTab('finder');
  }, []);

  const addedIds = useMemo(() => new Set((ledger?.items || []).map((a) => a.id)), [ledger]);
  const startedTracks = useMemo(() => new Set(ledger?.tracks || []), [ledger]);

  // Each action goes to the server for a signed-in person and to localStorage
  // for a guest, so both paths produce the same ledger shape.
  const onToggle = useCallback(
    async (id, done) => {
      if (!user) {
        guestToggle(id, done);
        setLedger(guestLedger(groups));
        return;
      }
      const { done: next } = await api.toggle(id, done);
      setLedger((s) => ({ ...s, done: next }));
    },
    [user, groups],
  );

  const onClear = useCallback(async () => {
    if (!user) {
      guestClearDone();
      setLedger(guestLedger(groups));
      return;
    }
    const { done } = await api.clear();
    setLedger((s) => ({ ...s, done }));
  }, [user, groups]);

  const onAdd = useCallback(
    async (cert) => {
      if (!user) {
        guestAdd({
          id: cert.id,
          group: 'finder',
          title: cert.title,
          provider: cert.provider,
          desc: cert.desc,
          hours: cert.hours,
          cost: cert.cost,
          price: cert.price,
          links: cert.url ? [{ label: 'Open', url: cert.url }] : [],
          field: cert.field,
        });
        setLedger(guestLedger(groups));
        return;
      }
      setLedger(await api.add(cert));
    },
    [user, groups],
  );

  const onRemove = useCallback(
    async (id) => {
      if (!user) {
        guestRemove(id);
        setLedger(guestLedger(groups));
        return;
      }
      setLedger(await api.remove(id));
    },
    [user, groups],
  );

  const onAddTrack = useCallback(
    async (field) => {
      if (!user) {
        // The server knows what a track contains; ask it, then store locally.
        const { items } = await api.trackItems(field);
        guestAddTrack(field, items);
        setLedger(guestLedger(groups));
        return;
      }
      setLedger(await api.addTrack(field));
    },
    [user, groups],
  );

  // ---- Application tracker: server for an account, localStorage for a guest.
  const onTrack = useCallback(
    async (job, status) => {
      celebrate(status);
      if (!user) {
        setTracked(guestTrackSave(job, status));
        return;
      }
      const payload = {
        url: job.url,
        title: job.title,
        company: job.company,
        location: job.location,
        source: job.source,
        remote: job.remote,
        postedAt: job.postedAt,
        deadline: job.deadline,
        tz: (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
          } catch {
            return '';
          }
        })(),
      };
      setTracked((await api.trackSave(payload, status)).jobs);
    },
    [user],
  );

  const onTrackStatus = useCallback(
    async (jobKey, status) => {
      celebrate(status);
      if (!user) return setTracked(guestTrackUpdate(jobKey, { status }));
      setTracked((await api.trackStatus(jobKey, status)).jobs);
    },
    [user],
  );

  const onTrackNote = useCallback(
    async (jobKey, note) => {
      if (!user) return setTracked(guestTrackUpdate(jobKey, { note }));
      setTracked((await api.trackNote(jobKey, note)).jobs);
    },
    [user],
  );

  const onTrackRemove = useCallback(
    async (jobKey) => {
      if (!user) return setTracked(guestTrackRemove(jobKey));
      setTracked((await api.trackRemove(jobKey)).jobs);
    },
    [user],
  );

  const onTrackDates = useCallback(
    async (jobKey, dates) => {
      // The time zone travels with the dates, so a reminder goes out on the
      // right day for this person rather than the server's.
      let tz = '';
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch {
        /* older browsers: the server falls back to a default */
      }
      if (!user) return setTracked(guestTrackUpdate(jobKey, { ...dates, tz }));
      setTracked((await api.trackDates(jobKey, { ...dates, tz })).jobs);
    },
    [user],
  );

  const trackedStatus = useMemo(() => new Map((tracked || []).map((j) => [j.jobKey, j.status])), [tracked]);

  const total = ledger?.items.length || 0;
  const doneCount = ledger ? ledger.items.filter((i) => ledger.done[i.id]).length : 0;

  const nextTheme = { system: 'light', light: 'dark', dark: 'system' };

  /** Roving tabindex + arrow keys, per the ARIA tabs pattern. */
  const [moveFocus, setMoveFocus] = useState(false);

  const onTabKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length].id;
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length].id;
    else if (e.key === 'Home') next = TABS[0].id;
    else if (e.key === 'End') next = TABS[TABS.length - 1].id;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    setMoveFocus(true);
  };

  useEffect(() => {
    if (!moveFocus) return;
    document.getElementById(`tab-${tab}`)?.focus();
    setMoveFocus(false);
  }, [tab, moveFocus]);

  const chooseConsent = (v) => {
    setConsent(v);
    setConsentState(v);
  };

  // Moving to a major page, or between them. Paths other than /certifications
  // fall through to the normal app.
  const openPath = (to) => {
    const m = majorFromPath(to);
    setAccountPage(false);
    setLegal(null);
    setNotFound(false);
    setKinetic(false);
    setMajorRoute(m);
    window.history.pushState({ legal: null }, '', to);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const openLegal = (which) => {
    setAccountPage(false);
    setLegal(which);
    setMajorRoute(null);
    setNotFound(false);
    setKinetic(false);
    window.history.pushState({ legal: which }, '', PATH_FOR[which]);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const closeLegal = () => {
    setAccountPage(false);
    setAccountLink(null);
    setLegal(null);
    setMajorRoute(null);
    setNotFound(false);
    setKinetic(false);
    window.history.pushState({ legal: null }, '', '/');
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  // The section buttons work from every screen. On the tab screens they switch
  // tabs as before; from a major, a policy, Account or sign-in they first go
  // back to the app, then open that section.
  const selectSection = (id, onTabScreen) => {
    if (!onTabScreen) {
      setShowAuth(false);
      closeLegal();
    }
    setTab(id);
  };

  // Leaving the landing page for the app proper. Pushes '/' so Back returns
  // to the landing page rather than to whatever preceded the whole visit.
  const leaveKinetic = (nextTab) => {
    setAccountPage(false);
    setKinetic(false);
    if (nextTab) setTab(nextTab);
    window.history.pushState({ legal: null }, '', '/');
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  // Back/forward must move between the legal pages, the app and a 404.
  useEffect(() => {
    const onPop = () => {
      // The token was dropped from the address bar, so returning here by
      // Back cannot reopen a link; show the app instead.
      setAccountLink(null);
      setLegal(legalFromPath(window.location.pathname));
      setNotFound(isUnknownPath(window.location.pathname));
      setKinetic(isHomePath(window.location.pathname));
      setMajorRoute(majorFromPath(window.location.pathname));
      setAccountPage(isAccountPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Keep the document title and description in step with the route, so a
  // shared /privacy link previews as the privacy policy rather than the app.
  useEffect(() => {
    if (accountLink) {
      document.title =
        accountLink.kind === 'verify' ? 'Confirm your email — Elevate Internships' : 'Choose a new password — Elevate Internships';
      document.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex, nofollow');
      return;
    }
    if (accountPage) {
      document.title = 'Your account — Elevate Internships';
      document.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex, nofollow');
      return;
    }
    // A single major's page sets its own title once it knows the major's name.
    if (majorRoute) return;
    const meta = notFound
      ? { title: 'Page not found — Elevate Internships', description: 'That page does not exist.' }
      : majorRoute === ''
        ? {
            title: seoTitle('Best Certifications for Business Majors'),
            description:
              'Certifications for business majors, by field: the free and paid ones worth your time for 23 majors, with real prices and recruiting timelines.',
          }
        : PAGE_META[legal || (kinetic ? 'kinetic' : 'home')];
    document.title = meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      // Build from the origin rather than editing the existing string, so a
      // malformed starting value cannot compound with every navigation.
      try {
        const origin = new URL(canonical.getAttribute('href'), window.location.href).origin;
        // A 404 is noindex, so pointing its canonical at the homepage says two
        // contradictory things about the same URL: "do not index this" and
        // "treat this as the homepage". Self-reference instead, and let
        // noindex be the only instruction that matters.
        const here = notFound
          ? window.location.pathname
          : majorRoute === ''
            ? '/certifications'
            : legal
            ? PATH_FOR[legal]
            : kinetic
              ? '/home'
              : '/';
        canonical.setAttribute('href', `${origin}${here}`);
      } catch {
        /* a missing or unparseable canonical is not worth breaking render over */
      }
    }
    // A 404 must not be indexed as a real page.
    let robots = document.querySelector('meta[name="robots"]');
    if (robots) robots.setAttribute('content', notFound ? 'noindex, follow' : 'index, follow, max-image-preview:large');
  }, [legal, notFound, kinetic, majorRoute, accountLink, accountPage]);

  // The landing page replaces the whole shell — it brings its own nav and
  // footer. Auth, the legal pages and the 404 still win over it, so signing
  // in from the landing page does not leave you on a page with two navs.
  if (kinetic && !legal && !notFound && !showAuth && !accountPage) {
    return (
      <Home
        user={user || null}
        theme={theme}
        onTheme={() => setTheme(nextTheme[theme])}
        onTab={(next) => leaveKinetic(next)}
        onSignIn={() => setShowAuth(true)}
        onSignOut={onSignOut}
        onStartSearch={(zip) => {
          setSeedZip(zip);
          leaveKinetic('finder');
        }}
        onAddTrack={(field) => {
          onAddTrack(field);
          leaveKinetic('ledger');
        }}
        onLegal={openLegal}
      />
    );
  }

  const pageHasOwnHeading = Boolean(showAuth || accountLink || notFound || legal || majorRoute !== null || accountPage);
  // The four tabs and their panel are only on the main screen; elsewhere the
  // same buttons lead back to it.
  const onTabScreen = !pageHasOwnHeading;
  const screenKey = showAuth
    ? 'auth'
    : accountLink
      ? 'account-link'
      : accountPage
        ? 'account'
        : notFound
          ? 'not-found'
          : legal
            ? `legal-${legal}`
            : majorRoute !== null
              ? `major-${majorRoute}`
              : `tab-${tab}`;
  const sectionTabs = TABS.map((t) => ({
    ...t,
    count:
      t.id === 'ledger' && total > 0
        ? `${doneCount}/${total}`
        : t.id === 'tracker' && tracked?.length > 0
          ? String(tracked.length)
          : null,
  }));

  return (
    // The Finder widens to fit search and results side by side on desktop.
    <div className={onTabScreen && tab === 'finder' ? 'wrap wrap-wide' : 'wrap'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="topbar">
        <div className="topbar-inner">
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              if (!plainClick(e)) return;
              e.preventDefault();
              selectSection('finder', onTabScreen);
            }}
          >
            Elevate Internships
          </a>
          <PrimaryNav
            tabs={sectionTabs}
            active={tab}
            asTabs={onTabScreen}
            onSelect={(id) => selectSection(id, onTabScreen)}
            onKeyDown={onTabKey}
            onMore={() => setMoreOpen(true)}
            moreOpen={moreOpen}
            moreRef={moreButton}
          />
          <AccountControls
            user={user}
            theme={theme}
            onTheme={() => setTheme(nextTheme[theme])}
            onAccount={openAccount}
            onSignIn={() => setShowAuth(true)}
            onSignOut={onSignOut}
          />
        </div>
      </header>

      {/* A named region, so the H1 and intro sit inside a landmark that a
          screen reader's landmark list reaches. */}
      <section className="masthead" aria-label="About Elevate Internships">
        {/* One H1 per page. Pages with their own heading (a major, the
            policies, sign-in) get it from the page; the search page's H1
            is this line, worded for what people search for. */}
        {pageHasOwnHeading ? (
          <div className="masthead-title">Find the internship, earn the credential.</div>
        ) : (
          <h1 className="masthead-title">Find business internships by ZIP code.</h1>
        )}
        <p>
          Real listings near you, free certifications matched to your field, and a ledger that remembers what you have
          finished.
        </p>
        {onTabScreen && <PageLinks links={PAGE_LINKS} onOpen={openPath} variant="pills" />}
        <AnimatedBackdrop />
      </section>

      {showAuth ? (
        <main id="main">
          <PageTransition routeKey={screenKey}>
            <Auth onDone={onAuthed} onCancel={() => setShowAuth(false)} />
          </PageTransition>
        </main>
      ) : accountLink ? (
        <main id="main">
          <PageTransition routeKey={screenKey}>
            <AccountLink
              kind={accountLink.kind}
              token={accountLink.token}
              onSignedIn={onAuthed}
              onVerified={refreshUser}
              onHome={closeLegal}
            />
          </PageTransition>
        </main>
      ) : accountPage ? (
        <main id="main">
          <PageTransition routeKey={screenKey}>
            <Account user={user} onSignIn={() => setShowAuth(true)} onSignOut={onSignOut} onUserChange={refreshUser} />
          </PageTransition>
        </main>
      ) : notFound ? (
        <main id="main">
          <PageTransition routeKey={screenKey}>
            <NotFound path={window.location.pathname} onHome={closeLegal} onLegal={openLegal} />
          </PageTransition>
        </main>
      ) : legal ? (
        <main id="main">
          <PageTransition routeKey={screenKey}>
            <Legal page={legal} onBack={closeLegal} />
          </PageTransition>
        </main>
      ) : majorRoute !== null ? (
        <main id="main">
          <PageTransition routeKey={screenKey}>
            <MajorPage
              id={majorRoute || null}
              onNavigate={openPath}
              onAdd={onAdd}
              onAddTrack={onAddTrack}
              addedIds={addedIds}
              startedTracks={startedTracks}
              onSearchMajor={(name) => {
                setSeedMajor(name);
                setTab('finder');
                openPath('/');
              }}
            />
          </PageTransition>
        </main>
      ) : (
        <>
          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button type="button" className="footer-link" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          )}

          <main id="main">
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              <PageTransition routeKey={screenKey}>
                {tab === 'finder' && (
                  <Finder
                    onAdd={onAdd}
                    onAddTrack={onAddTrack}
                    addedIds={addedIds}
                    startedTracks={startedTracks}
                    signedIn={Boolean(user)}
                    onNeedAccount={() => setShowAuth(true)}
                    seedZip={seedZip}
                    seedMajor={seedMajor}
                    trackedStatus={trackedStatus}
                    onTrack={onTrack}
                    onOpenTracker={() => setTab('tracker')}
                    onOpenMajor={(id) => openPath(`/certifications/${id}`)}
                    contactEmail={contactEmail}
                  />
                )}
                {tab === 'finder' && <SeoSection block={HUB.home} />}

                {/* A guest gets a working ledger held in their browser. The
                    banner is honest about what that means rather than nagging. */}
                {tab !== 'finder' && user === false && (
                  <div className="guest-bar">
                    <div>
                      <strong>You are not signed in.</strong> Your ledger and applications are saved in this browser
                      only — they will not follow you to another device, and clearing site data erases them.
                    </div>
                    <button type="button" className="btn small" onClick={() => setShowAuth(true)}>
                      Save it to an account
                    </button>
                  </div>
                )}

                {tab === 'ledger' && (
                  <Ledger
                    state={ledger}
                    onToggle={onToggle}
                    onClear={onClear}
                    onRemove={onRemove}
                    onGoFind={() => setTab('finder')}
                  />
                )}
                {tab === 'tracker' && (
                  <Tracker
                    jobs={tracked}
                    onStatus={onTrackStatus}
                    onNote={onTrackNote}
                    onRemove={onTrackRemove}
                    onAdd={onTrack}
                    onDates={onTrackDates}
                    prefill={prefill}
                    onPrefillUsed={() => setPrefill(null)}
                    signedIn={Boolean(user)}
                    onSignIn={() => setShowAuth(true)}
                    onGoFind={() => setTab('finder')}
                  />
                )}
                {tab === 'stats' && (
                  <Stats
                    tracked={tracked || []}
                    onGoTracker={() => setTab('tracker')}
                    onGoFind={() => setTab('finder')}
                    guest={!user}
                    guestData={!user ? guestStats(groups) : null}
                  />
                )}
              </PageTransition>
            </div>
          </main>
        </>
      )}

      <footer className="footer">
        <div className="footer-links">
          {/* Real hrefs so crawlers follow them and middle-click works; the
              handler keeps navigation client-side for everyone else. */}
          <a
            className="footer-link"
            href="/terms"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              openLegal('terms');
            }}
          >
            Terms and Conditions
          </a>
          <span aria-hidden="true">·</span>
          <a
            className="footer-link"
            href="/privacy"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              openLegal('privacy');
            }}
          >
            Privacy Policy
          </a>
          <span aria-hidden="true">·</span>
          <a className="footer-link" href="/accessibility">
            Accessibility
          </a>
          {/* The tabs screen already links these in the row under the tabs;
              pages without that row (a major, legal, account, 404) keep them here. */}
          {pageHasOwnHeading && (
            <>
              <span aria-hidden="true">·</span>
              <a
                className="footer-link"
                href="/certifications"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  openPath('/certifications');
                }}
              >
                Certifications by major
              </a>
              <span aria-hidden="true">·</span>
              <a className="footer-link" href="/internships">
                Internships by major
              </a>
              <span aria-hidden="true">·</span>
              <a className="footer-link" href="/career-guides">
                Career guides
              </a>
            </>
          )}
          <span aria-hidden="true">·</span>
          <a className="footer-link" href="/interview-questions">
            Interview questions
          </a>
          <span aria-hidden="true">·</span>
          <a className="footer-link" href="/how-it-works">
            How it works
          </a>
          {pageHasOwnHeading && (
            <>
              {PREMIUM_ENABLED && (
                <>
                  <span aria-hidden="true">·</span>
                  <a className="footer-link" href="/premium">
                    Premium
                  </a>
                </>
              )}
              <span aria-hidden="true">·</span>
              <a className="footer-link" href="/sponsor">
                Sponsor
              </a>
            </>
          )}
          {contactEmail && (
            <>
              <span aria-hidden="true">·</span>
              <a
                className="footer-link"
                href={`mailto:${contactEmail}?subject=${encodeURIComponent('Elevate Internships feedback')}`}
              >
                Send feedback
              </a>
            </>
          )}
          {consent && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className="footer-link" onClick={() => setConsentState(null)}>
                Font settings ({consent === 'granted' ? 'Google Fonts on' : 'system fonts'})
              </button>
            </>
          )}
        </div>
        <a className="pref-source" href={preferredSourceUrl()} target="_blank" rel="noopener noreferrer">
          <span className="pref-star" aria-hidden="true">★</span>
          <span>
            Add Elevate Internships as a <strong>preferred source</strong> on Google
          </span>
        </a>
        <InstallApp />
        <div className="footer-note">
          {ads
            ? `No ads in the app and no third-party analytics. Some guide pages show Google ads${PREMIUM_ENABLED ? '; Premium removes them' : ''}.`
            : 'No tracking and no third-party analytics. One cookie, only once you sign in.'}
        </div>
      </footer>

      <MoreSheet
        open={moreOpen}
        onClose={closeMore}
        returnFocusRef={moreButton}
        user={user}
        onAccount={openAccount}
        onSignIn={() => setShowAuth(true)}
        onSignOut={onSignOut}
        theme={theme}
        onSetTheme={setTheme}
        consent={consent}
        onFontSettings={() => setConsentState(null)}
        contactEmail={contactEmail}
        links={PAGE_LINKS}
        onOpenLink={openPath}
      />

      {consent === null && (
        <ConsentBanner
          onChoice={chooseConsent}
          onReadPrivacy={() => {
            openLegal('privacy');
          }}
        />
      )}
    </div>
  );
}
