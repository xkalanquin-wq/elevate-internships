import React from 'react';

/**
 * A short fade and rise each time the screen changes. `routeKey` names the
 * screen (a tab, a major, a policy…); a new key remounts the wrapper, which
 * replays the entrance. Purely CSS (motion.css .page-transition), so it never
 * delays the content: it is there from the first frame, just fading in.
 */
export default function PageTransition({ routeKey, children }) {
  return (
    <div key={routeKey} className="page-transition">
      {children}
    </div>
  );
}
