import React, { useEffect, useState } from 'react';
import Nav from '../components/kinetic/Nav';
import Ticker from '../components/kinetic/Ticker';
import Hero from '../components/kinetic/Hero';
import Certifications from '../components/kinetic/Certifications';
import Internships from '../components/kinetic/Internships';
import Portal from '../components/kinetic/Portal';
import Footer from '../components/kinetic/Footer';
import { api } from '../api';
import SeoSection from '../SeoSection.jsx';
import HUB from '../../../server/data/hub-content.json';

/**
 * The kinetic home page.
 *
 * This is a presentation layer over the existing app, not a second app. Every
 * action leads back into the Finder, the Ledger or the auth flow that already
 * exist — App owns the state, this page only arranges it.
 *
 * `onStartSearch(zip)` is the one that matters: the ZIP typed in the hero is
 * handed to the Finder and the search runs there. Asking for it twice would
 * make the landing page a tax rather than a shortcut.
 */
export default function Home({
  user = null,
  theme = 'system',
  onTheme,
  onTab,
  onSignIn,
  onSignOut,
  onStartSearch,
  onAddTrack,
  onLegal,
}) {
  const [tracks, setTracks] = useState([]);
  const [catalogCount, setCatalogCount] = useState(null);
  const [stats, setStats] = useState(null);

  // Mark the document as JS-capable. The reveal styles key off this, so if
  // the bundle fails to run the page renders fully visible instead of blank.
  useEffect(() => {
    document.documentElement.setAttribute('data-k-js', '');
    return () => document.documentElement.removeAttribute('data-k-js');
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .tracks()
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.tracks) ? res.tracks : [];
        setTracks(list);
        if (typeof res?.catalogCount === 'number') setCatalogCount(res.catalogCount);
      })
      .catch(() => {
        // A failed fetch here costs the ticker two of its numbers and the
        // track switcher its options. It is not worth an error banner on a
        // landing page — the sections below degrade to their static copy.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Stats only exist for a signed-in user; anonymous callers get 401 by design.
  useEffect(() => {
    if (!user) {
      setStats(null);
      return undefined;
    }
    let cancelled = false;
    api
      .stats()
      .then((res) => {
        if (!cancelled) setStats(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="k-scope font-body text-ink">
      <Nav
        tab="finder"
        onTab={onTab}
        user={user}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
        theme={theme}
        onTheme={onTheme}
      />

      <Ticker
        tracks={tracks}
        catalogCount={catalogCount}
        sources={['The Muse', 'Greenhouse', 'Lever', 'Ashby', 'SmartRecruiters', 'Simplify', 'Himalayas']}
      />

      <main id="k-main">
        <Hero onSearch={onStartSearch} onBrowse={() => onTab?.('ledger')} />

        <Internships onSearch={() => onTab?.('finder')} />

        <Certifications
          tracks={tracks}
          onAddTrack={onAddTrack}
          onSeeAll={() => onTab?.('ledger')}
        />

        <div className="mx-auto max-w-page px-s4">
          <SeoSection block={HUB.landing} />
        </div>

        <Portal
          user={user}
          stats={stats}
          onSignIn={onSignIn}
          onCreate={onSignIn}
          onGoLedger={() => onTab?.('ledger')}
          onGoStats={() => onTab?.('stats')}
        />
      </main>

      <Footer onLegal={onLegal} catalogCount={catalogCount} trackCount={tracks.length || null} />
    </div>
  );
}
